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
    OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig,
};

pub fn load() -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    let dir = find_model_dir()?;
    check_files(&dir)?;

    let provider = std::env::var("VOICENOTE_PROVIDER")
        .unwrap_or_else(|_| "cpu".to_string());

    let num_threads = num_cpus().min(4) as i32;

    // Log detail to stderr (dev console); the "Loading model…" STATUS line
    // that reaches the UI is sent by main.rs before calling this function.
    eprintln!(
        "[worker] Loading Parakeet-TDT from {} (provider={} threads={})",
        dir.display(),
        provider,
        num_threads,
    );

    let mut config = OfflineRecognizerConfig::default();

    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
        decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
        joiner: Some(dir.join("joiner.int8.onnx").to_string_lossy().into_owned()),
    };
    config.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().into_owned());
    config.model_config.model_type = Some("nemo_transducer".to_string());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider);

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create recognizer — check model files".into())
}

fn check_files(dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let required = [
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "joiner.int8.onnx",
        "tokens.txt",
    ];

    let missing: Vec<&str> = required
        .iter()
        .filter(|&&f| !dir.join(f).exists())
        .copied()
        .collect();

    if !missing.is_empty() {
        return Err(format!(
            "Missing model files in {}: {} — download from Settings → Model",
            dir.display(),
            missing.join(", ")
        )
        .into());
    }

    Ok(())
}

fn find_model_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    for dir in model_dir_candidates() {
        if dir.join("encoder.int8.onnx").exists() {
            return Ok(dir);
        }
    }
    // Return first candidate as the "install here" hint in error messages
    model_dir_candidates()
        .into_iter()
        .next()
        .ok_or_else(|| "Could not determine model directory".into())
}

fn model_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // First priority: explicit path set by the Tauri host at spawn time.
    // This guarantees the worker uses the same directory the download command wrote to.
    if let Ok(dir) = std::env::var("VOICENOTE_MODEL_DIR") {
        candidates.push(PathBuf::from(dir));
    }

    // Alongside the binary (production bundle layout)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models").join("parakeet"));
        }
    }

    // Platform user-data fallback (for manual model placement or dev use)
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(
            PathBuf::from(appdata)
                .join("voicenote")
                .join("models")
                .join("parakeet"),
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
                .join("parakeet"),
        );
    }

    candidates
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
