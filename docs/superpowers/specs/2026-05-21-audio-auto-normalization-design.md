# Automatic Audio Normalization — Design

**Date:** 2026-05-21
**Status:** Approved

## Problem

Users must hold the microphone close to their mouth and speak loudly for the
app to transcribe accurately. Quiet or whispered speech fails for two reasons:

1. **No gain is ever applied.** Audio is captured raw via cpal
   ([lib.rs:2612](../../../src-tauri/src/lib.rs)), downmixed to mono, resampled
   to 16 kHz, and saved straight to WAV. A quiet recording reaches the STT model
   as a very low-amplitude signal, which it transcribes poorly.
2. **A hard silence gate rejects quiet input.** `finalize_recording` drops any
   recording with `rms < 0.008` as "No speech detected"
   ([lib.rs:2792](../../../src-tauri/src/lib.rs)). Whispering trips this gate.

## Goal

Quiet and whispered speech transcribe reliably without the user changing how
they speak. Fully automatic — no settings, no UI.

## Approach: RMS normalization with peak limiter

A new pure function applied in `finalize_recording` to `samples_16khz`, after
resampling and before the silence gate and WAV save.

```
normalize_audio(samples: &mut [f32])
```

Steps:
1. Compute RMS of the recording.
2. Compute gain `= TARGET_RMS / rms` to bring the signal to a healthy speech
   level. `TARGET_RMS = 0.1` (≈ -20 dBFS).
3. Cap gain at `MAX_GAIN = 20.0` (≈ 26 dB) so a near-silent recording (pure
   noise floor) is not amplified into full-scale garbage.
4. Apply gain to every sample.
5. Hard-limit every sample to `±0.97` so the boost cannot introduce clipping
   from a loud transient.

If `rms` is 0 (empty/all-zero buffer), skip normalization (no divide-by-zero).

### Why RMS, not peak normalization

Peak normalization scales by the single loudest sample — a click, breath, or
key press — leaving the actual speech quiet. RMS targets the loudness of the
speech body, which is precisely what lifts whispers to an audible level.

## Silence gate change

The `rms < 0.008` reject ([lib.rs:2792](../../../src-tauri/src/lib.rs)) is what
currently kills whispers.

- Compute the gate's RMS on the **original** (pre-normalization) signal. (If it
  ran post-normalization, every recording including silence would be boosted to
  `TARGET_RMS` and always pass.)
- Lower the threshold from `0.008` to `0.002` so genuine whispers pass while
  empty key-taps and silence are still rejected.
- The `too_short < 0.20s` guard is unchanged.

## Out of scope (YAGNI)

- Per-window adaptive AGC / dynamic-range compression
- Noise suppression
- High-pass / low-cut filtering
- Any settings UI or mic-gain slider (user chose fully automatic)

## Testing

Unit tests for `normalize_audio` (it is pure and takes a slice):

1. **Quiet signal is boosted** — a low-amplitude sine/constant reaches ≈
   `TARGET_RMS`.
2. **Gain is capped** — a near-silent signal is amplified by no more than
   `MAX_GAIN` (does not reach full scale).
3. **No clipping** — after normalizing a signal with a loud transient, no sample
   exceeds `±0.97`.
4. **Empty / all-zero buffer** — does not panic and does not produce NaN.
5. **Already-loud signal** — gain ≤ 1, output not clipped/distorted.

Gate behavior is covered by the existing `finalize_recording` path; verify
manually that a whisper now transcribes and a silent tap is still rejected.

## Constants summary

| Constant     | Value | Meaning                                  |
|--------------|-------|------------------------------------------|
| `TARGET_RMS` | 0.1   | Target loudness (≈ -20 dBFS)             |
| `MAX_GAIN`   | 20.0  | Max amplification (≈ 26 dB)              |
| limiter      | 0.97  | Hard ceiling on sample magnitude         |
| gate RMS     | 0.002 | Below this (pre-normalization) = rejected|
