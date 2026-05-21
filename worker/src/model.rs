/// Load ASR model via sherpa-onnx.
///
/// Model is selected by the OPENDICTA_MODEL_ID environment variable:
///   "parakeet"             — Parakeet-TDT 0.6B v3 (INT8), NeMo Transducer
///   "canary_qwen_2_5b"     — Canary-Qwen-2.5B (INT8), NeMo Canary
///   "whisper_small"        — Whisper Small (INT8)
///   "whisper_medium"       — Whisper Medium (INT8)
///   "whisper_large"        — Whisper Large v2 (INT8)
///   "whisper_large_v3_turbo" — Whisper Large v3 Turbo (INT8)
///
/// Model files are expected in the directory set by OPENDICTA_MODEL_DIR.
///
/// GPU: set env var OPENDICTA_PROVIDER=cuda  (NVIDIA) or directml  (Windows generic GPU)

use std::path::PathBuf;
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig,
    OfflineTransducerModelConfig, OfflineCanaryModelConfig, OfflineWhisperModelConfig,
    OfflineQwen3ASRModelConfig,
};

pub fn load() -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    let model_id = std::env::var("OpenDicta_MODEL_ID")
        .unwrap_or_else(|_| "parakeet".to_string());

    let dir = find_model_dir(&model_id)?;

    let provider = std::env::var("OpenDicta_PROVIDER")
        .unwrap_or_else(|_| "cpu".to_string());
    let num_threads = num_cpus().min(4) as i32;

    eprintln!(
        "[worker] Loading model '{}' from {} (provider={} threads={})",
        model_id, dir.display(), provider, num_threads
    );

    match model_id.as_str() {
        "canary_qwen_2_5b" => load_canary(&dir, &provider, num_threads),
        id @ ("whisper_small" | "whisper_medium" | "whisper_large" | "whisper_large_v3_turbo") => {
            load_whisper(id, &dir, &provider, num_threads)
        }
        "qwen3_asr" => load_qwen3_asr(&dir, &provider, num_threads),
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
    let raw_lang = std::env::var("OpenDicta_LANGUAGE").unwrap_or_else(|_| "en".to_string());
    let canary_lang = if ["en", "de", "es", "fr"].contains(&raw_lang.as_str()) {
        raw_lang
    } else {
        "en".to_string()
    };
    config.model_config.canary = OfflineCanaryModelConfig {
        encoder: Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned()),
        decoder: Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned()),
        src_lang: Some(canary_lang.clone()),
        tgt_lang: Some(canary_lang),
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

fn load_whisper(
    model_id: &str,
    dir: &PathBuf,
    provider: &str,
    num_threads: i32,
) -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    let (encoder_name, decoder_name, tokens_name) = match model_id {
        "whisper_small" => (
            "small-encoder.int8.onnx",
            "small-decoder.int8.onnx",
            "small-tokens.txt",
        ),
        "whisper_medium" => (
            "medium-encoder.int8.onnx",
            "medium-decoder.int8.onnx",
            "medium-tokens.txt",
        ),
        "whisper_large" => (
            "large-v2-encoder.int8.onnx",
            "large-v2-decoder.int8.onnx",
            "large-v2-tokens.txt",
        ),
        _ => (
            "turbo-encoder.int8.onnx",
            "turbo-decoder.int8.onnx",
            "turbo-tokens.txt",
        ),
    };

    check_files(dir, &[encoder_name, decoder_name, tokens_name])?;

    let lang = std::env::var("OpenDicta_LANGUAGE").unwrap_or_else(|_| "en".to_string());
    let mut config = OfflineRecognizerConfig::default();
    let mut whisper = OfflineWhisperModelConfig::default();
    whisper.encoder = Some(dir.join(encoder_name).to_string_lossy().into_owned());
    whisper.decoder = Some(dir.join(decoder_name).to_string_lossy().into_owned());
    whisper.language = if lang == "auto" { None } else { Some(lang) };
    whisper.task = Some("transcribe".to_string());
    config.model_config.whisper = whisper;
    config.model_config.tokens = Some(dir.join(tokens_name).to_string_lossy().into_owned());
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider.to_string());

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create Whisper recognizer — check model files".into())
}

fn load_qwen3_asr(
    dir: &PathBuf,
    provider: &str,
    num_threads: i32,
) -> Result<OfflineRecognizer, Box<dyn std::error::Error>> {
    check_files(dir, &[
        "conv_frontend.onnx",
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "tokenizer/merges.txt",
        "tokenizer/vocab.json",
    ])?;

    let mut config = OfflineRecognizerConfig::default();
    let mut qwen3 = OfflineQwen3ASRModelConfig::default();
    qwen3.conv_frontend = Some(dir.join("conv_frontend.onnx").to_string_lossy().into_owned());
    qwen3.encoder = Some(dir.join("encoder.int8.onnx").to_string_lossy().into_owned());
    qwen3.decoder = Some(dir.join("decoder.int8.onnx").to_string_lossy().into_owned());
    qwen3.tokenizer = Some(dir.join("tokenizer").to_string_lossy().into_owned());
    config.model_config.qwen3_asr = qwen3;
    config.model_config.num_threads = num_threads;
    config.model_config.debug = false;
    config.model_config.provider = Some(provider.to_string());

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "sherpa-onnx failed to create Qwen3-ASR recognizer — check model files".into())
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
    if let Ok(dir) = std::env::var("OpenDicta_MODEL_DIR") {
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
            .join("OpenDicta")
            .join("models")
            .join(model_id));
    }

    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("OpenDicta")
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
