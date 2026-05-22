# VoiceNote V5 — Bug Fixes & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 22 issues identified in the code review — 5 critical race conditions, 10 important bugs, 7 minor polish items — producing clean, production-ready code.

**Architecture:** Changes are grouped into 10 independent tasks ordered by dependency (new shared files → Rust backend → frontend consumers). Tasks 1–3 have no dependencies and can be done in any order. Tasks 4–6 are Rust-only and independent of each other. Tasks 7–9 depend on Task 6 (new Rust commands must exist first). Task 10 is standalone.

**Tech Stack:** Rust 2021, Tauri 2, React 18, TypeScript, cpal, rubato 0.16 (new), hound, enigo, tokio, serde

---

## File Map

| File | Role | Tasks |
|------|------|-------|
| `src/lib/shortcutUtils.ts` | **NEW** — shared shortcut normalization + DEFAULT_SHORTCUT | 1 |
| `src/components/Waveform.tsx` | Fix broken default color, stop RAF restarts on every mic event | 2 |
| `src-tauri/Cargo.toml` | Add rubato dependency | 3 |
| `src-tauri/src/lib.rs` | All Rust fixes — audio pipeline, sidecar, settings, commands | 4, 5, 6 |
| `src/windows/VoiceBar.tsx` | Watchdog removal, AudioContext lifecycle, completionSound, DPI | 7 |
| `src/windows/Settings.tsx` | Color source-of-truth, provider message, brand name, completionSound | 8 |
| `src/windows/Onboarding.tsx` | Brand name, import shortcutUtils | 9 |
| `src-tauri/tauri.conf.json` | Enable bundle | 10 |

---

## Task 1: Create `src/lib/shortcutUtils.ts`

**Files:**
- Create: `src/lib/shortcutUtils.ts`

Deduplicates the 54-line `normalizeShortcutFromEvent` function that exists verbatim in both `Settings.tsx` and `Onboarding.tsx`. Also centralizes `DEFAULT_SHORTCUT`.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/shortcutUtils.ts
export const DEFAULT_SHORTCUT = "ControlRight";

export function normalizeShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  const key = e.key;
  if (!code) return null;
  if (
    code === "ControlRight" || code === "ControlLeft" ||
    code === "ShiftLeft" || code === "ShiftRight" ||
    code === "AltLeft" || code === "AltRight" ||
    code === "MetaLeft" || code === "MetaRight"
  ) {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors from the new file.

---

## Task 2: Fix `src/components/Waveform.tsx`

**Files:**
- Modify: `src/components/Waveform.tsx`

**Issues fixed:** #17 (RAF restarts every mic event), #18 (broken default color string)

- [ ] **Step 1: Replace the entire file**

```tsx
import { useEffect, useRef } from "react";

interface WaveformProps {
  active: boolean;
  level: number;
  color?: string;
}

export default function Waveform({ active, level, color = "#50A0FF" }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  // Keep level in a ref so the animation loop always reads the latest value
  // without the useEffect needing `level` as a dependency (which would cancel
  // and restart the RAF on every mic event, causing visual stutter).
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const BAR_WIDTH = 2;
    const BAR_GAP = 2;
    const TOTAL = BAR_WIDTH + BAR_GAP;
    const NUM_BARS = Math.floor(W / TOTAL);
    const CENTER = H / 2;
    const MIN_HEIGHT = 2;
    const MAX_HEIGHT = H * 0.75;

    const speed = active ? 0.07 : 0.015;

    function draw() {
      if (!ctx) return;
      // Read latest level from ref — no dep needed
      const amplitudeScale = active ? (0.2 + levelRef.current * 1.1) : 0.05;
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < NUM_BARS; i++) {
        const norm = i / NUM_BARS;
        const edgeFade = Math.sin(norm * Math.PI);
        const wave =
          Math.sin(norm * 14 + tRef.current * 1.4) * 0.55 +
          Math.sin(norm * 23 + tRef.current * 0.9) * 0.3 +
          Math.sin(norm * 7  + tRef.current * 2.1) * 0.2 +
          Math.sin(norm * 31 + tRef.current * 0.6) * 0.15;

        const amp = Math.abs(wave) * edgeFade * amplitudeScale;
        const height = MIN_HEIGHT + amp * (MAX_HEIGHT - MIN_HEIGHT);
        const x = i * TOTAL + (W - NUM_BARS * TOTAL) / 2;
        const y = CENTER - height / 2;
        const alpha = 0.4 + edgeFade * 0.6;

        ctx.fillStyle = withAlpha(color, alpha);

        const r = BAR_WIDTH / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + BAR_WIDTH - r, y);
        ctx.arcTo(x + BAR_WIDTH, y, x + BAR_WIDTH, y + r, r);
        ctx.lineTo(x + BAR_WIDTH, y + height - r);
        ctx.arcTo(x + BAR_WIDTH, y + height, x + BAR_WIDTH - r, y + height, r);
        ctx.lineTo(x + r, y + height);
        ctx.arcTo(x, y + height, x, y + height - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
      }

      tRef.current += speed;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [active, color]); // `level` intentionally omitted — read via levelRef inside draw()

  return (
    <canvas
      ref={canvasRef}
      width={484}
      height={40}
      style={{ width: "100%", height: "40px", display: "block" }}
    />
  );
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("rgba(")) {
    return color.replace(/rgba\(([^)]+)\)/, (_m, inner) => {
      const parts = inner.split(",").map((p: string) => p.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    });
  }
  if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const full = hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

## Task 3: Add `rubato` to `src-tauri/Cargo.toml`

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add rubato dependency**

After the `sha2 = "0.10"` line, add:

```toml
rubato = "0.16"
```

The `[dependencies]` block should now end with:
```toml
sha2 = "0.10"
rubato = "0.16"
keyring = "3"
```

- [ ] **Step 2: Verify it resolves**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: resolves without error (may download rubato crate on first run).

---

## Task 4: Rust — Audio Pipeline (`src-tauri/src/lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Issues fixed:** #1 (UUID WAV path + cleanup), #3 (cancel race), #11 (rubato resampler)

### Step 1: Add `last_wav_path` field to `AppState`

- [ ] In the `AppState` struct, after `sidecar_standby`, add:

```rust
    /// Path of the WAV file currently being processed by the worker.
    /// Set in finalize_recording, cleared and deleted by the stdout reader.
    last_wav_path: Arc<Mutex<Option<std::path::PathBuf>>>,
```

- [ ] In `AppState::new()`, after `sidecar_standby: Arc::new(AtomicBool::new(false)),` add:

```rust
            last_wav_path: Arc::new(Mutex::new(None)),
```

### Step 2: Fix `cancel_recording` — sleep before buffer clear

- [ ] Replace the existing `cancel_recording` function (lines ~171-180):

```rust
#[tauri::command]
async fn cancel_recording(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    state.recording.store(false, Ordering::SeqCst);
    // Give the cpal callback one tick to finish its current batch before we clear
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    state.audio_buffer.lock().unwrap().clear();
    hide_voicebar(&app);
    Ok(())
}
```

### Step 3: Guard `recording-started` emission against early cancel

- [ ] In `start_audio_capture`, find the line `app.emit("recording-started", ()).ok();` (around line 1306) and wrap it:

```rust
        // Only emit if recording wasn't cancelled before the stream opened
        if stop_flag.load(Ordering::SeqCst) {
            app.emit("recording-started", ()).ok();
        }
```

### Step 4: Use unique WAV path per recording

- [ ] In `finalize_recording`, find this line (around line 1416):

```rust
    let wav_path = std::env::temp_dir().join("voicenote_recording.wav");
```

Replace with:

```rust
    let wav_path = std::env::temp_dir().join(format!("voicenote_{}.wav", now_millis()));
```

- [ ] Immediately after the line `*state.sidecar_stdin.lock().unwrap() = Some(stdin);` (after writing wav path to stdin, around line 1452), store the path:

```rust
            state.sidecar_last_used_ms.store(now_millis(), Ordering::SeqCst);
            state.sidecar_standby.store(false, Ordering::SeqCst);
            *state.last_wav_path.lock().unwrap() = Some(wav_path.clone());
```

### Step 5: Delete the WAV file after worker responds

- [ ] In `spawn_sidecar`, inside the stdout reader thread, in the `TRANSCRIPT:` arm (after `state_for_stdout.sidecar_busy.store(false, ...)`) add:

```rust
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
```

- [ ] In the `ERROR:` arm (after `state_for_stdout.sidecar_busy.store(false, ...)`) add the same cleanup:

```rust
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
```

### Step 6: Replace linear resampler with rubato

- [ ] At the top of `lib.rs`, add the rubato import after the existing `use` statements:

```rust
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
```

- [ ] Replace the entire `resample_to_16khz` function (lines ~1323-1344) with:

```rust
fn resample_to_16khz(samples: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == 16_000 {
        return samples.to_vec();
    }
    let ratio = 16_000.0_f64 / from_rate as f64;
    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    let chunk = samples.len().max(1);
    let mut resampler = match SincFixedIn::<f32>::new(ratio, 2.0, params, chunk, 1) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Resampler init failed ({e}), using linear fallback");
            return resample_linear(samples, from_rate);
        }
    };
    let waves_in = vec![samples.to_vec()];
    match resampler.process(&waves_in, None) {
        Ok(out) => out.into_iter().next().unwrap_or_default(),
        Err(e) => {
            eprintln!("Resampler process failed ({e}), using linear fallback");
            resample_linear(samples, from_rate)
        }
    }
}

fn resample_linear(samples: &[f32], from_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / 16_000.0;
    let out_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - pos.floor()) as f32;
        let s0 = samples.get(idx).copied().unwrap_or(0.0);
        let s1 = samples.get(idx + 1).copied().unwrap_or(0.0);
        out.push(s0 + (s1 - s0) * frac);
    }
    out
}
```

- [ ] **Step 7: Compile and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors or warnings about unused imports.

---

## Task 5: Rust — Sidecar Management (`src-tauri/src/lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Issues fixed:** #2 (busy guard on re-entry), #5 (double-spawn race), #12 (health check all files), #14 (test_microphone opens a stream)

### Step 1: Add `sidecar_spawning` field to `AppState`

- [ ] In the `AppState` struct, after `sidecar_standby`, add:

```rust
    /// Guards against concurrent spawn attempts; set to true while spawn_sidecar
    /// is in progress, cleared once stdin handle is stored.
    sidecar_spawning: Arc<AtomicBool>,
```

- [ ] In `AppState::new()`, after `sidecar_standby: Arc::new(AtomicBool::new(false)),` add:

```rust
            sidecar_spawning: Arc::new(AtomicBool::new(false)),
```

### Step 2: Guard `handle_shortcut_pressed` against re-entry while transcribing

- [ ] At the very top of `handle_shortcut_pressed` (after the `println!` and emit), add:

```rust
    if state.sidecar_busy.load(Ordering::SeqCst) {
        return;
    }
```

### Step 3: Fix double-spawn race in `spawn_sidecar`

- [ ] At the top of `spawn_sidecar`, replace the existing guard:

```rust
    if state.sidecar_stdin.lock().unwrap().is_some() {
        return;
    }
```

with:

```rust
    // Atomically claim the spawn slot. If another thread already claimed it, bail.
    if state.sidecar_spawning
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    // Double-check: worker may have been spawned while we waited for the lock above.
    if state.sidecar_stdin.lock().unwrap().is_some() {
        state.sidecar_spawning.store(false, Ordering::SeqCst);
        return;
    }
```

- [ ] After the line `*state.sidecar_stdin.lock().unwrap() = Some(stdin);`, add:

```rust
    state.sidecar_spawning.store(false, Ordering::SeqCst);
```

- [ ] In the `Err(e)` branch of `command.spawn()` (where we return early on spawn failure), before the `return;` add:

```rust
            state.sidecar_spawning.store(false, Ordering::SeqCst);
```

### Step 4: Fix `run_health_check` to test all 4 model files

- [ ] Replace the body of `run_health_check`:

```rust
#[tauri::command]
async fn run_health_check(app: AppHandle) -> Result<HealthStatus, String> {
    let worker = worker_binary_path();
    let worker_exists = worker.exists();
    let model_dir = model_data_dir(&app).unwrap_or_default();
    let model_exists = MODEL_FILES.iter().all(|spec| model_dir.join(spec.name).exists());
    Ok(HealthStatus {
        worker_path: worker.to_string_lossy().into_owned(),
        worker_exists,
        model_dir: model_dir.to_string_lossy().into_owned(),
        model_exists,
    })
}
```

### Step 5: Fix `test_microphone` to actually open a stream

- [ ] Replace the entire `test_microphone` function:

```rust
#[tauri::command]
async fn test_microphone(state: tauri::State<'_, SharedState>) -> Result<MicrophoneTestResult, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let preferred_name = state.mic_device.lock().unwrap().clone();

    let device = if let Some(ref name) = preferred_name {
        host.input_devices()
            .ok()
            .and_then(|mut iter| iter.find(|d| d.name().ok().as_ref() == Some(name)))
            .or_else(|| host.default_input_device())
    } else {
        host.default_input_device()
    };

    let device = match device {
        Some(d) => d,
        None => return Ok(MicrophoneTestResult {
            ok: false,
            message: "No input device found.".to_string(),
        }),
    };

    let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => return Ok(MicrophoneTestResult {
            ok: false,
            message: format!("Cannot read config for '{}': {}", device_name, e),
        }),
    };

    let stream = device.build_input_stream(
        &config.into(),
        |_data: &[f32], _| {},
        |err| eprintln!("mic test stream error: {}", err),
        Some(std::time::Duration::from_millis(200)),
    );

    match stream {
        Ok(s) => {
            if let Err(e) = s.play() {
                return Ok(MicrophoneTestResult {
                    ok: false,
                    message: format!("Cannot activate '{}': {}", device_name, e),
                });
            }
            drop(s);
            Ok(MicrophoneTestResult {
                ok: true,
                message: format!("Microphone '{}' is ready.", device_name),
            })
        }
        Err(e) => Ok(MicrophoneTestResult {
            ok: false,
            message: format!("Cannot open '{}': {}", device_name, e),
        }),
    }
}
```

- [ ] **Step 6: Compile and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles without errors.

---

## Task 6: Rust — State & Settings (`src-tauri/src/lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Issues fixed:** #6 (brand name), #10 (hotkey rollback), #15 (get_default_shortcut command), #16 (color validation), #19 (LogicalPosition restore), #21 (completion_sound), #22 (page alias)

### Step 1: Fix brand name in onboarding window title

- [ ] In `open_onboarding` (around line 1101), change:

```rust
        .title("Welcome to WhisperVoice")
```
to:
```rust
        .title("VoiceNote Setup")
```

### Step 2: Fix page alias in model-missing startup hint

- [ ] Around line 2102, change:

```rust
                    open_settings_page(&app_model_hint, Some("models"));
```
to:
```rust
                    open_settings_page(&app_model_hint, Some("model"));
```

### Step 3: Add hex color validation helper and use it in `set_waveform_color`

- [ ] Add this function just before `set_waveform_color`:

```rust
fn is_valid_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    matches!(b.first(), Some(&b'#'))
        && matches!(b.len(), 4 | 7)
        && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}
```

- [ ] In `set_waveform_color`, after the empty-check add:

```rust
    if !is_valid_hex_color(&color) {
        return Err("Color must be a valid hex value (#RGB or #RRGGBB)".to_string());
    }
```

### Step 4: Add `completion_sound` to `AppState`

- [ ] In `AppState`, after `onboarding_completed`, add:

```rust
    /// Whether to play a short chime when transcription completes.
    completion_sound: Arc<AtomicBool>,
```

- [ ] In `AppState::new()`, after `onboarding_completed: Arc::new(AtomicBool::new(false)),` add:

```rust
            completion_sound: Arc::new(AtomicBool::new(false)),
```

### Step 5: Add `completion_sound` to `AppSettings`

- [ ] In the `AppSettings` struct, after `onboarding_completed`, add:

```rust
    #[serde(default)]
    completion_sound: bool,
```

### Step 6: Wire `completion_sound` into save/load

- [ ] In `save_app_settings`, add to the `AppSettings { ... }` literal:

```rust
        completion_sound: state.completion_sound.load(Ordering::SeqCst),
```

- [ ] In `load_app_settings`, after the `onboarding_completed` store call, add:

```rust
    state.completion_sound.store(settings.completion_sound, Ordering::SeqCst);
```

### Step 7: Add `get_completion_sound` and `set_completion_sound` commands

- [ ] Add both commands after `get_debug_mic_level`/`set_debug_mic_level`:

```rust
#[tauri::command]
async fn get_completion_sound(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    Ok(state.completion_sound.load(Ordering::SeqCst))
}

#[tauri::command]
async fn set_completion_sound(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    enabled: bool,
) -> Result<(), String> {
    state.completion_sound.store(enabled, Ordering::SeqCst);
    save_app_settings(&app, state.inner().clone())
}
```

### Step 8: Add `get_default_shortcut` command

- [ ] Add after `get_shortcut`:

```rust
#[tauri::command]
async fn get_default_shortcut() -> &'static str {
    DEFAULT_SHORTCUT
}
```

### Step 9: Propagate hotkey rollback failure

- [ ] In `set_shortcut`, replace the rollback block (around lines 742-746):

```rust
    if !hotkey_is_registered(&app, state.inner(), shortcut.as_str()) {
        let _ = unregister_hotkey(&app, state.inner().clone(), shortcut.as_str());
        let _ = register_hotkey(&app, state.inner().clone(), &old);
        return Err(format!("Shortcut '{}' could not be activated on this system", shortcut));
    }
```

with:

```rust
    if !hotkey_is_registered(&app, state.inner(), shortcut.as_str()) {
        let _ = unregister_hotkey(&app, state.inner().clone(), shortcut.as_str());
        return match register_hotkey(&app, state.inner().clone(), &old) {
            Ok(()) => Err(format!(
                "Shortcut '{}' could not be activated on this system",
                shortcut
            )),
            Err(e2) => Err(format!(
                "Shortcut '{}' could not be activated, and restoring '{}' also failed: {}. \
                 Restart the app to recover recording.",
                shortcut, old, e2
            )),
        };
    }
```

### Step 10: Fix position restore to use logical coordinates

- [ ] In the `setup` closure, find the position restore block (around line 2037):

```rust
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
```

Replace with:

```rust
                    let _ = win.set_position(tauri::LogicalPosition::new(x as f64, y as f64));
```

### Step 11: Register new commands in `invoke_handler`

- [ ] In `tauri::generate_handler![...]`, add the three new commands:

```rust
            get_completion_sound,
            set_completion_sound,
            get_default_shortcut,
```

### Step 12: Compile and verify

- [ ] Run: `cargo build --manifest-path src-tauri/Cargo.toml`

Expected: compiles without errors. No unused variable warnings for the new fields.

---

## Task 7: Fix `src/windows/VoiceBar.tsx`

**Files:**
- Modify: `src/windows/VoiceBar.tsx`

**Issues fixed:** #8 (watchdog removed), #9 (AudioContext lifecycle), #19 (DPI fix), #21 (completionSound from Rust)

- [ ] **Step 1: Replace the entire file**

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import Waveform from "../components/Waveform";
import { AlertIcon, CheckIcon, GearIcon, MicIcon, StopIcon, XIcon } from "../ui/icons";
import { IconButton } from "../ui/controls";

type State = "idle" | "recording" | "processing" | "done" | "error" | "cancelled";

export default function VoiceBar() {
  const [state, setState]           = useState<State>("idle");
  const [visible, setVisible]       = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [lastError, setLastError]   = useState<string | null>(null);
  const [level, setLevel]           = useState(0);
  const [waveColor, setWaveColor]   = useState("#3082ff");
  const [shortcut, setShortcut]     = useState("RCtrl");
  const [elapsed, setElapsed]       = useState(0);
  const [completionSound, setCompletionSound] = useState(false);

  const doneHideTimerRef   = useRef<number | null>(null);
  const errorHideTimerRef  = useRef<number | null>(null);
  const cancelHideTimerRef = useRef<number | null>(null);
  // Single AudioContext reused across transcriptions; closed on unmount.
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Recording elapsed timer
  useEffect(() => {
    if (state !== "recording") { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    // Load initial state from backend
    invoke<boolean>("get_voicebar_visible").then(setVisible).catch(console.error);
    invoke<string>("get_waveform_color").then(setWaveColor).catch(console.error);
    invoke<string>("get_shortcut").then(setShortcut).catch(console.error);
    invoke<boolean>("get_completion_sound").then(setCompletionSound).catch(console.error);

    // Cold-start safeguard: if the hotkey was pressed before our event listeners
    // registered, sync state from backend. Run a few one-shot checks then stop —
    // the event-driven listeners handle all transitions after that.
    const syncOnce = () => {
      invoke<{ recording: boolean }>("get_shortcut_status")
        .then((s) => {
          if (s.recording) {
            setVisible(true);
            setState((prev) => (prev === "idle" ? "recording" : prev));
            setStatusText((prev) => (prev === "Ready" ? "Listening…" : prev));
          }
        })
        .catch(console.error);
    };
    syncOnce();
    const t1 = window.setTimeout(syncOnce, 250);
    const t2 = window.setTimeout(syncOnce, 900);

    const unlistenStart = listen("recording-started", () => {
      clearHideTimers();
      setVisible(true);
      setState("recording");
      setStatusText("Listening…");
      setLastError(null);
    });

    const unlistenShortcut = listen<{ state?: string }>("shortcut-triggered", (event) => {
      if (event.payload?.state === "pressed") setVisible(true);
    });

    const unlistenStop = listen("recording-stopped", () => {
      setState("processing");
      setStatusText("Transcribing…");
    });

    const unlistenWorkerStatus = listen<{ message: string }>("sidecar-status", (event) => {
      setState(s => {
        if (s === "processing") setStatusText(event.payload.message);
        return s;
      });
    });

    const unlistenDone = listen<{ text: string }>("transcript-ready", (event) => {
      clearHideTimers();
      setState("done");
      setLastError(null);
      const t = event.payload.text;
      setStatusText(t.slice(0, 64) + (t.length > 64 ? "…" : ""));

      // Read completionSound from state captured at event time via ref
      setCompletionSound((current) => {
        if (current) {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
          const ctx = audioCtxRef.current;
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
        return current;
      });

      doneHideTimerRef.current = window.setTimeout(hideAndReset, 1600);
    });

    const unlistenError = listen<{ message: string }>("transcription-error", (event) => {
      clearHideTimers();
      setState("error");
      setLastError(event.payload.message);
      setStatusText(event.payload.message);
      errorHideTimerRef.current = window.setTimeout(hideAndReset, 2500);
    });

    const unlistenLevel = listen<number>("recording-level", (event) => {
      setLevel(event.payload);
    });

    const unlistenColor = listen<{ color: string }>("waveform-color-changed", (event) => {
      if (event.payload?.color) setWaveColor(event.payload.color);
    });

    const unlistenShow = listen("voicebar-show", () => {
      clearHideTimers();
      setVisible(true);
    });

    const unlistenHide = listen("voicebar-hide", () => {
      hideAndReset();
    });

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      clearHideTimers();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      unlistenStart.then(fn => fn());
      unlistenStop.then(fn => fn());
      unlistenDone.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenLevel.then(fn => fn());
      unlistenColor.then(fn => fn());
      unlistenWorkerStatus.then(fn => fn());
      unlistenShortcut.then(fn => fn());
      unlistenShow.then(fn => fn());
      unlistenHide.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") setLevel(0);
  }, [state]);

  async function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select")) return;
    const win = getCurrentWindow();
    const startOuter = await win.outerPosition();
    const startX = e.screenX;
    const startY = e.screenY;

    const onMove = async (ev: PointerEvent) => {
      const dx = ev.screenX - startX;
      const dy = ev.screenY - startY;
      await win.setPosition(new LogicalPosition(startOuter.x + dx, startOuter.y + dy));
    };

    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      const pos = await win.outerPosition();
      // Convert physical pixels → logical pixels before persisting
      const dpr = window.devicePixelRatio || 1;
      await invoke("set_voicebar_position", {
        x: Math.round(pos.x / dpr),
        y: Math.round(pos.y / dpr),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function handleStop() {
    void invoke("stop_recording").catch(console.error);
  }

  function handleCancel() {
    if (isError || isIdle) { hideAndReset(); return; }
    if (state === "cancelled") return;
    void invoke("cancel_recording").catch(console.error);
    clearHideTimers();
    setState("cancelled");
    setStatusText("Cancelled");
    setLastError(null);
    setLevel(0);
    cancelHideTimerRef.current = window.setTimeout(hideAndReset, 700);
  }

  async function openSettings() {
    await invoke("open_settings_page_command", { page: "diagnostics" }).catch(console.error);
  }

  function hideAndReset() {
    clearHideTimers();
    setState("idle");
    setStatusText("Ready");
    setVisible(false);
    setLevel(0);
    setLastError(null);
    document.documentElement.removeAttribute("data-vb");
  }

  function clearHideTimers() {
    if (doneHideTimerRef.current !== null) {
      window.clearTimeout(doneHideTimerRef.current);
      doneHideTimerRef.current = null;
    }
    if (errorHideTimerRef.current !== null) {
      window.clearTimeout(errorHideTimerRef.current);
      errorHideTimerRef.current = null;
    }
    if (cancelHideTimerRef.current !== null) {
      window.clearTimeout(cancelHideTimerRef.current);
      cancelHideTimerRef.current = null;
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  const isRecording  = state === "recording";
  const isProcessing = state === "processing";
  const isDone       = state === "done";
  const isError      = state === "error";
  const isIdle       = state === "idle";
  const isCancelled  = state === "cancelled";

  return (
    <div className={`pill-shell ${visible ? "" : "pill-shell--hidden"}`}>
      <div className={`pill pill--${state}`} onPointerDown={handleDragStart}>
        <div className="pill-mic">
          <MicIcon className="pill-mic-icon" />
        </div>

        <div className="pill-body">
          {isRecording && (
            <>
              <div className="pill-wave">
                <Waveform active={true} level={level} color={waveColor} />
              </div>
              <div className="pill-timer">{fmt(elapsed)}</div>
            </>
          )}
          {isProcessing && (
            <div className="pill-status">
              <div className="pill-dots"><span /><span /><span /></div>
              <span className="pill-status-text pill-status-text--muted">{statusText}</span>
            </div>
          )}
          {isDone && (
            <div className="pill-status">
              <div className="pill-check"><CheckIcon /></div>
              <span className="pill-status-text pill-status-text--done">{statusText}</span>
            </div>
          )}
          {isError && (
            <div className="pill-status">
              <div className="pill-alert"><AlertIcon /></div>
              <span className="pill-status-text pill-status-text--error" title={lastError ?? statusText}>
                {statusText}
              </span>
            </div>
          )}
          {isCancelled && (
            <div className="pill-status">
              <div className="pill-cancelled"><XIcon /></div>
              <span className="pill-status-text pill-status-text--muted">Cancelled</span>
            </div>
          )}
          {isIdle && (
            <div className="pill-status">
              <div className="pill-hint">
                <kbd>{shortcut}</kbd>
                <span className="pill-hint-text">to record</span>
              </div>
            </div>
          )}
        </div>

        <div className="pill-actions">
          {isRecording && (
            <IconButton className="pill-action" variant="primary" onClick={handleStop} label="Stop recording">
              <StopIcon />
            </IconButton>
          )}
          {isError && lastError && (
            <IconButton className="pill-action" onClick={() => void openSettings()} label="Open diagnostics">
              <GearIcon />
            </IconButton>
          )}
          {(isRecording || isProcessing || isError || isIdle) && (
            <IconButton
              className="pill-action"
              variant={isError ? "danger" : "ghost"}
              onClick={handleCancel}
              label={isError ? "Dismiss" : "Cancel"}
            >
              <XIcon />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

## Task 8: Fix `src/windows/Settings.tsx`

**Files:**
- Modify: `src/windows/Settings.tsx`

**Issues fixed:** #4 (waveform color source-of-truth), #6 (provider message), #7 (brand name), #15 (default shortcut), #21 (completionSound via Rust)

- [ ] **Step 1: Remove `DEFAULT_SHORTCUT` constant and fix brand name + accent init**

Find the top of the `Settings` component (line ~93) and the `DEFAULT_SHORTCUT` constant at line 10. Apply these changes:

Remove from line 10:
```typescript
const DEFAULT_SHORTCUT = "ControlRight";
```

In the `Settings` component, replace the `accent` state initialization:
```tsx
// BEFORE:
const [accent, setAccent] = useState(localStorage.getItem("settings.waveColor") || "#0A84FF");

// AFTER:
const [accent, setAccent] = useState("#0A84FF");
```

Add a `useEffect` to load the color from Rust (place it after the existing `navigate-to-page` listener effect):
```tsx
useEffect(() => {
  void invoke<string>("get_waveform_color").then(setAccent).catch(console.error);
}, []);
```

Change the chrome title (line ~123):
```tsx
// BEFORE:
<div className="wv-chrome-title">WhisperVoice Settings</div>

// AFTER:
<div className="wv-chrome-title">VoiceNote Settings</div>
```

Change the sidebar brand name (line ~172):
```tsx
// BEFORE:
<div className="wv-brand-name">WhisperVoice</div>

// AFTER:
<div className="wv-brand-name">VoiceNote</div>
```

- [ ] **Step 2: Fix `GeneralTab` — completionSound via Rust**

Replace the `completionSound` state initialization in `GeneralTab`:
```tsx
// BEFORE:
const [completionSound, setCompletionSound] = useState<boolean>(
  () => localStorage.getItem("settings.completionSound") === "true"
);

// AFTER:
const [completionSound, setCompletionSound] = useState(false);
```

In `GeneralTab`'s `useEffect`, add alongside the other `invoke` calls:
```tsx
void invoke<boolean>("get_completion_sound")
  .then(setCompletionSound)
  .catch((e) => showErr(`Could not load completion sound: ${String(e)}`));
```

Replace `toggleCompletionSound`:
```tsx
// BEFORE:
const toggleCompletionSound = () => {
  const next = !completionSound;
  setCompletionSound(next);
  localStorage.setItem("settings.completionSound", String(next));
  showOk(`Completion sound ${next ? "enabled" : "disabled"}.`);
};

// AFTER:
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
```

Update the ToggleSwitch call to pass the async handler:
```tsx
<ToggleSwitch label="Sound on completion" on={completionSound} onToggle={() => void toggleCompletionSound()} />
```

- [ ] **Step 3: Fix `ShortcutTab` — load default shortcut from shared constant**

Add import at top of file:
```tsx
import { DEFAULT_SHORTCUT } from "../lib/shortcutUtils";
```

In `ShortcutTab`, the `recordingShortcut` state is already initialized to `DEFAULT_SHORTCUT`. Now that we import it from `shortcutUtils`, the constant is still `"ControlRight"` — this just moves the definition to one place.

- [ ] **Step 4: Fix `MicrophoneTab` — remove localStorage for waveform color**

In `MicrophoneTab`, inside the `onChange` handler for the color input, remove:
```tsx
localStorage.setItem("settings.waveColor", c);
```

The block should become:
```tsx
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
```

- [ ] **Step 5: Fix `AppearanceTab` — remove localStorage for waveform color**

In `AppearanceTab`, inside the swatch `onClick`, remove:
```tsx
localStorage.setItem("settings.waveColor", c);
```

The onClick body becomes:
```tsx
onClick={() => {
  if (colorBusy) return;
  setColorBusy(true);
  onAccentChange(c);
  void invoke("set_waveform_color", { color: c })
    .then(() => showOk("Accent color updated."))
    .catch((err) => showErr(`Failed to update accent color: ${String(err)}`))
    .finally(() => setColorBusy(false));
}}
```

- [ ] **Step 6: Fix `ModelTab` — provider change message**

In `onProviderChange`, replace the hardcoded status message:
```tsx
// BEFORE:
setProviderStatus({ requested: next, effective: "unknown", message: "Provider changed. Restart app to apply." });
showOk("Provider updated. Restart app to fully apply.");

// AFTER:
setProviderStatus({ requested: next, effective: "starting", message: "Reinitializing worker…" });
showOk("Provider updated. Worker is reinitializing.");
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

## Task 9: Fix `src/windows/Onboarding.tsx`

**Files:**
- Modify: `src/windows/Onboarding.tsx`

**Issues fixed:** #7 (brand name), #13 (dedup normalizeShortcutFromEvent), #15 (DEFAULT_SHORTCUT from shared constant)

- [ ] **Step 1: Add import and remove duplicates**

Add at top (after existing imports):
```tsx
import { DEFAULT_SHORTCUT, normalizeShortcutFromEvent } from "../lib/shortcutUtils";
```

Remove both of these from `Onboarding.tsx`:
- The entire local `normalizeShortcutFromEvent` function (lines 15–68)
- The local `const DEFAULT_SHORTCUT = "ControlRight";` constant (line 13)

- [ ] **Step 2: Fix brand name strings**

Make these three replacements:

```tsx
// Line ~78 — status initial text:
// BEFORE: text: "Setting up WhisperVoice...",
// AFTER:  text: "Setting up VoiceNote...",

// Chrome title (~line 187):
// BEFORE: <div className="wv-chrome-title">WhisperVoice Setup</div>
// AFTER:  <div className="wv-chrome-title">VoiceNote Setup</div>

// Step 0 description (~line 198):
// BEFORE: <p>WhisperVoice records while you hold a shortcut...
// AFTER:  <p>VoiceNote records while you hold a shortcut...
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors. No reference to the removed local function or constant.

---

## Task 10: Fix `src-tauri/tauri.conf.json` — Enable bundle

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Enable the bundle**

Change:
```json
"bundle": {
  "active": false,
  "targets": "all"
}
```
to:
```json
"bundle": {
  "active": true,
  "targets": "all"
}
```

- [ ] **Step 2: Verify a dev build still works**

Run: `cargo tauri dev` (or `npm run tauri dev`)
Expected: app launches without errors.

---

## Self-Review Checklist

All 22 issues are mapped to tasks:

| # | Issue | Task |
|---|-------|------|
| 1 | UUID WAV path | 4 |
| 2 | sidecar_busy guard | 5 |
| 3 | cancel race | 4 |
| 4 | waveform color source-of-truth | 6, 8 |
| 5 | double-spawn race | 5 |
| 6 | provider change message | 8 |
| 7 | brand name | 6, 8, 9 |
| 8 | 120ms watchdog | 7 |
| 9 | AudioContext leak | 7 |
| 10 | hotkey rollback | 6 |
| 11 | rubato resampler | 3, 4 |
| 12 | health check all files | 5 |
| 13 | normalizeShortcutFromEvent dedup | 1, 9 |
| 14 | test_microphone opens stream | 5 |
| 15 | DEFAULT_SHORTCUT | 1, 8, 9 |
| 16 | color validation | 6 |
| 17 | waveform level ref | 2 |
| 18 | broken default color | 2 |
| 19 | DPI consistency | 6, 7 |
| 20 | bundle.active | 10 |
| 21 | completionSound to Rust | 6, 7, 8 |
| 22 | page alias | 6 |
