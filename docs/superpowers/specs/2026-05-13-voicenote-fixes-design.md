# VoiceNote V5 — Bug Fixes & Polish Design

**Date:** 2026-05-13
**Scope:** All 22 issues from code review — 5 critical, 10 important, 7 minor

---

## Overview

Fix all issues identified in the VoiceNote V5 code review. Changes are grouped into six independent areas that can be implemented in parallel where possible. The goal is clean, optimized code with no regressions.

---

## Area 1: Audio / Recording Pipeline (`src-tauri/src/lib.rs`)

### Issue 1 — UUID WAV path (Critical)
Replace the fixed `voicenote_recording.wav` temp path with a unique name per recording session: `voicenote_{epoch_ms}.wav`. After the sidecar stdout reader receives `TRANSCRIPT:` or `ERROR:` for a given path, delete the temp file. Pass the WAV path through to the stdout reader so it knows which file to clean up.

### Issue 3 — Cancel/audio-thread race (Critical)
In `cancel_recording`:
1. Set `state.recording = false` first.
2. Sleep 20 ms (one callback window) to let the cpal callback drain.
3. Then `mem::take` the audio buffer.

In `start_audio_capture`, re-check `stop_flag` before emitting `recording-started` so a cancel that arrives before the stream opens doesn't leave the frontend stuck in "recording" state.

### Issue 11 — Rubato resampler (Important)
Add `rubato = "0.16"` to `src-tauri/Cargo.toml`. Replace `resample_to_16khz` with a `FftFixedIn<f32>` polyphase FIR resampler. Keep the 16kHz fast-path: if `from_rate == 16_000`, return the input slice directly as a `Cow` or clone.

---

## Area 2: Sidecar / Worker Management (`src-tauri/src/lib.rs`)

### Issue 2 — `sidecar_busy` guard on hotkey re-entry (Critical)
Add an early return at the top of `handle_shortcut_pressed` if `state.sidecar_busy.load(Ordering::SeqCst)`. This prevents a second recording from starting while the worker is mid-transcription, which would produce two WAV paths in stdin and two paste events.

### Issue 5 — Double-spawn race (Critical)
Add `sidecar_spawning: Arc<AtomicBool>` to `AppState`. In `spawn_sidecar`, use `compare_exchange(false, true, SeqCst, SeqCst)` at entry. If it returns `Err` (another spawn is already running), return immediately. Clear the flag after stdin is stored in `state.sidecar_stdin`.

### Issue 12 — Health check covers all 4 model files (Important)
In `run_health_check`, replace the single `encoder.int8.onnx` existence check with an iteration over `MODEL_FILES` — consistent with `get_model_status`.

### Issue 14 — `test_microphone` actually opens a stream (Important)
After enumerating devices, attempt to open and immediately drop an input stream on the selected device using its default config. Report the `cpal` error string as the failure message instead of the generic "no devices found" path.

---

## Area 3: Settings & State Sync

### Issue 4 — Single source of truth for waveform color (Critical)
- Remove all `localStorage.setItem("settings.waveColor", ...)` calls from `MicrophoneTab` and `AppearanceTab` in `Settings.tsx`.
- Remove `localStorage.getItem("settings.waveColor")` initialization of `accent` state; replace with `invoke("get_waveform_color")` in a `useEffect` that runs once on mount.
- `VoiceBar.tsx` already initializes from `invoke("get_waveform_color")` and listens to `waveform-color-changed` — no change needed there.

### Issue 6 — Provider change misleading message (Important)
In `onProviderChange` in `ModelTab` (`Settings.tsx`), replace the hardcoded `"Restart app to apply."` message with `"Reinitializing worker..."`. The existing `provider-runtime-status` event listener at line 285 will overwrite this badge when the respawned worker responds.

### Issue 7 — Brand name "WhisperVoice" → "VoiceNote" (Important)
Global replace across all source files:
- `Settings.tsx`: title bar, sidebar brand name
- `lib.rs`: onboarding window title (`"Welcome to WhisperVoice"`)
- Any other occurrences in `Onboarding.tsx` or elsewhere

### Issue 21 — `completionSound` to Rust state (Minor)
- Add `completion_sound: bool` to `AppSettings` and `AppState` (default `false`).
- Add `get_completion_sound` and `set_completion_sound` Tauri commands.
- Register both in `invoke_handler`.
- In `GeneralTab`, replace `localStorage` reads/writes with `invoke` calls.
- In `VoiceBar.tsx`, replace `localStorage.getItem("settings.completionSound")` with a state variable initialized from `invoke("get_completion_sound")` and updated via the existing settings-change pattern.

---

## Area 4: Shortcut System

### Issue 10 — Hotkey rollback failure propagation (Important)
In `set_shortcut` (`lib.rs`), if the rollback `register_hotkey(&app, state, &old)` fails, return an `Err` that includes both the original registration error and a message telling the user their hotkey is unregistered and they should restart the app.

### Issue 13 — Deduplicate `normalizeShortcutFromEvent` (Important)
Create `src/lib/shortcutUtils.ts` exporting the shared 54-line function. Update imports in `Settings.tsx` and `Onboarding.tsx`.

### Issue 15 — `DEFAULT_SHORTCUT` in one place (Minor)
Add a Tauri command `get_default_shortcut() -> &'static str` that returns `DEFAULT_SHORTCUT`. Both `Settings.tsx` and `Onboarding.tsx` call it on mount to initialize their local default-shortcut state. Remove the hardcoded string literals from both files.

---

## Area 5: Frontend Polish

### Issue 8 — Remove 120ms watchdog (Important)
In `VoiceBar.tsx`, cancel the `watchdog` interval after the first call to `syncVisibilityFromBackend` that finds `s.recording === true` or after the component confirms it has received at least one event from the backend (use a `syncedRef`). The event-driven listeners handle all transitions after initial sync.

### Issue 9 — AudioContext lifecycle (Important)
Store the `AudioContext` in a `useRef<AudioContext | null>` initialized to `null`. Create it lazily on first use. Do not close it between transcriptions — reuse it. Close it in the `useEffect` cleanup (component unmount) via `ctxRef.current?.close()`.

### Issue 16 — Waveform color validation (Minor)
In `set_waveform_color` (`lib.rs`), after the non-empty check, validate the color matches `^#[0-9a-fA-F]{3}$` or `^#[0-9a-fA-F]{6}$` using a simple manual check (no regex crate needed — check first char is `#`, length is 4 or 7, rest are hex digits).

### Issue 17 — Waveform level ref (Minor)
In `Waveform.tsx`, pass `level` as a `ref` inside the component: `const levelRef = useRef(level); levelRef.current = level;`. The animation loop reads `levelRef.current`. Remove `level` from the `useEffect` deps array so RAF is not cancelled and restarted on every mic event.

### Issue 18 — Broken default color string (Minor)
Fix `Waveform.tsx` default prop: `color = "rgba(80, 160, 255,"` → `color = "#50A0FF"`.

### Issue 19 — DPI coordinate consistency (Minor)
In `VoiceBar.tsx`'s `handleDragStart` → `onUp`, divide physical pixel values from `win.outerPosition()` by `window.devicePixelRatio` before sending to `set_voicebar_position`. In `lib.rs:2037` (position restore on startup), use `tauri::LogicalPosition::new(x, y)` not `PhysicalPosition`.

### Issue 22 — PAGE_ALIASES latent fragility (Minor)
In `lib.rs:2102`, change `open_settings_page(&app_model_hint, Some("models"))` → `Some("model")` to match the canonical key in `PAGE_ALIASES`.

---

## Area 6: Build Config

### Issue 20 — Enable bundle (Minor)
In `src-tauri/tauri.conf.json`, set `"bundle": { "active": true, ... }` so `cargo tauri build` produces a distributable installer.

---

## Files Changed

| File | Areas |
|------|-------|
| `src-tauri/src/lib.rs` | 1, 2, 3, 4, 5, 6 |
| `src-tauri/Cargo.toml` | 1 (rubato) |
| `src/windows/VoiceBar.tsx` | 3, 5 |
| `src/windows/Settings.tsx` | 3, 4 |
| `src/windows/Onboarding.tsx` | 3, 4 |
| `src/components/Waveform.tsx` | 5 |
| `src/lib/shortcutUtils.ts` | 4 (new file) |
| `src-tauri/tauri.conf.json` | 6 |

---

## Non-Goals

- No new UI features.
- No changes to the worker binary (`voicenote-worker`).
- No changes to the sidecar stdin/stdout protocol.
- `Onboarding.tsx` and `EmptyStates.tsx` internals are not reviewed beyond brand name and shortcut dedup.
