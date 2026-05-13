import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HealthStatus, Page, ProviderRuntimeStatus, ShortcutStatus } from "./settingsTypes";
import { Button, SettingsRow, SettingsSection, StatusBadge, ToggleSwitch } from "../ui/controls";
import { ToastProvider, useToast } from "../ui/toast";
import { ActivityIcon, BoxIcon, GearIcon, InfoIcon, KeyboardIcon, MicIcon, PaletteIcon } from "../ui/icons";
import { DEFAULT_SHORTCUT, normalizeShortcutFromEvent } from "../lib/shortcutUtils";

const PAGE_ALIASES: Record<string, Page> = {
  general: "general",
  shortcuts: "shortcut",
  keyboard: "shortcut",
  shortcut: "shortcut",
  mic: "microphone",
  microphone: "microphone",
  model: "model",
  models: "model",
  appearance: "appearance",
  diagnostics: "diagnostics",
  about: "about",
};

function normalizePage(input: string | null): Page {
  if (!input) return "general";
  return PAGE_ALIASES[input] ?? "general";
}

function getInitialPage(): Page {
  const params = new URLSearchParams(window.location.search);
  return normalizePage(params.get("page"));
}


export default function Settings() {
  const [page, setPage] = useState<Page>(getInitialPage);
  const [accent, setAccent] = useState("#0A84FF");

  const closeSettings = () => {
    void getCurrentWindow().hide();
  };

  useEffect(() => {
    const unlisten = listen<string>("navigate-to-page", (event) => {
      setPage(normalizePage(event.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ac", accent);
  }, [accent]);

  useEffect(() => {
    void invoke<string>("get_waveform_color").then(setAccent).catch(console.error);
  }, []);

  return (
    <div className="wv-settings" data-appearance="dark" data-variant="classic">
      <div className="wv-chrome">
        <div className="wv-traffic">
          <button aria-label="Close settings" onClick={closeSettings} style={{ background: "#FF5F57" }} />
          <button aria-label="Hide settings" onClick={closeSettings} style={{ background: "#FEBC2E" }} />
          <button aria-label="Settings status" type="button" style={{ background: "#28C840" }} disabled />
        </div>
        <div className="wv-chrome-title">VoiceNote Settings</div>
        <div className="wv-chrome-spacer" />
      </div>
      <div className="wv-body">
        <Sidebar active={page} onSelect={setPage} />
        <main className="wv-main">
          <ToastProvider>
            <div style={{ display: page === "general" ? "" : "none" }}><GeneralTab /></div>
            <div style={{ display: page === "shortcut" ? "" : "none" }}><ShortcutTab /></div>
            <div style={{ display: page === "microphone" ? "" : "none" }}><MicrophoneTab accent={accent} onAccentChange={setAccent} /></div>
            <div style={{ display: page === "model" ? "" : "none" }}><ModelTab /></div>
            <div style={{ display: page === "appearance" ? "" : "none" }}><AppearanceTab accent={accent} onAccentChange={setAccent} /></div>
            <div style={{ display: page === "diagnostics" ? "" : "none" }}><DiagnosticsTab /></div>
            <div style={{ display: page === "about" ? "" : "none" }}><AboutTab onNavigate={setPage} /></div>
          </ToastProvider>
        </main>
      </div>
    </div>
  );
}

function PaneHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="wv-pane-head">
      <div>
        <div className="wv-pane-title">{title}</div>
        <div className="wv-pane-sub">{subtitle}</div>
      </div>
    </div>
  );
}


function Sidebar({ active, onSelect }: { active: Page; onSelect: (page: Page) => void }) {
  const tabs: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
    { id: "general", label: "General", icon: <GearIcon /> },
    { id: "shortcut", label: "Shortcut", icon: <KeyboardIcon /> },
    { id: "microphone", label: "Microphone", icon: <MicIcon /> },
    { id: "model", label: "Model", icon: <BoxIcon /> },
    { id: "appearance", label: "Appearance", icon: <PaletteIcon /> },
    { id: "diagnostics", label: "Diagnostics", icon: <ActivityIcon /> },
    { id: "about", label: "About", icon: <InfoIcon /> },
  ];

  return (
    <aside className="wv-sidebar">
      <div className="wv-sidebar-head">
        <span className="wv-brand-mark"><MicIcon /></span>
        <div>
          <div className="wv-brand-name">VoiceNote</div>
          <div className="wv-brand-ver">Version 0.1.0</div>
        </div>
      </div>
      <nav className="wv-nav">
        {tabs.map((t) => (
          <button type="button" key={t.id} className="wv-nav-item" data-active={t.id === active ? "1" : "0"} onClick={() => onSelect(t.id)}>
            <span className="wv-nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function GeneralTab() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [profile, setProfile] = useState<string>("balanced");
  const [completionSound, setCompletionSound] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showErr, showOk } = useToast();

  useEffect(() => {
    void invoke<boolean>("get_autostart_enabled")
      .then(setLaunchAtLogin)
      .catch((e) => showErr(`Could not load launch-at-login: ${String(e)}`));
    void invoke<string>("get_runtime_profile")
      .then(setProfile)
      .catch((e) => showErr(`Could not load recording profile: ${String(e)}`));
    void invoke<boolean>("get_completion_sound")
      .then(setCompletionSound)
      .catch((e) => showErr(`Could not load completion sound: ${String(e)}`));
  }, []);

  const toggleLaunchAtLogin = async () => {
    const next = !launchAtLogin;
    setBusy(true);
    try {
      await invoke("set_autostart_enabled", { enabled: next });
      setLaunchAtLogin(next);
      showOk(`Launch at login ${next ? "enabled" : "disabled"}.`);
    } catch (e) {
      showErr(`Failed to change launch-at-login: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeProfile = async (v: string) => {
    setBusy(true);
    try {
      await invoke("set_runtime_profile", { profile: v });
      setProfile(v);
      showOk("Recording profile updated.");
    } catch (e) {
      showErr(`Failed to change recording profile: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleCompletionSound = async () => {
    const next = !completionSound;
    setBusy(true);
    try {
      await invoke("set_completion_sound", { enabled: next });
      setCompletionSound(next);
      showOk(`Completion sound ${next ? "enabled" : "disabled"}.`);
    } catch (e) {
      showErr(`Failed to change completion sound: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="General" subtitle="System behavior and startup defaults." />
      <SettingsSection title="Startup">
        <SettingsRow label="Launch at login" last>
          <ToggleSwitch label="Launch at login" on={launchAtLogin} onToggle={() => void toggleLaunchAtLogin()} disabled={busy} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Recording">
        <SettingsRow label="Recording profile" hint="Controls how long silence is allowed before auto-stop.">
          <select className="wv-select" value={profile} onChange={(e) => void changeProfile(e.target.value)} disabled={busy}>
            <option value="balanced">Balanced (25 s)</option>
            <option value="low_ram">Low RAM (5 s)</option>
            <option value="fast_wake">Extended (60 s)</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Sound on completion" hint="Play a short chime when transcription finishes." last>
          <ToggleSwitch label="Sound on completion" on={completionSound} onToggle={() => void toggleCompletionSound()} />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function ModelTab() {
  const [status, setStatus] = useState<{ all_present: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provider, setProvider] = useState("cpu");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderRuntimeStatus | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const { showErr, showInfo, showOk } = useToast();

  const refreshModelStatus = async () => {
    const v = await invoke<{ all_present: boolean }>("get_model_status");
    setStatus(v);
  };

  useEffect(() => {
    void refreshModelStatus().catch((e) => showErr(`Could not load model status: ${String(e)}`));
    void invoke<string>("get_onnx_provider").then(setProvider).catch((e) => showErr(`Could not load provider: ${String(e)}`));
    void invoke<ProviderRuntimeStatus>("get_provider_runtime_status")
      .then(setProviderStatus)
      .catch((e) => showErr(`Could not load provider runtime status: ${String(e)}`));
    const unlistenProvider = listen<ProviderRuntimeStatus>("provider-runtime-status", (event) => {
      setProviderStatus(event.payload);
    });
    return () => {
      unlistenProvider.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  async function startDownload() {
    if (downloading) return;
    unlistenRef.current?.();
    setDownloading(true);
    showInfo("Downloading model files...");
    unlistenRef.current = await listen("model-download-complete", () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setDownloading(false);
      void refreshModelStatus().catch((e) => showErr(`Could not refresh model status: ${String(e)}`));
      showOk("Model download complete.");
    });
    try {
      await invoke("download_model");
    } catch (e) {
      setDownloading(false);
      showErr(`Model download failed: ${String(e)}`);
    }
  }

  const refreshAllModelState = async () => {
    setRefreshing(true);
    try {
      await refreshModelStatus();
      const currentProvider = await invoke<string>("get_onnx_provider");
      setProvider(currentProvider);
      const runtimeStatus = await invoke<ProviderRuntimeStatus>("get_provider_runtime_status");
      setProviderStatus(runtimeStatus);
      showOk("Model and provider status refreshed.");
    } catch (e) {
      showErr(`Failed to refresh model status: ${String(e)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const onProviderChange = async (next: string) => {
    setProviderBusy(true);
    try {
      await invoke("set_onnx_provider", { provider: next });
      setProvider(next);
      setProviderStatus({ requested: next, effective: "starting", message: "Reinitializing worker…" });
      showOk("Provider updated. Worker is reinitializing.");
    } catch (e) {
      showErr(`Failed to set provider: ${String(e)}`);
    } finally {
      setProviderBusy(false);
    }
  };

  const activeMatchesRequested =
    providerStatus != null &&
    providerStatus.effective === providerStatus.requested;

  return (
    <div className="wv-pane">
      <PaneHeader title="Model" subtitle="Local transcription model running fully on-device." />
      <SettingsSection title="Local model">
        <SettingsRow label="Parakeet TDT 0.6B v3" hint="Required for on-device transcription." last>
          {status?.all_present ? (
            <StatusBadge tone="ok">Installed</StatusBadge>
          ) : (
            <Button onClick={() => void startDownload()} busy={downloading} busyLabel="Downloading...">
              Download
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Inference provider">
        <SettingsRow label="Backend" hint="Restart app after changing.">
          <select className="wv-select" value={provider} onChange={(e) => void onProviderChange(e.target.value)} disabled={providerBusy}>
            <option value="cpu">CPU (always works)</option>
            <option value="cuda">CUDA (NVIDIA GPU)</option>
            <option value="directml">DirectML (Windows GPU)</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Requested">
          <span className="wv-note">{providerStatus?.requested ?? "—"}</span>
        </SettingsRow>
        <SettingsRow label="Active">
          {providerStatus ? (
            <StatusBadge tone={activeMatchesRequested ? "ok" : "warn"}>
              {providerStatus.effective}
            </StatusBadge>
          ) : (
            <StatusBadge tone="info">Unknown</StatusBadge>
          )}
        </SettingsRow>
        <SettingsRow label="Refresh status" last>
          <Button
            variant="ghost"
            onClick={() => void refreshAllModelState()}
            disabled={providerBusy || downloading}
            busy={refreshing}
            busyLabel="Refreshing..."
          >
            Refresh Status
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function ShortcutTab() {
  const [recordingShortcut, setRecordingShortcut] = useState(DEFAULT_SHORTCUT);
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null);
  const [capturedShortcut, setCapturedShortcut] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null);
  const { showErr, showInfo, showOk } = useToast();

  const refresh = async () => {
    const [shortcut, status] = await Promise.all([
      invoke<string>("get_shortcut"),
      invoke<ShortcutStatus>("get_shortcut_status"),
    ]);
    setRecordingShortcut(shortcut);
    setShortcutStatus(status);
  };

  useEffect(() => {
    void refresh().catch((e) => showErr(`Could not load shortcut settings: ${String(e)}`));
  }, []);

  const applyShortcut = async (candidate: string) => {
    setSaveBusy(true);
    try {
      await invoke("set_shortcut", { shortcut: candidate });
      setRecordingShortcut(candidate);
      setPendingShortcut(null);
      setCapturedShortcut(candidate);
      showOk(`Shortcut saved: ${candidate}`);
      try { await refresh(); } catch { /* status refresh is best-effort */ }
    } catch (e) {
      showErr(`Failed to save shortcut: ${String(e)}`);
    } finally {
      setSaveBusy(false);
    }
  };

  useEffect(() => {
    if (!captureMode) return;
    let fired = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (fired) return;
      fired = true;
      e.preventDefault();
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) {
        showErr("Could not capture this shortcut. Try a different key combination.");
        return;
      }
      setPendingShortcut(normalized);
      setCapturedShortcut(normalized);
      setCaptureMode(false);
      showInfo(`Captured: ${normalized}. Saving...`);
      void applyShortcut(normalized);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureMode]);

  const resetDefault = async () => {
    setSaveBusy(true);
    try {
      await invoke("set_shortcut", { shortcut: DEFAULT_SHORTCUT });
      setRecordingShortcut(DEFAULT_SHORTCUT);
      setPendingShortcut(null);
      setCapturedShortcut(DEFAULT_SHORTCUT);
      showOk(`Shortcut reset to ${DEFAULT_SHORTCUT}.`);
      try { await refresh(); } catch { /* status refresh is best-effort */ }
    } catch (e) {
      showErr(`Failed to reset shortcut: ${String(e)}`);
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Shortcut" subtitle="Global shortcut for recording." />
      <SettingsSection>
        <SettingsRow label="Start / Stop recording" hint="Capture a key combo and save it as your global shortcut.">
          <div className="wv-inline wv-inline-stack">
            {captureMode ? (
              <div className="wv-capture-indicator">
                <span className="wv-capture-ring" />
                Press any key…
              </div>
            ) : (
              <span className="wv-kbd">{pendingShortcut ?? capturedShortcut ?? recordingShortcut}</span>
            )}
            <div className="wv-inline">
              {!captureMode && (
                <Button onClick={() => setCaptureMode(true)} disabled={saveBusy}>
                  Change Shortcut
                </Button>
              )}
              {captureMode && (
                <Button variant="ghost" onClick={() => { setCaptureMode(false); setPendingShortcut(null); }}>
                  Cancel
                </Button>
              )}
              {!captureMode && (
                <Button variant="ghost" onClick={() => void resetDefault()} disabled={saveBusy}>
                  Reset Default
                </Button>
              )}
            </div>
          </div>
        </SettingsRow>
        <SettingsRow label="Registration status" last>
          {shortcutStatus ? (
            <StatusBadge tone={shortcutStatus.registered ? "ok" : "err"}>
              {shortcutStatus.registered ? "Registered" : "Not registered"}
            </StatusBadge>
          ) : (
            <StatusBadge tone="info">Unknown</StatusBadge>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function MicrophoneTab({ accent, onAccentChange }: { accent: string; onAccentChange: (value: string) => void }) {
  const [devices, setDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("System Default");
  const [debugMicLevel, setDebugMicLevel] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [meterBusy, setMeterBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const colorDebounceRef = useRef<number | null>(null);
  const { showErr, showOk } = useToast();

  useEffect(() => {
    return () => {
      if (colorDebounceRef.current !== null) {
        window.clearTimeout(colorDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void invoke<{ selected_device?: string; devices: string[] }>("get_audio_input_info")
      .then((info) => {
        setDevices(info.devices || []);
        setSelectedDevice(info.selected_device || "System Default");
      })
      .catch((e) => showErr(`Could not load microphone list: ${String(e)}`));

    void invoke<boolean>("get_debug_mic_level")
      .then(setDebugMicLevel)
      .catch((e) => showErr(`Could not load level meter setting: ${String(e)}`));
  }, []);

  const changeDevice = async (v: string) => {
    setDeviceBusy(true);
    try {
      await invoke("set_audio_input_device", { deviceName: v === "System Default" ? null : v });
      setSelectedDevice(v);
      showOk("Microphone updated.");
    } catch (e) {
      showErr(`Failed to set microphone: ${String(e)}`);
    } finally {
      setDeviceBusy(false);
    }
  };

  const toggleLevelMeter = async () => {
    const next = !debugMicLevel;
    setMeterBusy(true);
    try {
      await invoke("set_debug_mic_level", { enabled: next });
      setDebugMicLevel(next);
      showOk(`Level meter ${next ? "enabled" : "disabled"}.`);
    } catch (e) {
      showErr(`Failed to change level meter: ${String(e)}`);
    } finally {
      setMeterBusy(false);
    }
  };

  const testMicrophone = async () => {
    setTestBusy(true);
    try {
      const result = await invoke<{ ok: boolean; message: string }>("test_microphone");
      if (result.ok) showOk(result.message);
      else showErr(result.message);
    } catch (e) {
      showErr(`Microphone test failed: ${String(e)}`);
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Microphone" subtitle="Input behavior and live recording diagnostics." />
      <SettingsSection title="Input device">
        <SettingsRow label="Microphone">
          <select className="wv-select" value={selectedDevice} onChange={(e) => void changeDevice(e.target.value)} disabled={deviceBusy}>
            <option>System Default</option>
            {devices.map((d) => <option key={d}>{d}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label="Waveform accent">
          <input
            type="color"
            className="wv-color"
            value={accent}
            onChange={(e) => {
              const c = e.target.value;
              onAccentChange(c);
              if (colorDebounceRef.current !== null) window.clearTimeout(colorDebounceRef.current);
              colorDebounceRef.current = window.setTimeout(() => {
                void invoke("set_waveform_color", { color: c })
                  .then(() => showOk("Waveform accent updated."))
                  .catch((err) => showErr(`Failed to update waveform accent: ${String(err)}`));
              }, 200);
            }}
          />
        </SettingsRow>
        <SettingsRow label="Show level meter" hint="Display live microphone level while recording." last>
          <ToggleSwitch
            label="Show level meter"
            on={debugMicLevel}
            onToggle={() => void toggleLevelMeter()}
            disabled={meterBusy}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Test">
        <SettingsRow label="Microphone test" hint="Checks whether VoiceNote can see an input device." last>
          <Button onClick={() => void testMicrophone()} busy={testBusy} busyLabel="Testing...">
            Test Microphone
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function AppearanceTab({ accent, onAccentChange }: { accent: string; onAccentChange: (value: string) => void }) {
  const colors = ["#0A84FF", "#30D158", "#BF5AF2", "#FF9F0A", "#FF375F"];
  const [busy, setBusy] = useState(false);
  const [colorBusy, setColorBusy] = useState(false);
  const { showErr, showOk } = useToast();

  const resetVoicebarPosition = async () => {
    setBusy(true);
    try {
      await invoke("reset_voicebar_position");
      showOk("Voicebar position reset.");
    } catch (e) {
      showErr(`Failed to reset voicebar position: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Appearance" subtitle="Theme accents and display preferences." />
      <SettingsSection title="Accent color">
        <SettingsRow label="Preset colors" last>
          <div className="wv-swatches">
            {colors.map((c) => (
              <button
                type="button"
                key={c}
                className="wv-swatch"
                data-active={accent === c ? "1" : "0"}
                style={{ background: c }}
                aria-label={`Set accent color ${c}`}
                onClick={() => {
                  if (colorBusy) return;
                  setColorBusy(true);
                  onAccentChange(c);
                  void invoke("set_waveform_color", { color: c })
                    .then(() => showOk("Accent color updated."))
                    .catch((err) => showErr(`Failed to update accent color: ${String(err)}`))
                    .finally(() => setColorBusy(false));
                }}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Voicebar">
        <SettingsRow label="Position" hint="Move the floating voicebar back to the center of the screen." last>
          <Button variant="ghost" busy={busy} busyLabel="Resetting…" onClick={() => void resetVoicebarPosition()}>
            Reset Position
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function DiagnosticsTab() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [running, setRunning] = useState(false);
  const { showErr, showInfo } = useToast();

  const runHealthCheck = async () => {
    setRunning(true);
    try {
      const result = await invoke<HealthStatus>("run_health_check");
      setHealth(result);
      showInfo("Health check complete.");
    } catch (e) {
      setHealth(null);
      showErr(`Health check failed: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Diagnostics" subtitle="Check local runtime dependencies used for transcription." />
      <SettingsSection title="Health check">
        <SettingsRow label="Worker runtime" hint={health?.worker_exists === false ? "Worker executable is missing. Reinstall the app or restore the worker file." : "Required for local transcription."}>
          {health ? <StatusBadge tone={health.worker_exists ? "ok" : "err"}>{health.worker_exists ? "Ready" : "Missing"}</StatusBadge> : <StatusBadge tone="info">Not checked</StatusBadge>}
        </SettingsRow>
        <SettingsRow label="Model files" hint={health?.model_exists === false ? "Model files are missing. Open Model and download the local model." : "Required before transcription can run."}>
          {health ? <StatusBadge tone={health.model_exists ? "ok" : "err"}>{health.model_exists ? "Ready" : "Missing"}</StatusBadge> : <StatusBadge tone="info">Not checked</StatusBadge>}
        </SettingsRow>
        <SettingsRow label="Run health check" last>
          <Button onClick={() => void runHealthCheck()} busy={running} busyLabel="Running...">
            Run
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function AboutTab({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <div className="wv-pane">
      <PaneHeader title="About" subtitle="Version and application information." />
      <SettingsSection title="App info">
        <SettingsRow label="Application">
          <span className="wv-note">VoiceNote</span>
        </SettingsRow>
        <SettingsRow label="Version">
          <span className="wv-note">0.1.0</span>
        </SettingsRow>
        <SettingsRow label="Runtime" last>
          <span className="wv-note">Tauri 2 · Parakeet TDT</span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Troubleshooting">
        <SettingsRow label="Diagnostics" hint="View worker and model health checks." last>
          <Button onClick={() => onNavigate("diagnostics")}>Open Diagnostics</Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
