import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Notice, StatusBadge } from "../ui/controls";

type OnboardingState = {
  completed: boolean;
  shortcut: string;
  provider: string;
  model_installed: boolean;
};

const DEFAULT_SHORTCUT = "ControlRight";

function normalizeShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  const key = e.key;
  if (!code) return null;
  if (code === "ControlRight" || code === "ControlLeft" || code === "ShiftLeft" || code === "ShiftRight" || code === "AltLeft" || code === "AltRight" || code === "MetaLeft" || code === "MetaRight") {
    return code;
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Super");

  let base: string | null = null;
  if (/^Key[A-Z]$/.test(code)) base = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) base = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) base = code;
  else if (code === "Space") base = "Space";
  else if (code === "Enter") base = "Enter";
  else if (code === "Escape") base = "Esc";
  else if (code === "Backspace") base = "Backspace";
  else if (code === "Tab") base = "Tab";
  else if (code === "ArrowUp") base = "Up";
  else if (code === "ArrowDown") base = "Down";
  else if (code === "ArrowLeft") base = "Left";
  else if (code === "ArrowRight") base = "Right";
  else if (code === "Insert") base = "Insert";
  else if (code === "Delete") base = "Delete";
  else if (code === "Home") base = "Home";
  else if (code === "End") base = "End";
  else if (code === "PageUp") base = "PageUp";
  else if (code === "PageDown") base = "PageDown";
  else if (code === "Minus") base = "-";
  else if (code === "Equal") base = "=";
  else if (code === "BracketLeft") base = "[";
  else if (code === "BracketRight") base = "]";
  else if (code === "Backslash") base = "\\";
  else if (code === "Semicolon") base = ";";
  else if (code === "Quote") base = "'";
  else if (code === "Comma") base = ",";
  else if (code === "Period") base = ".";
  else if (code === "Slash") base = "/";
  else if (code === "Backquote") base = "`";
  else if (code === "NumpadAdd") base = "NumpadAdd";
  else if (code === "NumpadSubtract") base = "NumpadSubtract";
  else if (code === "NumpadMultiply") base = "NumpadMultiply";
  else if (code === "NumpadDivide") base = "NumpadDivide";
  else if (code === "NumpadDecimal") base = "NumpadDecimal";
  else if (/^Numpad[0-9]$/.test(code)) base = code;
  else if (key && key.length === 1) base = key.toUpperCase();
  if (!base) return null;
  parts.push(base);
  return parts.join("+");
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "ok" | "err" | "warn"; text: string }>({
    tone: "info",
    text: "Setting up WhisperVoice...",
  });

  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [provider, setProvider] = useState("cpu");
  const [modelInstalled, setModelInstalled] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const state = await invoke<OnboardingState>("get_onboarding_state");
        setShortcut(state.shortcut || DEFAULT_SHORTCUT);
        setProvider(state.provider || "cpu");
        setModelInstalled(state.model_installed);
        setStatus({ tone: "info", text: "Welcome. Let’s configure your setup." });
      } catch (e) {
        setStatus({ tone: "err", text: `Failed to load onboarding state: ${String(e)}` });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!captureMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) return;
      setShortcut(normalized);
      setCaptureMode(false);
      setStatus({ tone: "info", text: `Captured shortcut: ${normalized}. Saving...` });
      void saveShortcut(normalized);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureMode]);

  const saveShortcut = async (candidate: string) => {
    setBusy(true);
    try {
      await invoke("set_shortcut", { shortcut: candidate });
      const shortcutState = await invoke<{ registered: boolean; shortcut: string }>("get_shortcut_status");
      if (!shortcutState.registered) {
        throw new Error(`Shortcut '${shortcutState.shortcut}' is not registered`);
      }
      setShortcut(candidate);
      setStatus({ tone: "ok", text: `Shortcut saved and active: ${candidate}` });
    } catch (e) {
      setStatus({ tone: "err", text: `Failed to save shortcut: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveProvider = async () => {
    setBusy(true);
    try {
      await invoke("set_onnx_provider", { provider });
      const runtime = await invoke<{ requested: string; effective: string; message: string }>("get_provider_runtime_status");
      setStatus({
        tone: runtime.effective === runtime.requested ? "ok" : "warn",
        text: `Requested ${runtime.requested}. Active provider: ${runtime.effective}. ${runtime.message}`,
      });
    } catch (e) {
      setStatus({ tone: "err", text: `Failed to save provider: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const downloadModel = async () => {
    setBusy(true);
    setStatus({ tone: "info", text: "Downloading model..." });
    try {
      await invoke("download_model");
      setModelInstalled(true);
      setStatus({ tone: "ok", text: "Model download complete." });
    } catch (e) {
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

  if (loading) {
    return <div className="wv-onboarding-wrap"><div className="wv-onboarding"><div className="wv-onboarding-body"><p>Loading...</p></div></div></div>;
  }

  return (
    <div className="wv-onboarding-wrap">
      <div className="wv-onboarding">
        <div className="wv-chrome">
          <div className="wv-traffic">
            <button type="button" aria-label="Close onboarding" onClick={() => void getCurrentWindow().hide()} style={{ background: "#FF5F57" }} />
            <button type="button" aria-label="Hide onboarding" onClick={() => void getCurrentWindow().hide()} style={{ background: "#FEBC2E" }} />
            <button aria-label="Onboarding status" type="button" style={{ background: "#28C840" }} disabled />
          </div>
          <div className="wv-chrome-title">WhisperVoice Setup</div>
          <div className="wv-chrome-spacer" />
        </div>
        <div className="wv-onboarding-body">
          <div className="wv-onboarding-step">Step {step + 1} of 4</div>
          <h1>
            {step === 0 && "Welcome"}
            {step === 1 && "Choose Shortcut"}
            {step === 2 && "Choose Compute Provider"}
            {step === 3 && "Install Model"}
          </h1>
          {step === 0 && <p>WhisperVoice records while you hold a shortcut, then transcribes locally and pastes into your active app.</p>}
          {step === 1 && (
            <div className="wv-inline wv-inline-stack">
              <p>Pick the key combination you want for push-to-talk.</p>
              <span className="wv-kbd">{shortcut}</span>
              <div className="wv-inline">
                {!captureMode && <button type="button" className="wv-btn" onClick={() => setCaptureMode(true)} disabled={busy}>Change Shortcut</button>}
                {captureMode && <button type="button" className="wv-btn wv-btn-ghost" onClick={() => setCaptureMode(false)} disabled={busy}>Cancel</button>}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="wv-inline wv-inline-stack">
              <p>Choose CPU for compatibility, CUDA for NVIDIA GPUs, or DirectML for Windows GPU acceleration.</p>
              <select className="wv-select" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}>
                <option value="cpu">CPU (always works)</option>
                <option value="cuda">CUDA (NVIDIA GPU)</option>
                <option value="directml">DirectML (Windows GPU)</option>
              </select>
              <button type="button" className="wv-btn" onClick={() => void saveProvider()} disabled={busy}>Save Provider</button>
            </div>
          )}
          {step === 3 && (
            <div className="wv-inline wv-inline-stack">
              <p>Install the local speech model required for transcription.</p>
              <StatusBadge tone={modelInstalled ? "ok" : "warn"}>
                {modelInstalled ? "Ready" : "Required"}
              </StatusBadge>
              <span className="wv-note">{modelInstalled ? "Model installed." : "Model not installed yet."}</span>
              <button type="button" className="wv-btn" onClick={() => void downloadModel()} disabled={busy || modelInstalled}>
                {modelInstalled ? "Installed" : busy ? "Downloading..." : "Download Model"}
              </button>
            </div>
          )}

          <Notice tone={status.tone}>{status.text}</Notice>

          <div className="wv-onboarding-actions">
            <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
            {step < 3 && (
              <Button variant="primary" disabled={busy} onClick={() => setStep((s) => Math.min(3, s + 1))}>Next</Button>
            )}
            {step === 3 && (
              <Button variant="primary" disabled={busy || !modelInstalled} onClick={() => void finish()}>Finish</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
