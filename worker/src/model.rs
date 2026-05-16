/// Load ASR model via sherpa-onnx.
///
/// Model is selected by the VOICENOTE_MODEL_ID environment variable:
///   "parakeet"        — Parakeet-TDT 0.6B v3 (INT8), NeMo Transducer (multilingual)
///   "canary_qwen_2_5b" — Canary-Qwen-2.5B (INT8), NeMo Canary (English only)
///
/// Model files are expected in the directory set by VOICENOTE_MODEL_DIR.
///
/// GPU: set env var VOICENOTE_PROVIDER=cuda  (NVIDIA) or directml  (Windows generic GPU)

use std::path::PathBuf;
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig,
    OfflineTransducerModelConfig, OfflineCanaryModelConfig,
};

pub fn load() -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    let model_id = std::env::var("VOICENOTE_MODEL_ID")
        .unwrap_or_else(|_| "parakeet".to_string());

    let dir = find_model_dir(&model_id)?;

    let provider = std::env::var("VOICENOTE_PROVIDER")
        .unwrap_or_else(|_| "cpu".to_string());
    let num_threads = num_cpus().min(4) as i32;

    eprintln!(
        "[worker] Loading model '{}' from {} (provider={} threads={})",
        model_id, dir.display(), provider, num_threads
    );

    match model_id.as_str() {
        "canary_qwen_2_5b" => load_canary(&dir, &provider, num_threads),
        _ => load_parakeet(&dir, &provider, num_threads),
    }
}

fn load_parakeet(
    dir: &PathBuf,
    provider: &str,
    num_threads: i32,
) -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    check_files(dir, &["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"])?;

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
        decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
        joiner:  Some(dir.join("joiner.int8.onnx").to_string_lossy().into_owned()),
    };
    config.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().into_owned());
    config.model_config.model_type = Some("nemo_transducer".to_string());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider.to_string());

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create Parakeet recognizer — check model files".into())
}

fn load_canary(
    dir: &PathBuf,
    provider: &str,
    num_threads: i32,
) -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    check_files(dir, &["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"])?;

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.canary = OfflineCanaryModelConfig {
        encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
        decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
        src_lang: Some("en".to_string()),
        tgt_lang: Some("en".to_string()),
        use_pnc: false,
    };
    config.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().into_owned());
    config.model_config.model_type = Some("nemo_canary".to_string());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider.to_string());

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create Canary recognizer — check model files".into())
}

fn check_files(dir: &PathBuf, required: &[&str]) -> Result<(), Box<dyn std::error::Error>> {
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

fn find_model_dir(model_id: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // First priority: explicit path from Tauri host.
    if let Ok(dir) = std::env::var("VOICENOTE_MODEL_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return Ok(p);
        }
    }

    // Alongside the binary (production bundle layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("models").join(model_id);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    // Platform user-data fallback.
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        return Ok(PathBuf::from(appdata)
            .join("voicenote")
            .join("models")
            .join(model_id));
    }

    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("voicenote")
            .join("models")
            .join(model_id));
    }

    Err("Could not determine model directory".into())
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
