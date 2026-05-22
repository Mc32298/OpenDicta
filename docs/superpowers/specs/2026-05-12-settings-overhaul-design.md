# VoiceNote Settings Overhaul Design

Date: 2026-05-12

## Goal

Fully overhaul the Settings window: fix broken/misplaced controls, unify all tab layouts to shared components, introduce a toast feedback system, expose two unused backend settings, and improve visual polish — while keeping every existing Tauri command wired up.

---

## Design Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Visual style | Refined Dark (current direction, polished) |
| Feedback system | Toast notifications — pill shape, floats at bottom, auto-dismisses after 3 s; errors stay 6 s |
| General tab additions | Recording profile dropdown + Sound on completion toggle (replaces removed Auto-paste) |
| Auto-paste | Always on — hardcoded, removed from UI entirely |

---

## Visual System

### Style: Refined Dark

- Sidebar: `#141418`, `190px` wide, `1px` right border `rgba(255,255,255,0.07)`
- Main content: `#16161b`
- Card groups: `rgba(255,255,255,0.04)` background, `rgba(255,255,255,0.08)` border, `border-radius: 10px`
- Row dividers: `rgba(255,255,255,0.06)`
- Section titles: `10.5px`, uppercase, `letter-spacing: .06em`, `rgba(235,235,245,0.35)`
- Active sidebar item: solid `var(--ac)` background (accent color), white text
- Pane title: `20px`, `font-weight: 600`, `letter-spacing: -0.02em`

### Toast System

Replace the per-tab `ActionNotice` / `useActionNotice` pattern with a single global `ToastProvider` + `useToast` hook mounted at the `Settings` root.

**Toast component:**
- Positioned `absolute bottom: 14px`, horizontally centered in `.wv-main`
- Shape: `border-radius: 999px`, `padding: 7px 14px`
- Backdrop: `rgba(24,24,28,0.96)` + `backdrop-filter: blur(10px)` + `box-shadow: 0 4px 20px rgba(0,0,0,0.45)`
- Tones:
  - `ok`: border `rgba(48,209,88,0.4)`, text `#30D158`
  - `err`: border `rgba(255,69,58,0.4)`, text `#FF453A`
  - `info`: border `rgba(10,132,255,0.3)`, text `#0A84FF`
- Leading colored dot (`5px` circle, `background: currentColor`)
- Auto-dismiss: `ok`/`info` after **3 000 ms**, `err` after **6 000 ms**
- Animation: fade + slide up on enter, fade out on dismiss
- Only one toast visible at a time; a new one replaces the current

**API (passed via React context):**
```tsx
const { showOk, showErr, showInfo } = useToast();
showOk("Launch at login enabled.");
showErr("Failed to save shortcut.");
```

**Implementation files:**
- Create `src/ui/toast.tsx` — `ToastProvider`, `ToastContext`, `useToast`
- Add CSS to `src/styles.css` for `.wv-toast`, `.wv-toast--ok`, `.wv-toast--err`, `.wv-toast--info`, enter/exit animations

---

## Tab-by-Tab Content Spec

### General

**Removed:**
- Auto-paste toggle (auto-paste is always enabled; hardcode `true` in the VoiceBar paste logic — no change to VoiceBar needed, paste already runs unconditionally)
- Microphone device `<select>` and `changeDevice` function (moved to Microphone tab)
- "Accent preview" row (the `wv-pill wv-pill-accent` Live span — this was cosmetic only)
- `get_audio_input_info` `useEffect` from GeneralTab (no longer needed here)

**Startup section:**
| Row | Control | Backend |
|---|---|---|
| Launch at login | `ToggleSwitch` | `get_autostart_enabled` / `set_autostart_enabled` |

**Recording section:**
| Row | Control | Backend |
|---|---|---|
| Recording profile | `<select>` with three options | `get_runtime_profile` / `set_runtime_profile` |
| Sound on completion | `ToggleSwitch` | localStorage key `settings.completionSound` |

Recording profile option labels:
- `balanced` → "Balanced (25 s)" — default
- `low_ram` → "Low RAM (5 s)"
- `fast_wake` → "Extended (60 s)"

Sound on completion: when enabled, play a short `AudioContext`-generated tone (440 Hz, 80 ms, fade out) after a successful transcription event. No Tauri command needed.

---

### Shortcut

**No content changes.** Visual improvements only:

- Capture mode: show a pulsing blue ring (`animation: pulse 1.2s ease-in-out infinite`) next to "Press any key…" text inside a `rgba(10,132,255,0.07)` container with `border: 1px solid rgba(10,132,255,0.4)` — replaces blank space with an unmistakable "listening" indicator
- Registration status: shown as a `StatusBadge` (`ok` = registered, `err` = not registered) instead of a plain text note
- Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`
- Toast feedback replaces `ActionNotice`

---

### Microphone

**Added:** Microphone device selector (moved from General).

**Input device section:**
| Row | Control | Backend |
|---|---|---|
| Microphone | `<select>` populated from `get_audio_input_info` | `set_audio_input_device` |
| Waveform accent | `<input type="color">` | `set_waveform_color` + localStorage |
| Show level meter | `ToggleSwitch` | `get_debug_mic_level` / `set_debug_mic_level` |

**Test section:**
| Row | Control | Backend |
|---|---|---|
| Microphone test | `Button` | `test_microphone` |

Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`. Toast feedback replaces `ActionNotice`.

---

### Model

**No content changes.** Visual improvements:

- Provider status: split the single dense text line into two labeled rows:
  - "Requested" → `providerStatus.requested`
  - "Active" → `providerStatus.effective` (green if matches requested, amber if different)
- Download button: when model is installed, show `StatusBadge tone="ok"` ("Installed") instead of a disabled button
- Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`
- Toast feedback replaces `ActionNotice`

---

### Appearance

**Removed:** The `<input type="color">` color picker duplicate (it lives in Microphone → Waveform accent).

**Accent color section:**
| Row | Control | Backend |
|---|---|---|
| Preset colors | Five color swatches | `set_waveform_color` + localStorage |

**Voicebar section:**
| Row | Control | Backend |
|---|---|---|
| Position | "Reset Position" `Button ghost` | `reset_voicebar_position` |

Replace `Group`/`Row` with `SettingsSection`/`SettingsRow`. Toast feedback replaces `ActionNotice`.

---

### Diagnostics

**No content changes.** Already uses `SettingsSection`/`SettingsRow`. Migrate to toast feedback, no other changes.

---

### About

**Expanded** from a single version row to:

**App info section:**
| Row | Value |
|---|---|
| Application | "VoiceNote" |
| Version | "0.1.0" |
| Runtime | "Tauri 2 · Parakeet TDT" |

**Troubleshooting section:**
| Row | Control | Action |
|---|---|---|
| Diagnostics | "Open Diagnostics" `Button` | prop-drilled: `AboutTab` receives `onNavigate: (page: Page) => void` from `Settings` root; calls `onNavigate("diagnostics")` |

---

## Files Changed

| File | Change |
|---|---|
| `src/ui/toast.tsx` | **Create** — `ToastProvider`, `ToastContext`, `useToast` |
| `src/styles.css` | **Modify** — add `.wv-toast` rules and enter/exit animations |
| `src/windows/Settings.tsx` | **Modify** — all tabs updated per spec above; `ToastProvider` wraps `<main>`; `useToast` replaces `useActionNotice` in all tabs |
| `src-tauri/src/lib.rs` | **No change** — all required commands already exist |
| `src-tauri/capabilities/default.json` | **No change** |

---

## Completion sound implementation

In `src/windows/VoiceBar.tsx`, on the `transcript-ready` event (after a successful transcription), check `localStorage.getItem("settings.completionSound") === "true"` and if so play:

```ts
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
```

---

## Auto-paste always-on

Remove the `autoPaste` state, `toggleAutoPaste`, and the `SettingsRow` for auto-paste from `GeneralTab`. In `VoiceBar.tsx`, the paste logic already runs unconditionally — no change needed there.

---

## Build verification

After implementation:
```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Both must pass before the task is considered complete. No Tauri dev session needed for automated gates; manual verification checklist is in `docs/superpowers/control-audit/`.
