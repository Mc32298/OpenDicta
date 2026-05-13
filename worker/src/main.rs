/// voicenote-worker — native Rust ASR sidecar
///
/// Replaces the Python/NeMo sidecar with a lightweight native binary that:
///   - Uses sherpa-onnx (which wraps ONNX Runtime) for Parakeet inference
///   - Speaks the same stdin/stdout protocol as the old Python sidecar
///   - Loads the model lazily on first use (low idle RAM)
///   - Can drop the model from RAM on __CMD__:UNLOAD_MODEL
///
/// Protocol (same as Python version so Tauri host needs no changes):
///   Tauri → worker:   <absolute_path_to_wav_file>\n
///   Tauri → worker:   __CMD__:UNLOAD_MODEL\n
///   worker → Tauri:   READY\n
///   worker → Tauri:   TRANSCRIPT:<text>\n
///   worker → Tauri:   ERROR:<message>\n
///   worker → Tauri:   STATUS:<message>\n  (to stderr only)

use std::io::{self, BufRead, Write};
use std::path::PathBuf;

mod audio;
mod model;

fn send(line: &str) {
    println!("{}", line);
    let _ = io::stdout().flush();
}

/// Send a STATUS line on stdout so the Tauri host can forward it to the UI.
/// Use eprintln! for dev-only noise that shouldn't reach the frontend.
fn send_status(msg: &str) {
    send(&format!("STATUS:{}", msg));
}

fn main() {
    // Tell Tauri the process is alive before loading anything heavy.
    send("READY");

    let mut recognizer: Option<sherpa_onnx::OfflineRecognizer> = None;

    for raw in io::stdin().lock().lines() {
        let Ok(raw) = raw else { break };
        let line = raw.trim().to_string();
        if line.is_empty() {
            continue;
        }

        // ── Control commands ──────────────────────────────────────────────────
        if line == "__CMD__:UNLOAD_MODEL" {
            drop(recognizer.take());
            eprintln!("STATUS: Model unloaded from RAM");
            continue;
        }

        if line == "__CMD__:WARMUP" {
            // Load the model now so it's in memory by the time the WAV arrives.
            // Sent by the host as soon as recording starts.
            if recognizer.is_none() {
                send_status("Loading model…");
                match model::load() {
                    Ok(r) => {
                        send_status("Model ready");
                        recognizer = Some(r);
                    }
                    Err(e) => {
                        send(&format!("ERROR: Could not load ASR model — {}", e));
                    }
                }
            }
            continue;
        }

        // ── Lazy model load ───────────────────────────────────────────────────
        if recognizer.is_none() {
            send_status("Loading model…");
            match model::load() {
                Ok(r) => {
                    send_status("Transcribing…");
                    recognizer = Some(r);
                }
                Err(e) => {
                    send(&format!("ERROR: Could not load ASR model — {}", e));
                    continue;
                }
            }
        } else {
            send_status("Transcribing…");
        }

        // ── Transcription ─────────────────────────────────────────────────────
        let wav_path = PathBuf::from(&line);
        if !wav_path.exists() {
            send(&format!("ERROR: Audio file not found: {}", line));
            continue;
        }

        match transcribe(recognizer.as_ref().unwrap(), &wav_path) {
            Ok(text) => send(&format!("TRANSCRIPT:{}", text)),
            Err(e) => send(&format!("ERROR: Transcription failed — {}", e)),
        }
    }
}

fn transcribe(
    recognizer: &sherpa_onnx::OfflineRecognizer,
    path: &PathBuf,
) -> Result<String, Box<dyn std::error::Error>> {
    // Read WAV and resample to 16 kHz mono (Parakeet requirement)
    let (samples, sample_rate) = audio::read_wav_mono_16k(path)?;

    // Create a per-request stream, feed audio, decode
    let stream = recognizer.create_stream();
    stream.accept_waveform(sample_rate as i32, &samples);
    recognizer.decode(&stream);

    let text = stream
        .get_result()
        .ok_or("recognizer returned no result")?
        .text;
    Ok(text.trim().to_string())
}
