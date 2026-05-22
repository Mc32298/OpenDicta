# Settings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully overhaul the Settings window — fix feedback UX (global toast system), reorganize all tabs to use shared SettingsSection/SettingsRow components, expose two unused backend settings (recording profile, completion sound), and tighten visual polish.

**Architecture:** A new `src/ui/toast.tsx` provides `ToastProvider` (wraps `<main>` in Settings root) and `useToast` hook (called by each tab). Settings.tsx is updated tab-by-tab in sequence, each reading the file's current state before editing. VoiceBar.tsx gets the completion sound hook.

**Tech Stack:** React 18, TypeScript, Tauri 2, Vite. No new dependencies. No Rust changes needed — all required commands already exist.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/ui/toast.tsx` | **Create** | `ToastProvider`, `ToastContext`, `useToast` |
| `src/styles.css` | **Modify** | Toast CSS, capture indicator CSS, visual polish (sidebar/main/group/row colors) |
| `src/windows/Settings.tsx` | **Modify** | All 7 tabs + Settings root (ToastProvider wrap, onNavigate wire) |
| `src/windows/VoiceBar.tsx` | **Modify** | Completion sound on `transcript-ready` |

---

## Task 1: Toast system + CSS foundations

**Files:**
- Create: `src/ui/toast.tsx`
- Modify: `src/styles.css`

### Steps

- [ ] **Step 1: Create `src/ui/toast.tsx`**

Create the file with this exact content:

```tsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastTone = "ok" | "err" | "info";

interface ToastState {
  text: string;
  tone: ToastTone;
}

interface ToastCtx {
  showOk: (text: string) => void;
  showErr: (text: string) => void;
  showInfo: (text: string) => void;
}

const ToastContext = createContext<ToastCtx>({
  showOk: () => {},
  showErr: () => {},
  showInfo: () => {},
});

export function useToast(): ToastCtx {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback((text: string, tone: ToastTone) => {
    clearTimer();
    setExiting(false);
    setToast({ text, tone });
    const delay = tone === "err" ? 6000 : 3000;
    timerRef.current = window.setTimeout(() => {
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        setExiting(false);
      }, 300);
    }, delay);
  }, []);

  useEffect(() => () => clearTimer(), []);

  const showOk = useCallback((t: string) => show(t, "ok"), [show]);
  const showErr = useCallback((t: string) => show(t, "err"), [show]);
  const showInfo = useCallback((t: string) => show(t, "info"), [show]);

  return (
    <ToastContext.Provider value={{ showOk, showErr, showInfo }}>
      {children}
      {toast && (
        <div
          className={`wv-toast wv-toast--${toast.tone}${exiting ? " wv-toast--out" : " wv-toast--in"}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="wv-toast-dot" />
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 2: Add toast CSS to `src/styles.css`**

Read `src/styles.css` first. Append the following block at the very end of the file:

```css
/* ── Toast ── */
.wv-toast {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  background: rgba(24,24,28,0.96);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.45);
  border: 1px solid transparent;
  z-index: 100;
}
.wv-toast--ok   { border-color: rgba(48,209,88,0.4);  color: #30D158; }
.wv-toast--err  { border-color: rgba(255,69,58,0.4);  color: #FF453A; }
.wv-toast--info { border-color: rgba(10,132,255,0.3); color: #0A84FF; }
.wv-toast-dot   { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

@keyframes wv-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@keyframes wv-toast-out { from { opacity: 1; } to { opacity: 0; } }
.wv-toast--in  { animation: wv-toast-in  200ms ease forwards; }
.wv-toast--out { animation: wv-toast-out 300ms ease forwards; }

/* ── Shortcut capture indicator ── */
.wv-capture-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(10,132,255,0.07);
  border: 1px solid rgba(10,132,255,0.4);
  border-radius: 8px;
  font-size: 12px;
  color: #0A84FF;
}
.wv-capture-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0A84FF;
  flex-shrink: 0;
  animation: wv-pulse 1.2s ease-in-out infinite;
}
@keyframes wv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.8); }
}
```

- [ ] **Step 3: Apply visual polish to existing CSS rules in `src/styles.css`**

Find and update these existing rules (use exact string replacement):

**Sidebar width + background** — find:
```css
.wv-sidebar {
  flex: 0 0 230px;
  width: 230px;
  background: rgba(28,28,30,0.92);
```
Replace with:
```css
.wv-sidebar {
  flex: 0 0 190px;
  width: 190px;
  background: #141418;
```

**Main content background + position relative** — find:
```css
.wv-main { flex: 1; min-width: 0; overflow: auto; background: #15151A; }
```
Replace with:
```css
.wv-main { flex: 1; min-width: 0; overflow: auto; background: #16161b; position: relative; }
```

**Group card background** — find:
```css
.wv-group-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; overflow: hidden; }
```
Replace with:
```css
.wv-group-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; overflow: hidden; }
```

**Row divider** — find:
```css
.wv-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
```
Replace with:
```css
.wv-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
```

**Group section title** — find:
```css
.wv-group-title { font-size: 11px; color: var(--text-faint); text-transform: uppercase; margin: 0 0 8px 4px; letter-spacing: .06em; }
```
Replace with:
```css
.wv-group-title { font-size: 10.5px; color: rgba(235,235,245,0.35); text-transform: uppercase; margin: 0 0 8px 4px; letter-spacing: .06em; }
```

**Pane title** — find:
```css
.wv-pane-title { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
```
Replace with:
```css
.wv-pane-title { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
```

Also update the responsive sidebar rule. Find:
```css
  .wv-sidebar { width: 200px; flex-basis: 200px; }
```
Replace with:
```css
  .wv-sidebar { width: 190px; flex-basis: 190px; }
```

- [ ] **Step 4: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors in `src/ui/toast.tsx`. (Settings.tsx will have errors until later tasks — that's OK at this stage if you haven't touched it yet. If tsc reports errors only from files you haven't modified, note them and continue.)

---

## Task 2: Settings root wiring + GeneralTab overhaul

**Files:**
- Modify: `src/windows/Settings.tsx`

**Context:** Settings.tsx is a single large file containing all tab components. This task: (a) replaces `ActionNotice`/`useActionNotice` with the global toast system, (b) wraps `<main className="wv-main">` with `ToastProvider`, (c) passes `onNavigate={setPage}` to `AboutTab`, (d) completely rewrites `GeneralTab`.

### Steps

- [ ] **Step 1: Read the current `src/windows/Settings.tsx`**

Read the full file so you have its current state before making any edits.

- [ ] **Step 2: Update the import line at the top of Settings.tsx**

Find:
```tsx
import { Button, Notice, SettingsRow, SettingsSection, StatusBadge, ToggleSwitch } from "../ui/controls";
```
Replace with:
```tsx
import { Button, Notice, SettingsRow, SettingsSection, StatusBadge, ToggleSwitch } from "../ui/controls";
import { ToastProvider, useToast } from "../ui/toast";
```

- [ ] **Step 3: Delete the `ActionNotice` component and `useActionNotice` hook**

Find and remove these two functions entirely (they span lines ~35–45 in the original file):
```tsx
function ActionNotice({ tone, text }: { tone: NoticeTone; text: string | null }) {
  return <Notice tone={tone}>{text}</Notice>;
}

function useActionNotice() {
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string | null }>({ tone: "info", text: null });
  const showInfo = (text: string) => setNotice({ tone: "info", text });
  const showOk = (text: string) => setNotice({ tone: "ok", text });
  const showErr = (text: string) => setNotice({ tone: "err", text });
  return { notice, showInfo, showOk, showErr };
}
```

Leave the `import type { ... } from "./settingsTypes"` line unchanged for now — `NoticeTone` cleanup happens in Task 6 once all tabs are updated.

- [ ] **Step 4: Update Settings() to wrap main with ToastProvider and pass onNavigate to AboutTab**

Find this block in the `Settings()` return:
```tsx
        <main className="wv-main">
          {page === "general" && <GeneralTab accent={accent} />}
          {page === "shortcut" && <ShortcutTab />}
          {page === "microphone" && <MicrophoneTab accent={accent} onAccentChange={setAccent} />}
          {page === "model" && <ModelTab />}
          {page === "appearance" && <AppearanceTab accent={accent} onAccentChange={setAccent} />}
          {page === "diagnostics" && <DiagnosticsTab />}
          {page === "about" && <AboutTab />}
        </main>
```
Replace with:
```tsx
        <ToastProvider>
          <main className="wv-main">
            {page === "general" && <GeneralTab />}
            {page === "shortcut" && <ShortcutTab />}
            {page === "microphone" && <MicrophoneTab accent={accent} onAccentChange={setAccent} />}
            {page === "model" && <ModelTab />}
            {page === "appearance" && <AppearanceTab accent={accent} onAccentChange={setAccent} />}
            {page === "diagnostics" && <DiagnosticsTab />}
            {page === "about" && <AboutTab onNavigate={setPage} />}
          </main>
        </ToastProvider>
```

- [ ] **Step 5: Replace the entire `GeneralTab` function**

Find the entire `GeneralTab` function (from `function GeneralTab` to its closing `}`) and replace with:

```tsx
function GeneralTab() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [profile, setProfile] = useState<string>("balanced");
  const [completionSound, setCompletionSound] = useState<boolean>(
    () => localStorage.getItem("settings.completionSound") === "true"
  );
  const [busy, setBusy] = useState(false);
  const { showErr, showOk } = useToast();

  useEffect(() => {
    void invoke<boolean>("get_autostart_enabled")
      .then(setLaunchAtLogin)
      .catch((e) => showErr(`Could not load launch-at-login: ${String(e)}`));
    void invoke<string>("get_runtime_profile")
      .then(setProfile)
      .catch((e) => showErr(`Could not load recording profile: ${String(e)}`));
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

  const toggleCompletionSound = () => {
    const next = !completionSound;
    setCompletionSound(next);
    localStorage.setItem("settings.completionSound", String(next));
    showOk(`Completion sound ${next ? "enabled" : "disabled"}.`);
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
          <ToggleSwitch label="Sound on completion" on={completionSound} onToggle={toggleCompletionSound} />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 6: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: errors only in tab functions not yet updated (ShortcutTab, ModelTab, MicrophoneTab, AppearanceTab, DiagnosticsTab, AboutTab — they still reference `useActionNotice`/`ActionNotice`). No errors in `GeneralTab` or the `Settings` root function. If there are unexpected errors in the root or GeneralTab, fix them before continuing.

---

## Task 3: ShortcutTab overhaul

**Files:**
- Modify: `src/windows/Settings.tsx`

**Context:** Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`, swap `useActionNotice` for `useToast`, add pulsing capture indicator, replace plain-text registration status with `StatusBadge`.

### Steps

- [ ] **Step 1: Read the current `src/windows/Settings.tsx`**

Read the full file to get its current state (previous tasks have already modified it).

- [ ] **Step 2: Replace the entire `ShortcutTab` function**

Find the entire `ShortcutTab` function (from `function ShortcutTab()` to its closing `}`) and replace with:

```tsx
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
      await refresh();
      showOk(`Shortcut saved: ${candidate}`);
    } catch (e) {
      showErr(`Failed to save shortcut: ${String(e)}`);
    } finally {
      setSaveBusy(false);
    }
  };

  useEffect(() => {
    if (!captureMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
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
      await refresh();
      showOk(`Shortcut reset to ${DEFAULT_SHORTCUT}.`);
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
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: `ShortcutTab` no longer errors. Remaining errors only in `ModelTab`, `MicrophoneTab`, `AppearanceTab`, `DiagnosticsTab`, `AboutTab`.

---

## Task 4: MicrophoneTab overhaul

**Files:**
- Modify: `src/windows/Settings.tsx`

**Context:** Add device selector (moved from GeneralTab), split into two `SettingsSection` groups (Input device / Test), swap `useActionNotice` for `useToast`, replace `Group`/`Row` with `SettingsSection`/`SettingsRow`.

### Steps

- [ ] **Step 1: Read the current `src/windows/Settings.tsx`**

- [ ] **Step 2: Replace the entire `MicrophoneTab` function**

Find the entire `MicrophoneTab` function and replace with:

```tsx
function MicrophoneTab({ accent, onAccentChange }: { accent: string; onAccentChange: (value: string) => void }) {
  const [devices, setDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("System Default");
  const [debugMicLevel, setDebugMicLevel] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showErr, showOk } = useToast();

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
    setBusy(true);
    try {
      await invoke("set_audio_input_device", { deviceName: v === "System Default" ? null : v });
      setSelectedDevice(v);
      showOk("Microphone updated.");
    } catch (e) {
      showErr(`Failed to set microphone: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const testMicrophone = async () => {
    setBusy(true);
    try {
      const result = await invoke<{ ok: boolean; message: string }>("test_microphone");
      if (result.ok) showOk(result.message);
      else showErr(result.message);
    } catch (e) {
      showErr(`Microphone test failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wv-pane">
      <PaneHeader title="Microphone" subtitle="Input behavior and live recording diagnostics." />
      <SettingsSection title="Input device">
        <SettingsRow label="Microphone">
          <select className="wv-select" value={selectedDevice} onChange={(e) => void changeDevice(e.target.value)} disabled={busy}>
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
              localStorage.setItem("settings.waveColor", c);
              void invoke("set_waveform_color", { color: c })
                .then(() => showOk("Waveform accent updated."))
                .catch((err) => showErr(`Failed to update waveform accent: ${String(err)}`));
            }}
          />
        </SettingsRow>
        <SettingsRow label="Show level meter" hint="Display live microphone level while recording." last>
          <ToggleSwitch
            label="Show level meter"
            on={debugMicLevel}
            onToggle={() => {
              const next = !debugMicLevel;
              setBusy(true);
              void invoke("set_debug_mic_level", { enabled: next })
                .then(() => {
                  setDebugMicLevel(next);
                  showOk(`Level meter ${next ? "enabled" : "disabled"}.`);
                })
                .catch((e) => showErr(`Failed to change level meter: ${String(e)}`))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Test">
        <SettingsRow label="Microphone test" hint="Checks whether VoiceNote can see an input device." last>
          <Button onClick={() => void testMicrophone()} busy={busy} busyLabel="Testing...">
            Test Microphone
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: `MicrophoneTab` no longer errors. Remaining errors only in `ModelTab`, `AppearanceTab`, `DiagnosticsTab`, `AboutTab`.

---

## Task 5: ModelTab overhaul

**Files:**
- Modify: `src/windows/Settings.tsx`

**Context:** Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`, swap `useActionNotice` for `useToast`, split the provider status dense line into two labeled rows (Requested / Active), and show `StatusBadge tone="ok"` for installed model instead of a disabled button.

### Steps

- [ ] **Step 1: Read the current `src/windows/Settings.tsx`**

- [ ] **Step 2: Replace the entire `ModelTab` function**

Find the entire `ModelTab` function and replace with:

```tsx
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
      unlistenRef.current?.();
      unlistenProvider.then((fn) => fn());
    };
  }, []);

  async function startDownload() {
    setDownloading(true);
    showInfo("Downloading model files...");
    unlistenRef.current = await listen("model-download-complete", () => {
      setDownloading(false);
      void refreshModelStatus();
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
      setProviderStatus({ requested: next, effective: "unknown", message: "Provider changed. Restart app to apply." });
      showOk("Provider updated. Restart app to fully apply.");
    } catch (e) {
      showErr(`Failed to set provider: ${String(e)}`);
    } finally {
      setProviderBusy(false);
    }
  };

  const activeMatchesRequested = providerStatus?.effective === providerStatus?.requested;

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
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: `ModelTab` no longer errors. Remaining errors only in `AppearanceTab`, `DiagnosticsTab`, `AboutTab`.

---

## Task 6: AppearanceTab + DiagnosticsTab + AboutTab overhaul

**Files:**
- Modify: `src/windows/Settings.tsx`

**Context:** Three remaining tabs. AppearanceTab — swap `useActionNotice` for `useToast`, replace `Group`/`Row` with `SettingsSection`/`SettingsRow`, split into two sections (Accent color / Voicebar). DiagnosticsTab — swap `useActionNotice` for `useToast` only (already uses SettingsSection/SettingsRow). AboutTab — add `onNavigate: (page: Page) => void` prop, expand to App info section + Troubleshooting section.

### Steps

- [ ] **Step 1: Read the current `src/windows/Settings.tsx`**

- [ ] **Step 2: Replace the entire `AppearanceTab` function**

Find the entire `AppearanceTab` function and replace with:

```tsx
function AppearanceTab({ accent, onAccentChange }: { accent: string; onAccentChange: (value: string) => void }) {
  const colors = ["#0A84FF", "#30D158", "#BF5AF2", "#FF9F0A", "#FF375F"];
  const [busy, setBusy] = useState(false);
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
                  onAccentChange(c);
                  localStorage.setItem("settings.waveColor", c);
                  void invoke("set_waveform_color", { color: c })
                    .then(() => showOk("Accent color updated."))
                    .catch((err) => showErr(`Failed to update accent color: ${String(err)}`));
                }}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Voicebar">
        <SettingsRow label="Position" hint="Move the floating voicebar back to the center of the screen." last>
          <Button variant="ghost" busy={busy} onClick={() => void resetVoicebarPosition()}>
            Reset Position
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 3: Replace the entire `DiagnosticsTab` function**

Find the entire `DiagnosticsTab` function and replace with:

```tsx
function DiagnosticsTab() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [running, setRunning] = useState(false);
  const { showErr } = useToast();

  const runHealthCheck = async () => {
    setRunning(true);
    try {
      const result = await invoke<HealthStatus>("run_health_check");
      setHealth(result);
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
```

- [ ] **Step 4: Replace the entire `AboutTab` function**

Find the entire `AboutTab` function and replace with:

```tsx
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
```

- [ ] **Step 5: Clean up unused imports**

After all tab replacements, `Notice` from controls and `NoticeTone` from settingsTypes may be unused. Check the top of Settings.tsx:

- Remove `Notice` from the controls import if it's no longer referenced anywhere in the file.
- Remove `NoticeTone` from the settingsTypes import if it's no longer referenced.

The import should end up looking like:
```tsx
import { Button, SettingsRow, SettingsSection, StatusBadge, ToggleSwitch } from "../ui/controls";
import { ToastProvider, useToast } from "../ui/toast";
```
And:
```tsx
import type { HealthStatus, Page, ProviderRuntimeStatus, ShortcutStatus } from "./settingsTypes";
```

- [ ] **Step 6: Run TypeScript check — all errors must be gone**

```powershell
npx tsc --noEmit
```

Expected: **zero errors**. If any errors remain, fix them before marking this task complete.

---

## Task 7: VoiceBar completion sound

**Files:**
- Modify: `src/windows/VoiceBar.tsx`

**Context:** When a transcription completes (`transcript-ready` event), check `localStorage.getItem("settings.completionSound") === "true"` and play a short 880 Hz tone via the Web Audio API. No new imports needed — `AudioContext` is a browser global.

### Steps

- [ ] **Step 1: Read the current `src/windows/VoiceBar.tsx`**

- [ ] **Step 2: Add completion sound inside the `transcript-ready` listener**

Find this block inside the big `useEffect`:
```tsx
    const unlistenDone = listen<{ text: string }>("transcript-ready", (event) => {
      clearHideTimers();
      setState("done");
      setLastError(null);
      const t = event.payload.text;
      setStatusText(t.slice(0, 64) + (t.length > 64 ? "…" : ""));
      doneHideTimerRef.current = window.setTimeout(() => {
        hideAndReset();
      }, 1600);
    });
```

Replace with:
```tsx
    const unlistenDone = listen<{ text: string }>("transcript-ready", (event) => {
      clearHideTimers();
      setState("done");
      setLastError(null);
      const t = event.payload.text;
      setStatusText(t.slice(0, 64) + (t.length > 64 ? "…" : ""));
      if (localStorage.getItem("settings.completionSound") === "true") {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      }
      doneHideTimerRef.current = window.setTimeout(() => {
        hideAndReset();
      }, 1600);
    });
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

---

## Task 8: Build verification

**Files:** None modified — verification only.

### Steps

- [ ] **Step 1: Full TypeScript build**

```powershell
npm run build
```

Expected output ends with something like:
```
✓ built in Xs
```
No TypeScript errors, no Vite errors.

- [ ] **Step 2: Cargo check**

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. (No Rust files were modified, so this is a sanity gate.)

- [ ] **Step 3: Verify spec compliance — manual checklist**

Open the app (or review against the spec). Verify:

- [ ] Toast appears (pill shape, bottom-centered) when toggling Launch at login
- [ ] Toast disappears after ~3 s
- [ ] GeneralTab has Recording profile dropdown (Balanced / Low RAM / Extended) and Sound on completion toggle; no auto-paste row; no microphone row
- [ ] MicrophoneTab has device selector at the top
- [ ] ShortcutTab shows pulsing blue ring during capture mode instead of blank space
- [ ] ShortcutTab registration status shown as green/red StatusBadge
- [ ] ModelTab shows "Installed" StatusBadge when model is present; Requested and Active are separate rows
- [ ] AboutTab shows Application, Version, Runtime rows and Open Diagnostics button
- [ ] Sidebar is narrower (~190 px) with darker background
