/// Read a WAV file and return (mono_f32_samples, sample_rate_hz).
///
/// Handles:
///   - Any bit depth hound supports (i16, i32, f32)
///   - Stereo / multi-channel → downmixed to mono by averaging
///   - Any sample rate → resampled to 16 000 Hz via linear interpolation
///     (Parakeet-TDT requires 16 kHz mono input)
use std::path::PathBuf;

pub fn read_wav_mono_16k(
    path: &PathBuf,
) -> Result<(Vec<f32>, u32), Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let native_rate = spec.sample_rate;

    // ── Decode all samples to f32 ─────────────────────────────────────────────
    let raw_f32: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()?,

        (hound::SampleFormat::Int, 16) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<Result<Vec<_>, _>>()?,

        (hound::SampleFormat::Int, 24) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / 8_388_607.0))
            .collect::<Result<Vec<_>, _>>()?,

        (hound::SampleFormat::Int, 32) => reader
            .samples::<i32>()
            .map(|s| s.map(|v| v as f32 / i32::MAX as f32))
            .collect::<Result<Vec<_>, _>>()?,

        (fmt, bits) => {
            return Err(format!("Unsupported WAV format: {:?} {}‑bit", fmt, bits).into())
        }
    };

    // ── Downmix to mono ───────────────────────────────────────────────────────
    let mono: Vec<f32> = if channels == 1 {
        raw_f32
    } else {
        raw_f32
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    // ── Resample to 16 kHz ────────────────────────────────────────────────────
    let target_rate: u32 = 16_000;
    let resampled = if native_rate == target_rate {
        mono
    } else {
        resample_linear(&mono, native_rate, target_rate)
    };

    Ok((resampled, target_rate))
}

/// Linear interpolation resampler — good enough for speech (no aliasing
/// artifacts that matter for ASR above Nyquist of 8 kHz content).
fn resample_linear(samples: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
    let ratio = from_hz as f64 / to_hz as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
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
