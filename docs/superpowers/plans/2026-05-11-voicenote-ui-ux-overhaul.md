# VoiceNote UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign VoiceNote into a platform-neutral, Apple-influenced menu-bar dictation utility with a polished voicebar, real settings controls, guided setup, and reliable recovery paths.

**Architecture:** Keep the working Tauri/Rust speech pipeline intact and refactor the React UI around shared controls, explicit voicebar states, and real settings sections. Add only small backend commands required to make visible controls real, and remove or hide UI that currently points at stubs or placeholder flows.

**Tech Stack:** Tauri 2, Rust, React 18, TypeScript, Vite, CSS, Apple Human Interface Guidelines principles for hierarchy, materials, controls, layout, and button behavior.

---

## References

- Design spec: `docs/superpowers/specs/2026-05-11-voicenote-ui-ux-overhaul-design.md`
- Apple HIG overview: https://developer.apple.com/design/human-interface-guidelines
- Apple HIG buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple HIG sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Apple HIG layout: https://developer.apple.com/design/Human-Interface-Guidelines/layout

## File Structure

Create focused frontend modules and keep the existing Tauri command file as the backend integration point.

- Create `src/ui/icons.tsx`: shared icon components used by voicebar, settings, onboarding, and empty states.
- Create `src/ui/controls.tsx`: shared `Button`, `IconButton`, `Switch`, `Notice`, `StatusBadge`, and section/row components.
- Create `src/windows/settingsTypes.ts`: shared `Page`, notice, shortcut, provider, and health status types.
- Modify `src/styles.css`: global design tokens, shared controls, refined voicebar, settings, onboarding, and recovery styling.
- Modify `src/windows/VoiceBar.tsx`: explicit state rendering, clearer actions, recovery affordances, and shared controls/icons.
- Modify `src/windows/Settings.tsx`: reduce visible pages to real sections, use shared controls, add button audit behavior, and remove stub CTAs.
- Modify `src/windows/Onboarding.tsx`: guided setup flow with clearer status, recovery copy, and working controls.
- Modify `src/windows/EmptyStates.tsx`: remove inert CTAs or convert them into real navigation/actions.
- Modify `src/App.tsx`: keep lazy routing, update imports only if component files move.
- Modify `src-tauri/src/lib.rs`: add small commands for real UI controls and remove/update stub behavior.
- Modify `src-tauri/capabilities/default.json`: only if new plugin permissions or commands require capability changes.
- Create `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`: deterministic manual checklist for every visible button/control.

The codebase has no configured frontend test runner and this workspace is not currently a git repository. Use `npm run build` and `cargo check` as automated gates, plus the control audit checklist for UI behavior until test infrastructure is added.

---

### Task 1: Shared UI Tokens, Icons, And Controls

**Files:**
- Create: `src/ui/icons.tsx`
- Create: `src/ui/controls.tsx`
- Modify: `src/styles.css`
- Create: `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`

- [ ] **Step 1: Create the shared icon module**

Create `src/ui/icons.tsx` with this content:

```tsx
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return <IconBase {...props}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></IconBase>;
}

export function StopIcon(props: IconProps) {
  return <IconBase {...props}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></IconBase>;
}

export function XIcon(props: IconProps) {
  return <IconBase {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></IconBase>;
}

export function CheckIcon(props: IconProps) {
  return <IconBase {...props}><polyline points="20 6 9 17 4 12" /></IconBase>;
}

export function AlertIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" /></IconBase>;
}

export function GearIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></IconBase>;
}

export function KeyboardIcon(props: IconProps) {
  return <IconBase {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></IconBase>;
}

export function PaletteIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3 0 5.5-2.5 5.5-5.5C22 6.5 17.5 2 12 2z" /></IconBase>;
}

export function InfoIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></IconBase>;
}

export function BoxIcon(props: IconProps) {
  return <IconBase {...props}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></IconBase>;
}

export function ActivityIcon(props: IconProps) {
  return <IconBase {...props}><path d="M22 12h-4l-3 8L9 4l-3 8H2" /></IconBase>;
}
```

- [ ] **Step 2: Create shared controls**

Create `src/ui/controls.tsx` with this content:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type NoticeTone = "info" | "ok" | "err" | "warn";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
};

export function Button({ variant = "secondary", busy = false, disabled, children, className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`wv-btn wv-btn--${variant} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? "Working..." : children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: ButtonVariant;
};

export function IconButton({ label, variant = "ghost", children, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`wv-icon-btn wv-icon-btn--${variant} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function ToggleSwitch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      className="wv-switch"
      data-on={on ? "1" : "0"}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
    >
      <span className="wv-switch-knob" />
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  if (!children) return null;
  return <div className="wv-notice" data-tone={tone}>{children}</div>;
}

export function StatusBadge({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return <span className="wv-status-badge" data-tone={tone}>{children}</span>;
}

export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="wv-group">
      {title && <div className="wv-group-title">{title}</div>}
      <div className="wv-group-card">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, hint, children, last }: { label: string; hint?: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <div className="wv-row" data-last={last ? "1" : "0"}>
      <div className="wv-row-label">
        <div>{label}</div>
        {hint && <div className="wv-row-hint">{hint}</div>}
      </div>
      <div className="wv-row-control">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Add design tokens and control CSS**

Modify the top of `src/styles.css` so `:root` includes these tokens, preserving existing names that current code uses:

```css
:root {
  --ac: #0A84FF;
  --ac-green: #30D158;
  --ac-red: #FF453A;
  --ac-warn: #FFD60A;
  --text: rgba(245,245,247,0.95);
  --text-sub: rgba(235,235,245,0.62);
  --text-faint: rgba(235,235,245,0.42);
  --bg: #141417;
  --surface-0: #111216;
  --surface-1: #1C1C1E;
  --surface-2: rgba(255,255,255,0.07);
  --line: rgba(255,255,255,0.10);
  --radius-sm: 7px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --motion-fast: 120ms ease;
}
```

Replace the existing `.wv-btn` block with this button system:

```css
.wv-btn {
  min-height: 34px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  background: rgba(255,255,255,0.10);
  cursor: pointer;
  transition: background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast), opacity var(--motion-fast);
  position: relative;
  z-index: 1;
}
.wv-btn--primary { background: var(--ac); border-color: color-mix(in srgb, var(--ac) 82%, white); color: white; }
.wv-btn--secondary { background: rgba(255,255,255,0.12); }
.wv-btn--ghost, .wv-btn-ghost { background: rgba(255,255,255,0.07); }
.wv-btn--danger { color: var(--ac-red); background: rgba(255,69,58,0.12); border-color: rgba(255,69,58,0.28); }
.wv-btn:hover:not(:disabled) { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.24); }
.wv-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ac) 86%, white); }
.wv-btn:active:not(:disabled) { transform: scale(0.98); }
.wv-btn:disabled { opacity: 0.5; cursor: default; }

.wv-icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.08);
  color: var(--text-sub);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
}
.wv-icon-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: var(--text); }
.wv-icon-btn:active:not(:disabled) { transform: scale(0.96); }
.wv-icon-btn--primary { background: rgba(10,132,255,0.20); color: var(--ac); }
.wv-icon-btn--danger { background: rgba(255,69,58,0.14); color: var(--ac-red); }
.wv-icon-btn:disabled { opacity: 0.5; cursor: default; }

.wv-status-badge {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgba(255,255,255,0.08);
  color: var(--text-sub);
}
.wv-status-badge[data-tone="ok"] { color: var(--ac-green); background: rgba(48,209,88,0.12); }
.wv-status-badge[data-tone="err"] { color: var(--ac-red); background: rgba(255,69,58,0.12); }
.wv-status-badge[data-tone="warn"] { color: var(--ac-warn); background: rgba(255,214,10,0.12); }
```

- [ ] **Step 4: Create the first control audit checklist**

Create `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md` with this content:

```markdown
# VoiceNote UI Control Audit

Date: 2026-05-11

## Rule

Every visible button or control must either work, be disabled with a clear reason, navigate to a real surface, or be removed.

## Voicebar

- [ ] Stop recording: invokes `stop_recording`, transitions from listening to processing.
- [ ] Cancel recording: invokes `cancel_recording`, transitions to cancelled/hidden without transcription.
- [ ] Settings/recovery action: opens the relevant settings page when shown.
- [ ] Dismiss error: hides the voicebar and resets idle state.

## Settings

- [ ] Close traffic button hides settings.
- [ ] Minimize traffic button hides settings.
- [ ] Sidebar items navigate only to real sections.
- [ ] Launch at login invokes `set_autostart_enabled` and reports success/error.
- [ ] Auto-paste changes real stored state or is removed until backend supports it.
- [ ] Shortcut capture invokes `set_shortcut` and refreshes registration status.
- [ ] Shortcut reset invokes `set_shortcut` with the default value and refreshes status.
- [ ] Microphone select invokes `set_audio_input_device`.
- [ ] Microphone test invokes `test_microphone`.
- [ ] Model download invokes `download_model`, shows progress, and refreshes status.
- [ ] Provider select invokes `set_onnx_provider` and shows requested/effective provider.
- [ ] Accent color invokes `set_waveform_color` and updates the live voicebar.
- [ ] Reset voicebar position invokes `reset_voicebar_position`.
- [ ] Health check invokes `run_health_check` and shows actionable status.
- [ ] Update check is hidden unless it performs a real update check.

## Onboarding

- [ ] Back moves to the previous step and is disabled on first step.
- [ ] Next moves only when the current step is valid.
- [ ] Change Shortcut captures and saves a shortcut.
- [ ] Save Provider invokes `set_onnx_provider`.
- [ ] Download Model invokes `download_model`.
- [ ] Finish invokes `complete_onboarding` only after required setup is ready.
```

- [ ] **Step 5: Verify TypeScript compilation**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build complete successfully. If the build fails on `color-mix`, replace those CSS uses with static colors before continuing.

---

### Task 2: Voicebar State And Interaction Redesign

**Files:**
- Modify: `src/windows/VoiceBar.tsx`
- Modify: `src/styles.css`
- Modify: `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`

- [ ] **Step 1: Replace local icon definitions with shared imports**

In `src/windows/VoiceBar.tsx`, replace the icon function declarations at the bottom of the file with imports:

```tsx
import { AlertIcon, CheckIcon, MicIcon, StopIcon, XIcon } from "../ui/icons";
import { IconButton } from "../ui/controls";
```

Remove the local `MicIcon`, `StopIcon`, `XIcon`, `CheckIcon`, and `AlertIcon` functions from the bottom of the file.

- [ ] **Step 2: Add explicit error storage**

In `VoiceBar`, add a `lastError` state:

```tsx
const [lastError, setLastError] = useState<string | null>(null);
```

- [ ] **Step 3: Make cancel state visible and brief**

Extend the `State` type:

```tsx
type State = "idle" | "recording" | "processing" | "done" | "error" | "cancelled";
```

Update `handleCancel`:

```tsx
async function handleCancel() {
  await invoke("cancel_recording");
  setState("cancelled");
  setStatusText("Cancelled");
  setLevel(0);
  window.setTimeout(() => {
    setState("idle");
    setStatusText("Ready");
    setVisible(false);
    document.documentElement.removeAttribute("data-vb");
  }, 700);
}
```

- [ ] **Step 4: Store and display errors**

In the `transcription-error` listener, set `lastError`:

```tsx
setLastError(event.payload.message);
setState("error");
setStatusText(event.payload.message);
```

Clear `lastError` in `recording-started`, `voicebar-hide`, and successful transcript handlers:

```tsx
setLastError(null);
```

- [ ] **Step 5: Replace action buttons with shared icon buttons**

Replace the existing action button JSX with:

```tsx
<div className="pill-actions">
  {isRecording && (
    <IconButton className="pill-action" variant="primary" onClick={handleStop} label="Stop recording">
      <StopIcon />
    </IconButton>
  )}
  {(isRecording || isProcessing || isError || isIdle) && (
    <IconButton className="pill-action" variant={isError ? "danger" : "ghost"} onClick={handleCancel} label={isError ? "Dismiss" : "Cancel"}>
      <XIcon />
    </IconButton>
  )}
</div>
```

- [ ] **Step 6: Add cancelled rendering**

Add this state rendering in the body:

```tsx
{state === "cancelled" && (
  <div className="pill-status">
    <div className="pill-alert">
      <XIcon />
    </div>
    <span className="pill-status-text pill-status-text--muted">Cancelled</span>
  </div>
)}
```

- [ ] **Step 7: Update voicebar CSS for stable hit targets**

In `src/styles.css`, replace `.pill-btn` styles with `.pill-action` styles that delegate to `.wv-icon-btn`:

```css
.pill-actions { display: flex; align-items: center; gap: 6px; margin-left: 8px; }
.pill-action { width: 34px; height: 34px; flex: 0 0 34px; }
.pill-status-text { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.pill--cancelled { box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 0 0 1px rgba(235,235,245,0.12); }
```

- [ ] **Step 8: Verify build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Update the control audit**

Mark voicebar controls in `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md` as verified only after manual Tauri testing.

---

### Task 3: Settings Restructure And Button Audit

**Files:**
- Create: `src/windows/settingsTypes.ts`
- Modify: `src/windows/Settings.tsx`
- Modify: `src/styles.css`
- Modify: `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`

- [ ] **Step 1: Create shared settings types**

Create `src/windows/settingsTypes.ts`:

```ts
export type Page = "general" | "shortcut" | "microphone" | "model" | "appearance" | "diagnostics" | "about";

export type NoticeTone = "info" | "ok" | "err" | "warn";

export type ShortcutStatus = {
  shortcut: string;
  registered: boolean;
  recording: boolean;
};

export type ProviderRuntimeStatus = {
  requested: string;
  effective: string;
  message: string;
};

export type HealthStatus = {
  worker_exists: boolean;
  model_exists: boolean;
};
```

- [ ] **Step 2: Reduce visible pages to real sections**

In `Settings.tsx`, replace the current `Page` type and `PAGE_ALIASES` with imports and this alias map:

```tsx
import type { Page, NoticeTone, ShortcutStatus, ProviderRuntimeStatus, HealthStatus } from "./settingsTypes";
import { Button, Notice, SettingsRow, SettingsSection, StatusBadge, ToggleSwitch } from "../ui/controls";
import { ActivityIcon, BoxIcon, GearIcon, InfoIcon, KeyboardIcon, MicIcon, PaletteIcon } from "../ui/icons";

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
```

- [ ] **Step 3: Replace sidebar tabs**

Replace the `tabs` array with:

```tsx
const tabs: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: "general", label: "General", icon: <GearIcon /> },
  { id: "shortcut", label: "Shortcut", icon: <KeyboardIcon /> },
  { id: "microphone", label: "Microphone", icon: <MicIcon /> },
  { id: "model", label: "Model", icon: <BoxIcon /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon /> },
  { id: "diagnostics", label: "Diagnostics", icon: <ActivityIcon /> },
  { id: "about", label: "About", icon: <InfoIcon /> },
];
```

Remove sidebar entries for AI, History, and Account.

- [ ] **Step 4: Replace render routing**

Replace the `<main className="wv-main">` children with:

```tsx
{page === "general" && <GeneralTab accent={accent} />}
{page === "shortcut" && <ShortcutTab />}
{page === "microphone" && <MicrophoneTab accent={accent} onAccentChange={setAccent} />}
{page === "model" && <ModelTab />}
{page === "appearance" && <AppearanceTab accent={accent} onAccentChange={setAccent} />}
{page === "diagnostics" && <DiagnosticsTab />}
{page === "about" && <AboutTab />}
```

Rename existing tab components instead of rewriting all logic at once:

- `ModelsTab` to `ModelTab`
- `KeyboardTab` to `ShortcutTab`
- `MicTab` to `MicrophoneTab`

- [ ] **Step 5: Remove inert History and Account flows**

Delete `HistoryTab`, `AccountTab`, and `AITab` from `Settings.tsx` unless they are replaced with real controls in the same task. Remove all `open_empty_state` usage from settings.

- [ ] **Step 6: Hide stub update check**

In `AboutTab`, remove the “Check for updates” row until `check_for_updates` is a real implementation. Keep version and health summary only:

```tsx
<SettingsSection>
  <SettingsRow label="Version" last>
    <span className="wv-note">0.1.0</span>
  </SettingsRow>
</SettingsSection>
```

- [ ] **Step 7: Use shared controls in at least the General tab first**

Convert `GeneralTab` from `Group`, `Row`, and `Toggle` to shared controls:

```tsx
<SettingsSection title="Startup">
  <SettingsRow label="Launch at login">
    <ToggleSwitch label="Launch at login" on={launchAtLogin} onToggle={() => void toggleLaunchAtLogin()} disabled={busy} />
  </SettingsRow>
  <SettingsRow label="Auto-paste transcript" hint="Paste into focused app when transcription completes." last>
    <ToggleSwitch label="Auto-paste transcript" on={autoPaste} onToggle={toggleAutoPaste} disabled={busy} />
  </SettingsRow>
</SettingsSection>
```

Define `toggleAutoPaste` above the return:

```tsx
const toggleAutoPaste = () => {
  const next = !autoPaste;
  setAutoPaste(next);
  localStorage.setItem("settings.autoPaste", String(next));
  showOk(`Auto-paste ${next ? "enabled" : "disabled"}.`);
};
```

- [ ] **Step 8: Verify build**

Run:

```powershell
npm run build
```

Expected: TypeScript succeeds after removed pages and renamed components are consistent.

- [ ] **Step 9: Update the control audit**

Remove Account, History, AI Prompt rows from the checklist. Mark them as “hidden until real workflows exist” under a new “Deferred surfaces” section.

---

### Task 4: Onboarding And Empty-State Recovery

**Files:**
- Modify: `src/windows/Onboarding.tsx`
- Modify: `src/windows/EmptyStates.tsx`
- Modify: `src/styles.css`
- Modify: `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`

- [ ] **Step 1: Replace onboarding buttons with shared controls**

Import shared controls:

```tsx
import { Button, Notice, StatusBadge } from "../ui/controls";
```

Replace the status notice:

```tsx
<Notice tone={status.tone}>{status.text}</Notice>
```

Replace Back/Next/Finish buttons:

```tsx
<Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
{step < 3 && <Button variant="primary" disabled={busy} onClick={() => setStep((s) => Math.min(3, s + 1))}>Next</Button>}
{step === 3 && <Button variant="primary" disabled={busy || !modelInstalled} onClick={() => void finish()}>Finish</Button>}
```

- [ ] **Step 2: Add setup readiness copy**

In step 3, show a status badge:

```tsx
<StatusBadge tone={modelInstalled ? "ok" : "warn"}>
  {modelInstalled ? "Ready" : "Required"}
</StatusBadge>
```

Keep `Finish` disabled until `modelInstalled` is true.

- [ ] **Step 3: Make provider save feedback precise**

In `saveProvider`, replace the success branch with:

```tsx
setStatus({
  tone: runtime.effective === provider ? "ok" : "warn",
  text: `Requested ${runtime.requested}. Active provider: ${runtime.effective}. ${runtime.message}`,
});
```

- [ ] **Step 4: Remove inert empty-state CTA buttons**

In `EmptyStates.tsx`, remove the button:

```tsx
<button className="wv-btn" type="button">{pane.cta}</button>
```

Replace it with a non-interactive note:

```tsx
<span className="wv-note">{pane.cta}</span>
```

This avoids presenting a fake action. If real navigation is needed later, add a Tauri command and button in the same task.

- [ ] **Step 5: Verify build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Update the control audit**

Mark `Finish` as blocked until model install and empty-state CTAs as removed.

---

### Task 5: Backend Commands For Real Controls

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/windows/Settings.tsx`
- Modify: `src/windows/VoiceBar.tsx`
- Modify: `src-tauri/capabilities/default.json` only if Tauri reports a permission error

- [ ] **Step 1: Add `open_settings_page` as a Tauri command**

In `src-tauri/src/lib.rs`, after the existing `open_empty_state` command, add:

```rust
#[tauri::command]
async fn open_settings_page_command(app: AppHandle, page: Option<String>) -> Result<(), String> {
    open_settings_page(&app, page.as_deref());
    Ok(())
}
```

Add it to `tauri::generate_handler!`:

```rust
open_settings_page_command,
```

Frontend invoke name will be `open_settings_page_command`.

- [ ] **Step 2: Update VoiceBar recovery invoke and button**

In `VoiceBar.tsx`, add `GearIcon` to the shared icon import:

```tsx
import { AlertIcon, CheckIcon, GearIcon, MicIcon, StopIcon, XIcon } from "../ui/icons";
```

Add the recovery action inside `VoiceBar`:

```tsx
async function openSettings() {
  await invoke("open_settings_page_command", { page: "diagnostics" }).catch((e) => {
    console.error("open_settings_page_command failed", e);
  });
}
```

Add this button before the cancel/dismiss button in `.pill-actions`:

```tsx
{isError && lastError && (
  <IconButton className="pill-action" onClick={() => void openSettings()} label="Open diagnostics">
    <GearIcon />
  </IconButton>
)}
```

- [ ] **Step 3: Refactor voicebar position saving**

Replace `save_voicebar_position` in `src-tauri/src/lib.rs` with this version:

```rust
fn save_voicebar_position(app: &AppHandle, position: Option<(i32, i32)>) -> Result<(), String> {
    let file = voicebar_position_path(app)?;
    match position {
        Some((x, y)) => {
            let payload = serde_json::to_string(&VoicebarPosition { x, y })
                .map_err(|e| format!("Failed to serialize voicebar position: {}", e))?;
            std::fs::write(file, payload)
                .map_err(|e| format!("Failed to save voicebar position: {}", e))
        }
        None => {
            if file.exists() {
                std::fs::remove_file(file)
                    .map_err(|e| format!("Failed to remove voicebar position: {}", e))?;
            }
            Ok(())
        }
    }
}
```

Update the existing `set_voicebar_position` command to call the new signature:

```rust
save_voicebar_position(&app, Some((x, y)))
```

- [ ] **Step 4: Add reset voicebar position command**

In `src-tauri/src/lib.rs`, after `set_voicebar_position`, add:

```rust
#[tauri::command]
async fn reset_voicebar_position(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    *state.voicebar_pos.lock().unwrap() = None;
    save_voicebar_position(&app, None)?;
    if let Some(win) = app.get_webview_window("voicebar") {
        let _ = win.center();
    }
    Ok(())
}
```

Add `reset_voicebar_position` to `tauri::generate_handler!`.

- [ ] **Step 5: Add test microphone command**

In `src-tauri/src/lib.rs`, after `get_audio_input_info`, add:

```rust
#[derive(serde::Serialize)]
struct MicrophoneTestResult {
    ok: bool,
    message: String,
}

#[tauri::command]
async fn test_microphone(state: tauri::State<'_, SharedState>) -> Result<MicrophoneTestResult, String> {
    let info = get_audio_input_info(state).await?;
    let selected = info.selected_device.unwrap_or_else(|| "System Default".to_string());
    Ok(MicrophoneTestResult {
        ok: !info.devices.is_empty(),
        message: if info.devices.is_empty() {
            "No microphone input devices were found.".to_string()
        } else {
            format!("Microphone input is available: {}", selected)
        },
    })
}
```

Add `test_microphone` to `tauri::generate_handler!`.

- [ ] **Step 6: Add UI buttons for new commands**

In `MicrophoneTab`, add a “Test Microphone” button that invokes `test_microphone`:

```tsx
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
```

Render it in the microphone section:

```tsx
<SettingsRow label="Microphone test" hint="Checks whether VoiceNote can see an input device." last>
  <Button onClick={() => void testMicrophone()} busy={busy}>Test Microphone</Button>
</SettingsRow>
```

In `AppearanceTab`, add reset position:

```tsx
const resetVoicebarPosition = async () => {
  try {
    await invoke("reset_voicebar_position");
    showOk("Voicebar position reset.");
  } catch (e) {
    showErr(`Failed to reset voicebar position: ${String(e)}`);
  }
};
```

Render:

```tsx
<SettingsRow label="Voicebar position" hint="Move the floating voicebar back to the center of the screen." last>
  <Button variant="ghost" onClick={() => void resetVoicebarPosition()}>Reset Position</Button>
</SettingsRow>
```

- [ ] **Step 7: Verify Rust and frontend builds**

Run:

```powershell
cargo check
npm run build
```

Expected: `cargo check` and `npm run build` both pass.

---

### Task 6: Visual QA And Full Manual Control Audit

**Files:**
- Modify: `docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md`
- Modify: `docs/superpowers/specs/2026-05-11-voicenote-ui-ux-overhaul-design.md` only if implementation reveals a necessary scope correction

- [ ] **Step 1: Run automated build gates**

Run:

```powershell
npm run build
cargo check
```

Expected: both pass.

- [ ] **Step 2: Start the app for manual verification**

Run:

```powershell
npm run tauri:dev
```

Expected: Tauri opens VoiceNote. If this fails because the worker build is slow or missing dependencies, record the exact error in the audit document before fixing.

- [ ] **Step 3: Verify core voicebar flow**

Manual steps:

1. Hold the configured shortcut.
2. Confirm voicebar appears immediately.
3. Confirm waveform and timer update while speaking.
4. Click Stop.
5. Confirm processing state appears.
6. Confirm success preview appears after transcription.
7. Confirm voicebar hides after success.

Record the result in the audit under “Voicebar”.

- [ ] **Step 4: Verify cancel flow**

Manual steps:

1. Hold the configured shortcut.
2. Click Cancel while recording.
3. Confirm no transcription is triggered.
4. Confirm “Cancelled” appears briefly.
5. Confirm voicebar hides.

Record the result in the audit.

- [ ] **Step 5: Verify settings controls**

Manual steps:

1. Open settings from tray.
2. Visit each sidebar item.
3. Confirm there are no visible AI, Account, or History placeholder sections.
4. Toggle Launch at login and confirm success/error notice.
5. Toggle Auto-paste and confirm persisted UI state.
6. Change shortcut and confirm registration status refreshes.
7. Reset shortcut and confirm default value.
8. Change microphone and confirm success/error notice.
9. Test microphone and confirm actionable result.
10. Refresh model/provider status.
11. Change accent and confirm voicebar waveform uses it.
12. Reset voicebar position and confirm the bar centers.
13. Run health check and confirm worker/model status.

Record each result in the audit.

- [ ] **Step 6: Verify onboarding**

Manual steps:

1. Open onboarding.
2. Confirm Back is disabled on step 1.
3. Capture shortcut.
4. Save provider.
5. Confirm Finish is disabled until model is installed.
6. Download model or verify installed model.
7. Finish onboarding and confirm the window hides.

Record each result in the audit.

- [ ] **Step 7: Final acceptance check**

Confirm these statements are true in the audit:

- The core dictation flow still works.
- Every visible button works, is clearly disabled, or was removed.
- Missing or failed setup states point to a recovery action.
- The UI reads as platform-neutral, Apple-influenced, compact, and consistent.

If any statement is false, create a follow-up task before calling implementation complete.
