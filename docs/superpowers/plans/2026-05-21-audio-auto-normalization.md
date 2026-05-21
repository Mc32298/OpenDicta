# Automatic Audio Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boost quiet/whispered speech to a healthy level before transcription so users don't have to speak loudly or hold the mic close.

**Architecture:** Add a pure `normalize_audio` function in `src-tauri/src/lib.rs` that scales captured 16 kHz samples toward a target RMS with a capped gain and a hard limiter. Call it in `finalize_recording` after resampling. Compute the existing silence gate on the *original* (pre-normalization) signal and lower its threshold so whispers pass.

**Tech Stack:** Rust, Tauri, cpal (capture), hound (WAV), `cargo test`.

Spec: `docs/superpowers/specs/2026-05-21-audio-auto-normalization-design.md`

---

### Task 1: Add `normalize_audio` with tests

**Files:**
- Modify: `src-tauri/src/lib.rs` (add function near `resample_to_16khz`, ~line 2689; add tests in the `#[cfg(test)] mod tests` block at end of file)

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block at the bottom of `src-tauri/src/lib.rs`:

```rust
#[test]
fn normalize_boosts_quiet_signal_toward_target() {
    // Constant 0.01 amplitude → rms 0.01, should be boosted toward 0.1.
    let mut samples = vec![0.01_f32; 16_000];
    normalize_audio(&mut samples);
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    assert!(rms > 0.08 && rms <= 0.12, "rms after boost was {rms}");
}

#[test]
fn normalize_caps_gain_for_near_silent_signal() {
    // rms ~1e-5; uncapped gain would be ~10000x. Cap is 20x → stays tiny.
    let mut samples = vec![0.00001_f32; 16_000];
    normalize_audio(&mut samples);
    let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
    assert!(peak <= 0.0002, "near-silent signal over-amplified: peak {peak}");
}

#[test]
fn normalize_never_clips_with_loud_transient() {
    // Quiet body + one full-scale spike. Boost must not push anything past 0.97.
    let mut samples = vec![0.02_f32; 16_000];
    samples[0] = 1.0;
    normalize_audio(&mut samples);
    let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
    assert!(peak <= 0.97, "output clipped: peak {peak}");
}

#[test]
fn normalize_handles_empty_and_silent_buffers() {
    let mut empty: Vec<f32> = vec![];
    normalize_audio(&mut empty); // must not panic

    let mut silent = vec![0.0_f32; 1_000];
    normalize_audio(&mut silent);
    assert!(silent.iter().all(|s| s.is_finite() && *s == 0.0));
}

#[test]
fn normalize_does_not_amplify_already_loud_signal() {
    // rms ~0.3 already above target → gain <= 1, no clipping.
    let mut samples = vec![0.3_f32; 16_000];
    normalize_audio(&mut samples);
    let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
    assert!(peak <= 0.97);
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    assert!(rms <= 0.31, "already-loud signal was amplified: rms {rms}");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test normalize`
Expected: FAIL — `cannot find function 'normalize_audio' in this scope`.

- [ ] **Step 3: Write the implementation**

Add immediately above `fn resample_to_16khz` (~line 2689) in `src-tauri/src/lib.rs`:

```rust
/// Boost quiet recordings toward a healthy speech level so whispers and
/// far-from-mic speech transcribe reliably. RMS-targeted with a capped gain
/// (so silence isn't blown up into noise) and a hard limiter (so the boost
/// can't introduce clipping). Pure and in-place. No-op on empty/silent input.
fn normalize_audio(samples: &mut [f32]) {
    const TARGET_RMS: f32 = 0.1; // ≈ -20 dBFS
    const MAX_GAIN: f32 = 20.0; // ≈ 26 dB
    const LIMIT: f32 = 0.97;

    if samples.is_empty() {
        return;
    }

    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum_sq / samples.len() as f32).sqrt();
    if rms <= 0.0 {
        return;
    }

    let gain = (TARGET_RMS / rms).min(MAX_GAIN);
    if gain <= 1.0 {
        // Already at or above target — don't pull it down, just protect against
        // any pre-existing clipping.
        for s in samples.iter_mut() {
            *s = s.clamp(-LIMIT, LIMIT);
        }
        return;
    }

    for s in samples.iter_mut() {
        *s = (*s * gain).clamp(-LIMIT, LIMIT);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test normalize`
Expected: PASS — all 5 `normalize_*` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Add normalize_audio: RMS-targeted gain with limiter"
```

---

### Task 2: Apply normalization and relax the silence gate in `finalize_recording`

**Files:**
- Modify: `src-tauri/src/lib.rs:2778-2808` (the resample + silence-gate block in `finalize_recording`)

- [ ] **Step 1: Read the current block**

Confirm the current code at `src-tauri/src/lib.rs:2778-2808` matches the `old_string` below before editing.

- [ ] **Step 2: Apply the edit**

Replace this block:

```rust
    // 4. Resample from device rate to 16kHz (no-op if already 16kHz)
    let device_rate = *state.device_sample_rate.lock().unwrap();
    let samples_16khz = resample_to_16khz(&samples, device_rate);

    // 4b. Fast no-speech guard: skip worker call for extremely short or silent input.
    // This avoids getting stuck in "Transcribing..." when the user only tapped the key.
    let duration_sec = samples_16khz.len() as f32 / 16_000.0;
    let rms = if samples_16khz.is_empty() {
        0.0
    } else {
        let sum_sq: f32 = samples_16khz.iter().map(|s| s * s).sum();
        (sum_sq / samples_16khz.len() as f32).sqrt()
    };
    let too_short = duration_sec < 0.20;
    let too_quiet = rms < 0.008;
```

with:

```rust
    // 4. Resample from device rate to 16kHz (no-op if already 16kHz)
    let device_rate = *state.device_sample_rate.lock().unwrap();
    let mut samples_16khz = resample_to_16khz(&samples, device_rate);

    // 4b. Fast no-speech guard: skip worker call for extremely short or silent input.
    // This avoids getting stuck in "Transcribing..." when the user only tapped the key.
    // The gate runs on the ORIGINAL signal — after normalization even silence
    // would be boosted to the target level and always pass.
    let duration_sec = samples_16khz.len() as f32 / 16_000.0;
    let rms = if samples_16khz.is_empty() {
        0.0
    } else {
        let sum_sq: f32 = samples_16khz.iter().map(|s| s * s).sum();
        (sum_sq / samples_16khz.len() as f32).sqrt()
    };
    let too_short = duration_sec < 0.20;
    let too_quiet = rms < 0.002;

    // Boost quiet/whispered speech toward a healthy level before saving the WAV.
    // Runs after the gate so genuine silence is still rejected above.
    normalize_audio(&mut samples_16khz);
```

Note the two functional changes: `let samples_16khz` → `let mut samples_16khz`, gate threshold `0.008` → `0.002`, and the added `normalize_audio` call placed *after* the gate's `rms`/`too_quiet` computation.

- [ ] **Step 3: Verify the build compiles and existing tests pass**

Run: `cd src-tauri && cargo test`
Expected: PASS — builds cleanly, all existing tests plus the 5 `normalize_*` tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Normalize captured audio and relax silence gate for whispers"
```

---

### Task 3: Manual verification

**Files:** none (runtime check)

- [ ] **Step 1: Build and run the app**

Run: `npm run tauri dev` (from repo root)

- [ ] **Step 2: Verify whispered speech transcribes**

Hold the dictation key and **whisper** a sentence at normal mic distance.
Expected: the words transcribe correctly (previously this failed or returned
"No speech detected").

- [ ] **Step 3: Verify silence is still rejected**

Tap the dictation key briefly with no speech.
Expected: "No speech detected" — the gate still rejects genuine silence.

- [ ] **Step 4: Verify normal-volume speech is unaffected**

Speak at normal volume.
Expected: transcribes correctly, no distortion/clipping artifacts.

---

## Self-Review Notes

- **Spec coverage:** `normalize_audio` (Task 1) implements the RMS+cap+limiter
  algorithm and all 5 spec test cases. Gate change (Task 2) implements the
  pre-normalization gate at 0.002. Manual verification (Task 3) covers the
  "whisper transcribes / silence rejected / normal unaffected" runtime checks.
- **Placeholders:** none — all code and commands are concrete.
- **Type consistency:** `normalize_audio(&mut [f32])` defined in Task 1, called
  as `normalize_audio(&mut samples_16khz)` in Task 2. Constants `TARGET_RMS`,
  `MAX_GAIN`, `LIMIT` match the spec's constants table.
