import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AiDefaultMode, AiSettings, HealthStatus, Page, ProfileInfo, ProviderRuntimeStatus, ShortcutStatus } from "./settingsTypes";
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
  ai: "ai",
  appearance: "appearance",
  ai: "ai",
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
    void getCurrentWindow().setFocus();
  }, []);

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
            <div style={{ display: page === "ai" ? "" : "none" }}><AiTab /></div>
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

function ChoiceGroup({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="wv-choice-group" data-compact={compact ? "1" : "0"}>
      {children}
    </div>
  );
}

function ChoiceButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="wv-choice-btn"
      data-active={active ? "1" : "0"}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}


function Sidebar({ active, onSelect }: { active: Page; onSelect: (page: Page) => void }) {
  const tabs: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
    { id: "general", label: "General", icon: <GearIcon /> },
    { id: "shortcut", label: "Shortcut", icon: <KeyboardIcon /> },
    { id: "microphone", label: "Microphone", icon: <MicIcon /> },
    { id: "model", label: "Model", icon: <BoxIcon /> },
    { id: "ai", label: "AI", icon: <ActivityIcon /> },
    { id: "appearance", label: "Appearance", icon: <PaletteIcon /> },
    { id: "ai", label: "AI ✦", icon: <span style={{ fontSize: "13px" }}>✦</span> },
    { id: "diagnostics", label: "Diagnostics", icon: <ActivityIcon /> },
    { id: "about", label: "About", icon: <InfoIcon /> },
  ];

  return (
    <aside className="wv-sidebar">
      <div className="wv-sidebar-head">
        <span className="wv-brand-mark"><MicIcon /></span>
        <div className="wv-brand-block">
          <div className="wv-brand-name">VoiceNote</div>
          <div className="wv-brand-ver">Version 0.1.0</div>
        </div>
      </div>
      <nav className="wv-nav">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.id}
            className="wv-nav-item"
            data-active={t.id === active ? "1" : "0"}
            aria-current={t.id === active ? "page" : undefined}
            onClick={() => onSelect(t.id)}
          >
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

function AiTab() {
  const aiLanguages = ["English", "Danish", "German", "French", "Spanish"] as const;
  const presetOptions: Array<{ value: AiPreset; label: string }> = [
    { value: "raw", label: "Raw" },
    { value: "clean", label: "Clean" },
    { value: "professional", label: "Professional" },
    { value: "translate", label: "Translate" },
    { value: "clean_translate", label: "Clean + Translate" },
  ];
  const providerOptions: Array<{ value: AiProvider; label: string }> = [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
  ];
  const modelOptions: Array<{ value: AiModel; label: string; provider: AiProvider }> = [
    { value: "gpt-5-mini", label: "GPT-5 mini", provider: "openai" },
    { value: "gpt-5-nano", label: "GPT-5 nano", provider: "openai" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", provider: "gemini" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini" },
  ];
  const [settings, setSettings] = useState<AiSettingsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [openAiInput, setOpenAiInput] = useState("");
  const [geminiInput, setGeminiInput] = useState("");
  const { showErr, showOk, showInfo } = useToast();

  const refresh = async () => {
    const next = await invoke<AiSettingsPayload>("get_ai_settings");
    setSettings(next);
  };

  useEffect(() => {
    void refresh().catch((e) => showErr(`Could not load AI settings: ${String(e)}`));
  }, []);

  const requiresProvider = (preset: AiPreset) => preset !== "raw";
  const requiresTargetLanguage = (preset: AiPreset) => preset === "translate" || preset === "clean_translate";
  const isAiPreset = (value: string): value is AiPreset =>
    value === "raw" || value === "clean" || value === "professional" || value === "translate" || value === "clean_translate";
  const isAiProvider = (value: string): value is AiProvider => value === "openai" || value === "gemini";
  const isAiModel = (value: string): value is AiModel =>
    modelOptions.some((option) => option.value === value);
  const isSupportedLanguage = (value: string): value is (typeof aiLanguages)[number] =>
    aiLanguages.includes(value as (typeof aiLanguages)[number]);
  const getSavedKeyMask = (provider: AiProvider | null, currentSettings: AiSettingsPayload | null) => {
    if (provider === "openai") return currentSettings?.openai_key ?? null;
    if (provider === "gemini") return currentSettings?.gemini_key ?? null;
    return null;
  };
  const providerLabel = (provider: AiProvider) => (provider === "openai" ? "OpenAI" : "Gemini");
  const selectedProvider = settings?.provider ?? null;
  const compatibleModelOptions = selectedProvider
    ? modelOptions.filter((option) => option.provider === selectedProvider)
    : modelOptions;

  const updatePreset = async (presetValue: string) => {
    if (!isAiPreset(presetValue)) {
      showErr("Unsupported AI preset.");
      return;
    }
    const preset = presetValue;
    const provider = settings?.provider ?? null;
    const targetLanguage = settings?.target_language ?? null;
    
    let warning = null;
    if (requiresProvider(preset) && !provider) {
      warning = "Remember to select an AI provider.";
    } else if (provider && requiresProvider(preset) && !getSavedKeyMask(provider, settings)) {
      warning = `Remember to save a${provider === "openai" ? "n" : ""} ${providerLabel(provider)} API key.`;
    } else if (requiresTargetLanguage(preset) && !targetLanguage) {
      warning = "Remember to select a target language.";
    }

    setSettings((s) => (s ? { ...s, preset } : null));
    setBusy(true);
    try {
      await invoke("set_ai_preset", { preset });
      await refresh();
      if (warning) {
         showInfo(warning);
      } else {
         showOk("AI preset updated.");
      }
    } catch (e) {
      showErr(`Failed to update AI preset: ${String(e)}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const updateProvider = async (providerValue: string | null) => {
    if (providerValue != null && !isAiProvider(providerValue)) {
      showErr("Unsupported AI provider.");
      return;
    }
    const provider = providerValue;
    
    let warning = null;
    if (!provider && settings != null && requiresProvider(settings.preset)) {
      warning = "Remember to select Raw mode if you don't want AI processing.";
    } else if (provider && settings != null && requiresProvider(settings.preset) && !getSavedKeyMask(provider, settings)) {
      warning = `Remember to save a${provider === "openai" ? "n" : ""} ${providerLabel(provider)} API key.`;
    }

    setSettings((s) => (s ? { ...s, provider } : null));
    setBusy(true);
    try {
      await invoke("set_ai_provider", { provider });
      await refresh();
      if (warning) showInfo(warning);
      else showOk("AI provider updated.");
    } catch (e) {
      showErr(`Failed to update AI provider: ${String(e)}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const updateModel = async (modelValue: string) => {
    if (!isAiModel(modelValue)) {
      showErr("Unsupported AI model.");
      return;
    }
    const model = modelValue;
    const provider = modelOptions.find((option) => option.value === model)?.provider ?? null;

    setSettings((s) => (s ? { ...s, provider, model } : null));
    setBusy(true);
    try {
      await invoke("set_ai_model", { model });
      await refresh();
      showOk("AI model updated.");
    } catch (e) {
      showErr(`Failed to update AI model: ${String(e)}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const updateTargetLanguage = async (language: AiSettingsPayload["target_language"]) => {
    const nextLanguage = language?.trim() || null;
    if (nextLanguage && !isSupportedLanguage(nextLanguage)) {
      showErr("Unsupported target language.");
      return;
    }
    
    let warning = null;
    if (!nextLanguage && settings != null && requiresTargetLanguage(settings.preset)) {
      warning = "Remember to select a target language for translation.";
    }

    setSettings((s) => (s ? { ...s, target_language: nextLanguage } : null));
    setBusy(true);
    try {
      await invoke("set_ai_target_language", { language: nextLanguage });
      await refresh();
      if (warning) showInfo(warning);
      else showOk("Target language updated.");
    } catch (e) {
      showErr(`Failed to update target language: ${String(e)}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveOpenAiKey = async () => {
    const token = openAiInput.trim();
    if (!token) return;
    setBusy(true);
    try {
      await invoke("set_openai_api_key", { token });
      setOpenAiInput("");
      await refresh();
      showOk("OpenAI key saved.");
    } catch (e) {
      showErr(`Failed to save OpenAI key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveGeminiKey = async () => {
    const token = geminiInput.trim();
    if (!token) return;
    setBusy(true);
    try {
      await invoke("set_gemini_api_key", { token });
      setGeminiInput("");
      await refresh();
      showOk("Gemini key saved.");
    } catch (e) {
      showErr(`Failed to save Gemini key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteOpenAiKey = async () => {
    setBusy(true);
    try {
      await invoke("set_openai_api_key", { token: null });
      setOpenAiInput("");
      await refresh();
      showOk("OpenAI key deleted.");
    } catch (e) {
      showErr(`Failed to delete OpenAI key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteGeminiKey = async () => {
    setBusy(true);
    try {
      await invoke("set_gemini_api_key", { token: null });
      setGeminiInput("");
      await refresh();
      showOk("Gemini key deleted.");
    } catch (e) {
      showErr(`Failed to delete Gemini key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const preset = settings?.preset ?? "raw";
  const loading = settings === null;
  const controlsDisabled = busy || loading;
  const translationEnabled = requiresTargetLanguage(preset);
  const openAiKeyDraft = openAiInput.trim();
  const geminiKeyDraft = geminiInput.trim();
  const openAiKeyMask = settings?.openai_key;
  const geminiKeyMask = settings?.gemini_key;

  return (
    <div className="wv-pane">
      <PaneHeader title="AI" subtitle="Optional transcript cleanup and translation before paste." />
      <SettingsSection title="Processing">
        <SettingsRow label="Preset" hint="Raw stays fully local. Other modes send transcript text to your selected provider.">
          <ChoiceGroup>
            {presetOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                active={preset === option.value}
                onClick={() => void updatePreset(option.value)}
                disabled={controlsDisabled}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </ChoiceGroup>
        </SettingsRow>
        <SettingsRow label="Provider" hint="Only used when preset is not Raw.">
          <ChoiceGroup compact>
            <ChoiceButton
              active={(settings?.provider ?? null) === null}
              onClick={() => void updateProvider(null)}
              disabled={controlsDisabled}
            >
              None
            </ChoiceButton>
            {providerOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                active={settings?.provider === option.value}
                onClick={() => void updateProvider(option.value)}
                disabled={controlsDisabled}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </ChoiceGroup>
        </SettingsRow>
        <SettingsRow label="Model" hint={selectedProvider ? "Used for cleanup and translation with the selected provider." : "Choose a provider first, or pick any model to set it automatically."}>
          <ChoiceGroup>
            {compatibleModelOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                active={settings?.model === option.value}
                onClick={() => void updateModel(option.value)}
                disabled={controlsDisabled}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </ChoiceGroup>
        </SettingsRow>
        <SettingsRow
          label="Target language"
          hint={translationEnabled ? "Required for translation presets." : "Optional until you enable translation."}
        >
          <ChoiceGroup compact>
            <ChoiceButton
              active={(settings?.target_language ?? null) === null}
              onClick={() => void updateTargetLanguage(null)}
              disabled={controlsDisabled}
            >
              None
            </ChoiceButton>
            {aiLanguages.map((language) => (
              <ChoiceButton
                key={language}
                active={settings?.target_language === language}
                onClick={() => void updateTargetLanguage(language)}
                disabled={controlsDisabled}
              >
                {language}
              </ChoiceButton>
            ))}
          </ChoiceGroup>
        </SettingsRow>
        <SettingsRow label="Privacy" hint="AI presets send transcript text only. Audio stays local." last>
          <StatusBadge tone={preset === "raw" ? "ok" : "warn"}>
            {preset === "raw" ? "Local only" : "Transcript sent to provider"}
          </StatusBadge>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Provider keys">
        <SettingsRow
          label="OpenAI key"
          hint={openAiKeyMask ? `Saved mask: ${openAiKeyMask}` : "No key saved yet."}
        >
          <div className="wv-inline wv-inline-stack wv-input-stack">
            <input
              className="wv-input"
              type="password"
              value={openAiInput}
              onChange={(e) => setOpenAiInput(e.target.value)}
              placeholder="sk-..."
              disabled={loading}
            />
            <div className="wv-inline wv-action-row">
              <Button onClick={() => void saveOpenAiKey()} disabled={controlsDisabled || openAiKeyDraft.length === 0}>Save</Button>
              <Button variant="danger" onClick={() => void deleteOpenAiKey()} disabled={controlsDisabled || openAiKeyMask == null}>Delete</Button>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Gemini key"
          hint={geminiKeyMask ? `Saved mask: ${geminiKeyMask}` : "No key saved yet."}
          last
        >
          <div className="wv-inline wv-inline-stack wv-input-stack">
            <input
              className="wv-input"
              type="password"
              value={geminiInput}
              onChange={(e) => setGeminiInput(e.target.value)}
              placeholder="AIza..."
              disabled={loading}
            />
            <div className="wv-inline wv-action-row">
              <Button onClick={() => void saveGeminiKey()} disabled={controlsDisabled || geminiKeyDraft.length === 0}>Save</Button>
              <Button variant="danger" onClick={() => void deleteGeminiKey()} disabled={controlsDisabled || geminiKeyMask == null}>Delete</Button>
            </div>
          </div>
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

const AI_MODES: Array<{ value: AiDefaultMode; label: string; hint: string }> = [
  { value: "raw",           label: "Raw",             hint: "Paste transcript as-is" },
  { value: "clean",         label: "Clean",           hint: "Fix grammar & punctuation" },
  { value: "translate",     label: "Translate",       hint: "Translate to English" },
  { value: "clean_translate", label: "Clean + Translate", hint: "Fix grammar, then translate" },
];

function AiTab() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  // capturingFor holds the profile_id that is waiting for a hotkey press
  const [capturingFor, setCapturingFor] = useState<string | null>(null);
  const { showErr, showOk, showInfo } = useToast();

  const load = async () => {
    const [s, p] = await Promise.all([
      invoke<AiSettings>("get_ai_settings"),
      invoke<ProfileInfo[]>("get_profiles"),
    ]);
    setSettings(s);
    setProfiles(p);
  };

  useEffect(() => {
    void load().catch((e) => showErr(`Could not load AI settings: ${String(e)}`));
  }, []);

  // Hotkey capture listener — mirrors ShortcutTab's captureMode pattern
  useEffect(() => {
    if (!capturingFor) return;
    let fired = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (fired) return;
      fired = true;
      e.preventDefault();
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) {
        showErr("Could not capture this shortcut. Try a different key combination.");
        setCapturingFor(null);
        return;
      }
      const profileId = capturingFor;
      setCapturingFor(null);
      showInfo(`Captured: ${normalized}. Saving…`);
      void (async () => {
        setBusy(true);
        try {
          await invoke("set_profile_hotkey", { profileId, hotkey: normalized });
          setProfiles((ps) =>
            ps.map((p) => (p.id === profileId ? { ...p, hotkey: normalized } : p))
          );
          showOk(`Hotkey ${normalized} assigned.`);
        } catch (ex) {
          showErr(String(ex));
        } finally {
          setBusy(false);
        }
      })();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capturingFor]);

  const saveDefaultMode = async (mode: AiDefaultMode) => {
    setBusy(true);
    try {
      await invoke("set_ai_default_mode", { mode });
      setSettings((s) => (s ? { ...s, default_mode: mode } : s));
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBackend = async (backend: AiSettings["backend"]) => {
    setBusy(true);
    try {
      await invoke("set_ai_backend", { backend });
      setSettings((s) => (s ? { ...s, backend } : s));
      showOk("Backend updated.");
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput) return;
    setBusy(true);
    try {
      await invoke("set_ai_api_key", { key: apiKeyInput });
      setApiKeyInput("");
      setSettings((s) => (s ? { ...s, api_key_masked: "••••••••••••••••" } : s));
      showOk("API key saved.");
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async (model: string) => {
    if (!model.trim()) return;
    setBusy(true);
    try {
      await invoke("set_ai_model", { model: model.trim() });
      setSettings((s) => (s ? { ...s, model: model.trim() } : s));
      showOk("Model updated.");
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveOllamaUrl = async (url: string) => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await invoke("set_ai_ollama_url", { url: url.trim() });
      setSettings((s) => (s ? { ...s, ollama_url: url.trim() } : s));
      showOk("Ollama URL saved.");
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearHotkey = async (profileId: string) => {
    setBusy(true);
    try {
      await invoke("set_profile_hotkey", { profileId, hotkey: null });
      setProfiles((ps) => ps.map((p) => (p.id === profileId ? { ...p, hotkey: null } : p)));
      showOk("Hotkey cleared.");
    } catch (e) {
      showErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="wv-pane">
        <PaneHeader title="AI" subtitle="Post-processing profiles." />
        <div className="wv-note" style={{ padding: "16px" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="wv-pane">
      <PaneHeader title="AI ✦" subtitle="Reshape transcripts automatically after every recording." />

      <SettingsSection title="Default processing">
        <SettingsRow label="Output mode" hint="Applied to every recording. Profile hotkeys override this." last>
          <div className="wv-seg">
            {AI_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className="wv-seg-btn"
                data-active={settings.default_mode === m.value ? "1" : "0"}
                disabled={busy}
                title={m.hint}
                onClick={() => void saveDefaultMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="AI Backend">
        <SettingsRow label="Provider">
          <select
            className="wv-select"
            value={settings.backend}
            disabled={busy}
            onChange={(e) => void saveBackend(e.target.value as AiSettings["backend"])}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Local (Ollama)</option>
          </select>
        </SettingsRow>

        {settings.backend !== "ollama" && (
          <>
            <SettingsRow label="API Key" hint="Stored securely in the OS keyring — never written to disk.">
              <input
                className="wv-input"
                type="password"
                placeholder={settings.api_key_masked || "sk-…"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                disabled={busy}
                style={{ width: "160px" }}
              />
              <Button onClick={() => void saveApiKey()} disabled={busy || !apiKeyInput}>
                Save
              </Button>
            </SettingsRow>
            <SettingsRow label="Model" hint='e.g. "gpt-4o-mini" or "claude-3-haiku-20240307"' last>
              <input
                className="wv-input"
                type="text"
                defaultValue={settings.model}
                disabled={busy}
                onBlur={(e) => void saveModel(e.target.value)}
                style={{ width: "200px" }}
              />
            </SettingsRow>
          </>
        )}

        {settings.backend === "ollama" && (
          <>
            <SettingsRow label="Ollama URL">
              <input
                className="wv-input"
                type="text"
                defaultValue={settings.ollama_url}
                disabled={busy}
                onBlur={(e) => void saveOllamaUrl(e.target.value)}
                style={{ width: "200px" }}
              />
            </SettingsRow>
            <SettingsRow label="Model" hint='e.g. "llama3"' last>
              <input
                className="wv-input"
                type="text"
                defaultValue={settings.model}
                disabled={busy}
                onBlur={(e) => void saveModel(e.target.value)}
                style={{ width: "200px" }}
              />
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Profiles — assign a hotkey to activate during recording">
        {profiles.map((profile, idx) => (
          <SettingsRow
            key={profile.id}
            label={profile.name}
            last={idx === profiles.length - 1}
          >
            {capturingFor === profile.id ? (
              <div className="wv-capture-indicator">
                <span className="wv-capture-ring" />
                Press any key…
              </div>
            ) : profile.hotkey ? (
              <div className="wv-inline">
                <span className="wv-kbd">{profile.hotkey}</span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void clearHotkey(profile.id)}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                disabled={busy || capturingFor !== null}
                onClick={() => setCapturingFor(profile.id)}
              >
                + Assign hotkey
              </Button>
            )}
            {capturingFor === profile.id && (
              <Button
                variant="ghost"
                onClick={() => setCapturingFor(null)}
              >
                Cancel
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsSection>
    </div>
  );
}
