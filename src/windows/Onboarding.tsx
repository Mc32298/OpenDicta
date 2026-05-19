import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Notice, StatusBadge } from "../ui/controls";
import { DEFAULT_SHORTCUT, normalizeShortcutFromEvent } from "../lib/shortcutUtils";
import { DEFAULT_PREFS, PREFS_KEY, type Prefs } from "../shell/prefs";

type OnboardingState = {
  completed: boolean;
  shortcut: string;
  provider: string;
  model_installed: boolean;
};

type ShortcutBindings = {
  record: string;
  push_to_talk: string | null;
};

type ShortcutTarget = "record" | "pushToTalk";

type DownloadProgressEvent = {
  model_id: string;
  file_index: number;
  file_total: number;
  file_bytes: number;
  file_size: number;
  overall_percent: number;
};

const STEP_STATUS: Array<{ tone: "info" | "warn"; text: string }> = [
  { tone: "info", text: "Welcome. Let’s configure your setup." },
  { tone: "info", text: "Choose the shortcuts you want to use." },
  { tone: "info", text: "Install the local model required for transcription." },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<ShortcutTarget | null>(null);
  const [status, setStatus] = useState<{ tone: "info" | "ok" | "err" | "warn"; text: string }>({
    tone: "info",
    text: "Setting up OpenDicta...",
  });

  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState("F6");
  const [userName, setUserName] = useState("");
  const [modelInstalled, setModelInstalled] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const state = await invoke<OnboardingState>("get_onboarding_state");
        setShortcut(state.shortcut || DEFAULT_SHORTCUT);
        setModelInstalled(state.model_installed);
        const bindings = await invoke<ShortcutBindings>("get_shortcut_bindings").catch(() => null);
        if (bindings) {
          setShortcut(bindings.record || state.shortcut || DEFAULT_SHORTCUT);
          setPushToTalkShortcut(bindings.push_to_talk || "F6");
        }
        setUserName(loadStoredUserName());
        setStatus({ tone: "info", text: "Welcome. Let’s configure your setup." });
      } catch (e) {
        setStatus({ tone: "err", text: `Failed to load onboarding state: ${String(e)}` });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    invoke("set_shortcut_capture_mode", { enabled: Boolean(captureTarget) }).catch(console.error);
    if (!captureTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) return;
      setCaptureTarget(null);
      setStatus({ tone: "info", text: `Captured shortcut: ${normalized}. Saving...` });
      void saveShortcut(captureTarget, normalized);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      invoke("set_shortcut_capture_mode", { enabled: false }).catch(console.error);
    };
  }, [captureTarget]);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgressEvent>("model-download-progress", (event) => {
      if (event.payload.model_id !== "parakeet") return;
      const totalFiles = Math.max(1, event.payload.file_total || 1);
      const fileSize = Math.max(1, event.payload.file_size || 1);
      const completedFilesPercent = (event.payload.file_index / totalFiles) * 100;
      const currentFilePercent = (event.payload.file_bytes / fileSize) * (100 / totalFiles);
      const smoothProgress = Math.min(99.5, completedFilesPercent + currentFilePercent);
      setDownloadProgress(smoothProgress);
    });

    const unlistenComplete = listen("model-download-complete", () => {
      setDownloadProgress(100);
      setModelInstalled(true);
    });

    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenComplete.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    setStatus((current) => {
      if (current.tone === "err") return current;
      return STEP_STATUS[step];
    });
  }, [step]);

  const saveShortcut = async (target: ShortcutTarget, candidate: string) => {
    setBusy(true);
    try {
      if (target === "record") {
        await invoke("set_shortcut", { shortcut: candidate });
        const shortcutState = await invoke<{ registered: boolean; shortcut: string }>("get_shortcut_status");
        if (!shortcutState.registered) {
          throw new Error(`Shortcut '${shortcutState.shortcut}' is not registered`);
        }
        setShortcut(candidate);
        setStatus({ tone: "ok", text: `Record toggle saved: ${candidate}` });
        return;
      }

      await invoke("set_shortcut_binding", { action: "push_to_talk", shortcut: candidate });
      setPushToTalkShortcut(candidate);
      setStatus({ tone: "ok", text: `Push-to-talk saved: ${candidate}` });
    } catch (e) {
      setStatus({ tone: "err", text: `Failed to save shortcut: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const downloadModel = async () => {
    setBusy(true);
    setDownloadProgress(0);
    setStatus({ tone: "info", text: "Downloading Parakeet V3..." });
    try {
      await invoke("download_model", { modelId: "parakeet" });
      setModelInstalled(true);
      setDownloadProgress(100);
      setStatus({ tone: "ok", text: "Parakeet V3 download complete." });
    } catch (e) {
      setDownloadProgress(0);
      setStatus({ tone: "err", text: `Model download failed: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await invoke("complete_onboarding");
      await getCurrentWindow().hide();
    } catch (e) {
      setStatus({ tone: "err", text: `Failed to complete onboarding: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      const trimmedName = userName.trim();
      if (!trimmedName) {
        setStatus({ tone: "warn", text: "Enter your name before continuing." });
        return;
      }
      saveStoredUserName(trimmedName);
      setUserName(trimmedName);
      setStatus({ tone: "ok", text: `Nice to meet you, ${trimmedName}.` });
    }
    setStep((s) => Math.min(2, s + 1));
  };

  if (loading) {
    return <div className="wv-onboarding-wrap"><div className="wv-onboarding"><div className="wv-onboarding-body"><p>Loading...</p></div></div></div>;
  }

  return (
    <div className="wv-onboarding-wrap">
      <div className="wv-onboarding">
        <div className="wv-onboarding-body">
          <div className="wv-onboarding-title-row">
            <div className="wv-chrome-title">OpenDicta Setup</div>
            <button type="button" className="wv-btn wv-btn-ghost" onClick={() => void getCurrentWindow().hide()}>Close</button>
          </div>
          <div className="wv-onboarding-step">Step {step + 1} of 3</div>
          <h1>
            {step === 0 && "Welcome"}
            {step === 1 && "Choose Shortcuts"}
            {step === 2 && "Install Model"}
          </h1>
          {step === 0 && (
            <div className="wv-inline wv-inline-stack">
              <p>OpenDicta records while you hold a shortcut, then transcribes locally and pastes into your active app.</p>
              <label className="wv-field">
                <span className="wv-field-label">Your name</span>
                <input
                  className="wv-input"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name"
                  autoFocus
                  maxLength={40}
                />
              </label>
            </div>
          )}
          {step === 1 && (
            <div className="wv-inline wv-inline-stack">
              <p>Pick key combinations for both recording modes.</p>
              <div className="wv-shortcut-list">
                <ShortcutCaptureRow
                  label="Record toggle"
                  hint="Press once to start, press again to stop."
                  value={shortcut}
                  active={captureTarget === "record"}
                  disabled={busy || (captureTarget !== null && captureTarget !== "record")}
                  onCapture={() => setCaptureTarget("record")}
                  onCancel={() => setCaptureTarget(null)}
                />
                <ShortcutCaptureRow
                  label="Push-to-talk"
                  hint="Hold while speaking, release to stop."
                  value={pushToTalkShortcut}
                  active={captureTarget === "pushToTalk"}
                  disabled={busy || (captureTarget !== null && captureTarget !== "pushToTalk")}
                  onCapture={() => setCaptureTarget("pushToTalk")}
                  onCancel={() => setCaptureTarget(null)}
                />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="wv-inline wv-inline-stack">
              <p>Install Parakeet V3, the default local speech model for transcription.</p>
              <StatusBadge tone={modelInstalled ? "ok" : "warn"}>
                {modelInstalled ? "Ready" : "Required"}
              </StatusBadge>
              <span className="wv-note">{modelInstalled ? "Model installed." : "Model not installed yet."}</span>
              <button type="button" className="wv-btn" onClick={() => void downloadModel()} disabled={busy || modelInstalled}>
                {modelInstalled ? "Installed" : busy ? "Downloading..." : "Download Parakeet V3"}
              </button>
              {busy && (
                <div className="wv-download-progress" aria-live="polite">
                  <div className="wv-download-progress-meta">
                    <span>Downloading Parakeet V3</span>
                    <span>{downloadProgress < 100 ? `${downloadProgress.toFixed(1)}%` : "100%"}</span>
                  </div>
                  <div className="wv-download-progress-track">
                    <div className="wv-download-progress-fill" style={{ width: `${downloadProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          <Notice tone={status.tone}>{status.text}</Notice>

          <div className="wv-onboarding-actions">
            <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
            {step < 2 && (
              <Button variant="primary" disabled={busy || (step === 0 && !userName.trim())} onClick={() => void next()}>Next</Button>
            )}
            {step === 2 && (
              <Button variant="primary" disabled={busy || !modelInstalled} onClick={() => void finish()}>Finish</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function loadStoredUserName(): string {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return typeof parsed.userName === "string" ? parsed.userName : "";
  } catch {
    return "";
  }
}

function saveStoredUserName(userName: string): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    const next: Prefs = { ...DEFAULT_PREFS, ...parsed, userName };
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore localStorage write failures */
  }
}

function ShortcutCaptureRow({
  label,
  hint,
  value,
  active,
  disabled,
  onCapture,
  onCancel,
}: {
  label: string;
  hint: string;
  value: string;
  active: boolean;
  disabled: boolean;
  onCapture: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="wv-shortcut-row" data-active={active ? "1" : "0"}>
      <div className="wv-shortcut-copy">
        <div className="wv-shortcut-label">{label}</div>
        <div className="wv-shortcut-hint">{active ? "Press the new shortcut now." : hint}</div>
      </div>
      <span className="wv-kbd">{value}</span>
      {active ? (
        <button type="button" className="wv-btn wv-btn-ghost" onClick={onCancel} disabled={disabled}>Cancel</button>
      ) : (
        <button type="button" className="wv-btn" onClick={onCapture} disabled={disabled}>Change</button>
      )}
    </div>
  );
}
