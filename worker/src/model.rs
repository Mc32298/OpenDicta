/// Load Parakeet-TDT 0.6B v3 (INT8) via sherpa-onnx.
///
/// Required model files (place all four in the model dir):
///   encoder.int8.onnx  — encoder network  (~270 MB)
///   decoder.int8.onnx  — decoder network  (~5 MB)
///   joiner.int8.onnx   — joiner network   (~1 MB)
///   tokens.txt         — vocabulary       (~2 KB)
///
/// Download from (no account required):
///   https://huggingface.co/k2-fsa/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
///
/// Model search order:
///   1. <exe_dir>/models/parakeet/
///   2. %APPDATA%/voicenote/models/parakeet/   (Windows)
///   3. ~/.local/share/voicenote/models/parakeet/  (Linux/macOS)
///
/// GPU: set env var VOICENOTE_PROVIDER=cuda  (NVIDIA) or directml  (Windows generic GPU)

use std::path::PathBuf;
use sherpa_onnx::{
    OfflineCanaryModelConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, OfflineWhisperModelConfig,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SttEngine {
    Parakeet,
    ParakeetV2En,
    WhisperLargeV3,
    CanaryQwen25b,
}

impl SttEngine {
    fn from_env() -> Self {
        match std::env::var("VOICENOTE_STT_ENGINE")
            .unwrap_or_else(|_| "parakeet".to_string())
            .trim()
            .to_lowercase()
            .as_str()
        {
            "parakeet_v2_en" => Self::ParakeetV2En,
            "whisper_large_v3" => Self::WhisperLargeV3,
            "canary_qwen_2_5b" => Self::CanaryQwen25b,
            _ => Self::Parakeet,
        }
    }
}

pub fn load() -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    let engine = SttEngine::from_env();
    let dir = find_model_dir(engine)?;
    check_files(&dir, engine)?;

    let provider = std::env::var("VOICENOTE_PROVIDER")
        .unwrap_or_else(|_| "cpu".to_string());
    let input_lang = std::env::var("VOICENOTE_INPUT_LANG")
        .unwrap_or_else(|_| "auto".to_string())
        .trim()
        .to_lowercase();

    let num_threads = num_cpus().min(4) as i32;

    // Log detail to stderr (dev console); the "Loading model…" STATUS line
    // that reaches the UI is sent by main.rs before calling this function.
    eprintln!(
        "[worker] Loading STT model from {} (engine={:?} language={} provider={} threads={})",
        dir.display(),
        match engine {
            SttEngine::Parakeet => "parakeet",
            SttEngine::ParakeetV2En => "parakeet_v2_en",
            SttEngine::WhisperLargeV3 => "whisper_large_v3",
            SttEngine::CanaryQwen25b => "canary_qwen_2_5b",
        },
        input_lang,
        provider,
        num_threads,
    );

    let mut config = OfflineRecognizerConfig::default();

    match engine {
        SttEngine::Parakeet | SttEngine::ParakeetV2En => {
            config.model_config.transducer = OfflineTransducerModelConfig {
                encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
                decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
                joiner: Some(dir.join("joiner.int8.onnx").to_string_lossy().into_owned()),
            };
            config.model_config.model_type = Some("nemo_transducer".to_string());
        }
        SttEngine::WhisperLargeV3 => {
            config.model_config.whisper = OfflineWhisperModelConfig {
                encoder: Some(dir.join("large-v3-encoder.int8.onnx").to_string_lossy().into_owned()),
                decoder: Some(dir.join("large-v3-decoder.int8.onnx").to_string_lossy().into_owned()),
                language: Some(input_lang),
                task: Some("transcribe".to_string()),
                tail_paddings: -1,
                enable_token_timestamps: false,
                enable_segment_timestamps: false,
            };
        }
        SttEngine::CanaryQwen25b => {
            config.model_config.canary = OfflineCanaryModelConfig {
                encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
                decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
                src_lang: Some("en".to_string()),
                tgt_lang: Some("en".to_string()),
                use_pnc: true,
            };
        }
    }
    let tokens_file = if engine == SttEngine::WhisperLargeV3 {
        if dir.join("tokens.txt").exists() {
            "tokens.txt"
        } else {
            "large-v3-tokens.txt"
        }
    } else {
        "tokens.txt"
    };
    config.model_config.tokens = Some(dir.join(tokens_file).to_string_lossy().into_owned());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider);

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create recognizer — check model files".into())
}

fn check_files(dir: &PathBuf, engine: SttEngine) -> Result<(), Box<dyn std::error::Error>> {
    let required: &[&str] = match engine {
        SttEngine::Parakeet | SttEngine::ParakeetV2En => {
            &["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]
        }
        SttEngine::WhisperLargeV3 => &["large-v3-encoder.int8.onnx", "large-v3-decoder.int8.onnx", "tokens.txt"],
        SttEngine::CanaryQwen25b => &["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"],
    };

    let missing: Vec<&str> = required
        .iter()
        .filter(|&&f| !dir.join(f).exists())
        .copied()
        .collect();

    if engine == SttEngine::WhisperLargeV3 {
        let missing_non_tokens = missing
            .iter()
            .filter(|name| **name != "tokens.txt")
            .copied()
            .collect::<Vec<_>>();
        let has_any_tokens = dir.join("tokens.txt").exists() || dir.join("large-v3-tokens.txt").exists();
        if missing_non_tokens.is_empty() && has_any_tokens {
            return Ok(());
        }
    }

    if !missing.is_empty() {
        return Err(format!(
            "Missing model files in {}: {}. Install model files for the selected STT engine.",
            dir.display(),
            missing.join(", ")
        )
        .into());
    }

    Ok(())
}

fn find_model_dir(engine: SttEngine) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let marker = match engine {
        SttEngine::WhisperLargeV3 => "large-v3-encoder.int8.onnx",
        _ => "encoder.int8.onnx",
    };
    for dir in model_dir_candidates(engine) {
        if dir.join(marker).exists() {
            return Ok(dir);
        }
    }
    // Return first candidate as the "install here" hint in error messages
    model_dir_candidates(engine)
        .into_iter()
        .next()
        .ok_or_else(|| "Could not determine model directory".into())
}

fn model_dir_candidates(engine: SttEngine) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let subdir = if engine == SttEngine::Parakeet {
        "parakeet"
    } else if engine == SttEngine::ParakeetV2En {
        "parakeet_v2_en"
    } else if engine == SttEngine::WhisperLargeV3 {
        "whisper_large_v3"
    } else {
        "canary_qwen_2_5b"
    };

    // First priority: explicit path set by the Tauri host at spawn time.
    // This guarantees the worker uses the same directory the download command wrote to.
    if let Ok(dir) = std::env::var("VOICENOTE_MODEL_DIR") {
        let base = PathBuf::from(dir);
        // Prefer engine-specific sibling dirs before generic fallback.
        if let Some(name) = base.file_name().and_then(|n| n.to_str()) {
            if name.eq_ignore_ascii_case("parakeet") {
                if let Some(parent) = base.parent() {
                    candidates.push(parent.join(subdir));
                }
            }
            if name.eq_ignore_ascii_case("parakeet_v2_en") && engine == SttEngine::Parakeet {
                if let Some(parent) = base.parent() {
                    candidates.push(parent.join("parakeet"));
                }
            }
        }
        candidates.push(base.clone());
        candidates.push(base.join(subdir));
        if let Some(name) = base.file_name().and_then(|n| n.to_str()) {
            if engine == SttEngine::ParakeetV2En && name.eq_ignore_ascii_case("parakeet") {
                if let Some(parent) = base.parent() {
                    candidates.push(parent.join("parakeet_v2_en"));
                }
            }
            if engine == SttEngine::Parakeet && name.eq_ignore_ascii_case("parakeet_v2_en") {
                if let Some(parent) = base.parent() {
                    candidates.push(parent.join("parakeet"));
                }
            }
        }
    }

    // Alongside the binary (production bundle layout)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models").join(subdir));
        }
    }

    // Platform user-data fallback (for manual model placement or dev use)
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(
            PathBuf::from(appdata)
                .join("voicenote")
                .join("models")
                .join(subdir),
        );
    }

    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("voicenote")
                .join("models")
                .join(subdir),
        );
    }

    candidates
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
