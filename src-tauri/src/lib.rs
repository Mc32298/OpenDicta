//! VoiceNote — Rust backend
//!
//! Responsibilities:
//!   - System tray + menu
//!   - Global hotkey (hold to record, release to transcribe)
//!   - Real microphone capture via cpal
//!   - WAV file saving via hound
//!   - voicenote-worker sidecar management (Parakeet TDT 0.6B v3 via sherpa-onnx)
//!   - Auto-paste via enigo (types text into the active app)

use std::io::Write;
use std::path::Path;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use sha2::{Digest, Sha256};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEFAULT_SHORTCUT: &str = "ControlRight";

#[cfg(target_os = "windows")]
const VK_RCONTROL_CODE: i32 = 0xA3;

// ─── App State ────────────────────────────────────────────────────────────────
//
// This is shared between the hotkey callback, audio thread, and Tauri commands.
// We use Arc so multiple owners can hold a reference, and AtomicBool / Mutex
// for thread-safe interior mutability.

struct AppState {
    /// true while the hotkey is held and mic is capturing
    recording: Arc<AtomicBool>,

    /// Raw f32 PCM samples from the microphone, collected during recording
    audio_buffer: Arc<Mutex<Vec<f32>>>,

    /// The sample rate the device actually gave us (may not be 16kHz)
    device_sample_rate: Arc<Mutex<u32>>,

    /// How many channels the device gave us (1 = mono, 2 = stereo)
    device_channels: Arc<Mutex<u16>>,

    /// stdin of the running voicenote-worker process.
    /// We write WAV file paths here; the worker transcribes and replies on stdout.
    sidecar_stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    /// Child process handle for the running worker.
    sidecar_child: Arc<Mutex<Option<std::process::Child>>>,
    /// Last time sidecar was used (unix epoch millis).
    sidecar_last_used_ms: Arc<AtomicU64>,
    /// True while a transcription request is in flight.
    sidecar_busy: Arc<AtomicBool>,
    /// True when sidecar is idle in warm standby.
    sidecar_standby: Arc<AtomicBool>,
    /// Guards against concurrent spawn attempts; set to true while spawn_sidecar
    /// is in progress, cleared once stdin handle is stored.
    sidecar_spawning: Arc<AtomicBool>,
    /// Path of the WAV file currently being processed by the worker.
    /// Set in finalize_recording, cleared and deleted by the stdout reader.
    last_wav_path: Arc<Mutex<Option<std::path::PathBuf>>>,

    /// Active global hotkey in Tauri shortcut format (example: "F8" or "Ctrl+KeyA")
    shortcut: Arc<Mutex<String>>,
    /// Signal to stop the native RightCtrl listener thread.
    right_ctrl_stop: Arc<AtomicBool>,
    /// True while native RightCtrl listener is active.
    right_ctrl_active: Arc<AtomicBool>,

    /// Last known voicebar top-left position in logical pixels.
    voicebar_pos: Arc<Mutex<Option<(i32, i32)>>>,
    /// Whether the voicebar should currently be visible (frontend truth source).
    voicebar_visible: Arc<AtomicBool>,

    /// Preferred input device name. None means use system default.
    mic_device: Arc<Mutex<Option<String>>>,

    /// Whether to expose mic level debug telemetry.
    debug_mic_level: Arc<AtomicBool>,

    /// Waveform color (hex/CSS)
    waveform_color: Arc<Mutex<String>>,

    /// Active ASR model identifier.
    asr_model: Arc<Mutex<String>>,
    /// Active ASR backend identifier.
    asr_backend: Arc<Mutex<String>>,
    /// Runtime profile for memory/performance tradeoff.
    runtime_profile: Arc<Mutex<String>>,
    /// ONNX execution provider: "cpu" | "cuda" | "directml"
    onnx_provider: Arc<Mutex<String>>,
    /// Runtime view of provider selection/effective backend.
    provider_runtime: Arc<Mutex<ProviderRuntimeStatus>>,
    /// HuggingFace API token for model downloads (optional, stored in OS keyring)
    hf_token: Arc<Mutex<Option<String>>>,
    /// True once onboarding has been completed by the user.
    onboarding_completed: Arc<AtomicBool>,
}

#[derive(Clone, serde::Serialize)]
struct ProviderRuntimeStatus {
    requested: String,
    effective: String,
    message: String,
}

impl AppState {
    fn new() -> Self {
        Self {
            recording: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            device_sample_rate: Arc::new(Mutex::new(16_000)),
            device_channels: Arc::new(Mutex::new(1)),
            sidecar_stdin: Arc::new(Mutex::new(None)),
            sidecar_child: Arc::new(Mutex::new(None)),
            sidecar_last_used_ms: Arc::new(AtomicU64::new(now_millis())),
            sidecar_busy: Arc::new(AtomicBool::new(false)),
            sidecar_standby: Arc::new(AtomicBool::new(false)),
            sidecar_spawning: Arc::new(AtomicBool::new(false)),
            last_wav_path: Arc::new(Mutex::new(None)),
            shortcut: Arc::new(Mutex::new(DEFAULT_SHORTCUT.to_string())),
            right_ctrl_stop: Arc::new(AtomicBool::new(false)),
            right_ctrl_active: Arc::new(AtomicBool::new(false)),
            voicebar_pos: Arc::new(Mutex::new(None)),
            voicebar_visible: Arc::new(AtomicBool::new(false)),
            mic_device: Arc::new(Mutex::new(None)),
            debug_mic_level: Arc::new(AtomicBool::new(false)),
            waveform_color: Arc::new(Mutex::new("#3082ff".to_string())),
            asr_model: Arc::new(Mutex::new("small".to_string())),
            asr_backend: Arc::new(Mutex::new("faster-whisper".to_string())),
            runtime_profile: Arc::new(Mutex::new("balanced".to_string())),
            onnx_provider: Arc::new(Mutex::new("cpu".to_string())),
            provider_runtime: Arc::new(Mutex::new(ProviderRuntimeStatus {
                requested: "cpu".to_string(),
                effective: "unknown".to_string(),
                message: "Provider status not initialized yet".to_string(),
            })),
            hf_token: Arc::new(Mutex::new(None)),
            onboarding_completed: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn idle_timeout_ms(profile: &str) -> u64 {
    match profile {
        "low_ram" => 5_000,
        "fast_wake" => 60_000,
        _ => 25_000, // balanced
    }
}

type SharedState = Arc<AppState>;

// ─── Tauri Commands ───────────────────────────────────────────────────────────
// These are callable from the React frontend via invoke().

#[tauri::command]
async fn stop_recording(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    finalize_recording(app, state.inner().clone()).await;
    Ok(())
}

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

#[tauri::command]
async fn check_for_updates() -> Result<(), String> {
    // TODO M8: wire up tauri-plugin-updater
    println!("Checking for updates...");
    Ok(())
}

#[tauri::command]
async fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to read autostart state: {}", e))
}

#[tauri::command]
async fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn get_shortcut(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.shortcut.lock().unwrap().clone())
}

#[tauri::command]
async fn get_waveform_color(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.waveform_color.lock().unwrap().clone())
}

#[tauri::command]
async fn set_waveform_color(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    color: String,
) -> Result<(), String> {
    let color = color.trim().to_string();
    if color.is_empty() {
        return Err("Color cannot be empty".to_string());
    }
    *state.waveform_color.lock().unwrap() = color.clone();
    save_app_settings(&app, state.inner().clone())?;
    let _ = app.emit("waveform-color-changed", serde_json::json!({ "color": color }));
    Ok(())
}

#[derive(serde::Serialize)]
struct ShortcutStatus {
    shortcut: String,
    registered: bool,
    recording: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AppSettings {
    shortcut: String,
    mic_device: Option<String>,
    debug_mic_level: bool,
    #[serde(default = "default_waveform_color")]
    waveform_color: String,
    #[serde(default = "default_asr_model")]
    asr_model: String,
    #[serde(default = "default_asr_backend")]
    asr_backend: String,
    #[serde(default = "default_runtime_profile")]
    runtime_profile: String,
    #[serde(default = "default_onnx_provider")]
    onnx_provider: String,
    #[serde(default, skip_serializing)]
    hf_token: Option<String>,
    #[serde(default)]
    onboarding_completed: bool,
}

fn default_waveform_color() -> String {
    "#3082ff".to_string()
}

fn default_asr_model() -> String {
    "small".to_string()
}

fn default_asr_backend() -> String {
    "faster-whisper".to_string()
}

fn default_runtime_profile() -> String {
    "balanced".to_string()
}

fn default_onnx_provider() -> String {
    "cpu".to_string()
}

#[tauri::command]
async fn get_asr_model(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.asr_model.lock().unwrap().clone())
}

#[tauri::command]
async fn set_asr_model(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model: String,
) -> Result<(), String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("Model cannot be empty".to_string());
    }
    *state.asr_model.lock().unwrap() = model;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[tauri::command]
async fn get_asr_backend(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.asr_backend.lock().unwrap().clone())
}

#[tauri::command]
async fn set_asr_backend(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    backend: String,
) -> Result<(), String> {
    let backend = backend.trim().to_lowercase();
    // Accepted values kept for settings file compatibility; the Rust worker
    // ignores this field and always uses sherpa-onnx / ONNX Runtime.
    if backend.is_empty() {
        return Err("Backend cannot be empty".to_string());
    }
    *state.asr_backend.lock().unwrap() = backend;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[tauri::command]
async fn get_runtime_profile(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.runtime_profile.lock().unwrap().clone())
}

#[tauri::command]
async fn set_runtime_profile(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    profile: String,
) -> Result<(), String> {
    let profile = profile.trim().to_lowercase();
    if profile != "low_ram" && profile != "balanced" && profile != "fast_wake" {
        return Err("Unsupported profile. Use low_ram, balanced, or fast_wake".to_string());
    }
    *state.runtime_profile.lock().unwrap() = profile;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[tauri::command]
async fn get_onnx_provider(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.onnx_provider.lock().unwrap().clone())
}

#[tauri::command]
async fn get_provider_runtime_status(
    state: tauri::State<'_, SharedState>,
) -> Result<ProviderRuntimeStatus, String> {
    Ok(state.provider_runtime.lock().unwrap().clone())
}

#[tauri::command]
async fn set_onnx_provider(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    provider: String,
) -> Result<(), String> {
    let provider = provider.trim().to_lowercase();
    if provider != "cpu" && provider != "cuda" && provider != "directml" {
        return Err("Unsupported provider. Use cpu, cuda, or directml".to_string());
    }
    *state.onnx_provider.lock().unwrap() = provider;
    {
        let mut rt = state.provider_runtime.lock().unwrap();
        rt.requested = state.onnx_provider.lock().unwrap().clone();
        rt.effective = "unknown".to_string();
        rt.message = "Provider changed. Re-initializing worker...".to_string();
    }
    save_app_settings(&app, state.inner().clone())?;
    kill_sidecar(state.inner());
    spawn_sidecar(app.clone(), state.inner().clone());
    Ok(())
}

#[tauri::command]
async fn get_hf_token(state: tauri::State<'_, SharedState>) -> Result<Option<String>, String> {
    Ok(state.hf_token.lock().unwrap().as_ref().map(|t| mask_token(t)))
}

#[tauri::command]
async fn set_hf_token(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    token: Option<String>,
) -> Result<(), String> {
    let token = token.and_then(|t| {
        let t = t.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    save_hf_token_secret(token.as_deref())?;
    *state.hf_token.lock().unwrap() = token;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn get_voicebar_visible(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    Ok(state.voicebar_visible.load(Ordering::SeqCst))
}

#[derive(serde::Serialize)]
struct OnboardingState {
    completed: bool,
    shortcut: String,
    provider: String,
    model_installed: bool,
}

#[tauri::command]
async fn get_onboarding_state(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<OnboardingState, String> {
    let model_installed = model_data_dir(&app)
        .map(|d| d.join("encoder.int8.onnx").exists())
        .unwrap_or(false);
    Ok(OnboardingState {
        completed: state.onboarding_completed.load(Ordering::SeqCst),
        shortcut: state.shortcut.lock().unwrap().clone(),
        provider: state.onnx_provider.lock().unwrap().clone(),
        model_installed,
    })
}

#[tauri::command]
async fn complete_onboarding(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    state.onboarding_completed.store(true, Ordering::SeqCst);
    save_app_settings(&app, state.inner().clone())?;
    if let Some(win) = app.get_webview_window("onboarding") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn get_shortcut_status(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<ShortcutStatus, String> {
    let shortcut = state.shortcut.lock().unwrap().clone();
    let registered = if uses_native_right_ctrl(shortcut.as_str()) {
        state.right_ctrl_active.load(Ordering::SeqCst)
    } else {
        app.global_shortcut().is_registered(shortcut.as_str())
    };
    let recording = state.recording.load(Ordering::SeqCst);

    Ok(ShortcutStatus {
        shortcut,
        registered,
        recording,
    })
}

// ─── Model Management Commands ────────────────────────────────────────────────

/// The four files that must exist for the Parakeet-TDT worker to run.
/// Sizes match the multilingual v3 INT8 model (25 European languages).
struct ModelFileSpec {
    name: &'static str,
    expected_bytes: u64,
    sha256: Option<&'static str>,
}

const MODEL_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "encoder.int8.onnx",
        expected_bytes: 652_000_000,
        sha256: Some("acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"),
    },
    ModelFileSpec {
        name: "decoder.int8.onnx",
        expected_bytes: 11_800_000,
        sha256: Some("179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"),
    },
    ModelFileSpec {
        name: "joiner.int8.onnx",
        expected_bytes: 6_360_000,
        sha256: Some("3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"),
    },
    ModelFileSpec {
        name: "tokens.txt",
        expected_bytes: 93_900,
        // tokens.txt is checked by expected size; hash pinning is enforced for ONNX artifacts.
        sha256: None,
    },
];

/// Ordered list of base URLs to try for each model file.
/// Points to the multilingual Parakeet TDT 0.6B v3 INT8 (25 European languages:
/// Danish, English, Russian, French, German, Spanish, Polish, etc.)
const DOWNLOAD_BASES: &[&str] = &[
    "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main",
];

fn model_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("models").join("parakeet"))
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct ModelFileInfo {
    name: &'static str,
    exists: bool,
    expected_bytes: u64,
    actual_bytes: Option<u64>,
}

#[derive(serde::Serialize)]
struct ModelStatus {
    model_dir: String,
    files: Vec<ModelFileInfo>,
    all_present: bool,
}

#[tauri::command]
async fn get_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let dir = model_data_dir(&app)?;
    let mut files = Vec::new();
    let mut all_present = true;

    for spec in MODEL_FILES {
        let path = dir.join(spec.name);
        let exists = path.exists();
        let actual_bytes = if exists {
            std::fs::metadata(&path).ok().map(|m| m.len())
        } else {
            None
        };
        if !exists {
            all_present = false;
        }
        files.push(ModelFileInfo {
            name: spec.name,
            exists,
            expected_bytes: spec.expected_bytes,
            actual_bytes,
        });
    }

    Ok(ModelStatus {
        model_dir: dir.to_string_lossy().into_owned(),
        files,
        all_present,
    })
}

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    file: String,
    file_index: usize,
    file_total: usize,
    file_bytes: u64,
    file_size: u64,
    overall_percent: u8,
}

#[tauri::command]
async fn download_model(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let dir = model_data_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create model directory: {}", e))?;

    let hf_token = state.hf_token.lock().unwrap().clone();

    let client = reqwest::Client::builder()
        .user_agent("voicenote/0.1 (model-downloader)")
        .build()
        .map_err(|e| e.to_string())?;

    let total_files = MODEL_FILES.len();

    use futures_util::StreamExt;

    for (idx, spec) in MODEL_FILES.iter().enumerate() {
        let name = spec.name;
        let expected_size = spec.expected_bytes;
        let dest = dir.join(name);
        // Temp file alongside the final dest; renamed atomically on success.
        // Any leftover .tmp from a previous interrupted download is silently replaced.
        let tmp = dir.join(format!("{}.tmp", name));

        // Skip if already fully downloaded (size within 5% of expected, or tokens.txt any size)
        if dest.exists() {
            if let Ok(meta) = std::fs::metadata(&dest) {
                let size_ok = name == "tokens.txt"
                    || meta.len() >= (expected_size as f64 * 0.95) as u64;
                let hash_ok = match spec.sha256 {
                    Some(expected_sha256) => {
                        match compute_sha256_hex(&dest).await {
                            Ok(actual_sha256) => actual_sha256.eq_ignore_ascii_case(expected_sha256),
                            Err(_) => false,
                        }
                    }
                    None => true,
                };
                if size_ok && hash_ok {
                    let _ = app.emit("model-download-progress", DownloadProgress {
                        file: name.to_string(),
                        file_index: idx,
                        file_total: total_files,
                        file_bytes: meta.len(),
                        file_size: expected_size,
                        overall_percent: (((idx + 1) * 100) / total_files) as u8,
                    });
                    continue;
                }
            }
        }

        // Try each base URL in order; stop at the first that succeeds.
        let mut response = None;
        let mut last_err = String::new();
        for &base in DOWNLOAD_BASES {
            let url = format!("{}/{}", base, name);
            let mut req = client.get(&url);
            if let Some(ref token) = hf_token {
                req = req.header("Authorization", format!("Bearer {}", token));
            }
            match req.send().await {
                Err(e) => { last_err = format!("Network error: {}", e); }
                Ok(r) if r.status().is_success() => { response = Some(r); break; }
                Ok(r) => { last_err = format!("Server returned {} for {} ({})", r.status(), name, base); }
            }
        }
        let response = response.ok_or_else(|| last_err)?;

        let content_length = response.content_length().unwrap_or(expected_size);

        // Write to .tmp first — prevents a partial file being mistaken for a
        // complete one if the process is killed mid-download.
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("Could not create temp file for {}: {}", name, e))?;

        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download interrupted for {}: {}", name, e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error for {}: {}", name, e))?;
            downloaded += chunk.len() as u64;

            let overall = ((idx as f64 + downloaded as f64 / content_length as f64)
                / total_files as f64
                * 100.0) as u8;

            let _ = app.emit("model-download-progress", DownloadProgress {
                file: name.to_string(),
                file_index: idx,
                file_total: total_files,
                file_bytes: downloaded,
                file_size: content_length,
                overall_percent: overall,
            });
        }

        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);

        if let Some(expected_sha256) = spec.sha256 {
            let actual_sha256 = compute_sha256_hex(&tmp).await?;
            if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(format!(
                    "Integrity check failed for {}: expected SHA-256 {}, got {}",
                    name, expected_sha256, actual_sha256
                ));
            }
        }

        // Atomic rename: .tmp → final name
        tokio::fs::rename(&tmp, &dest)
            .await
            .map_err(|e| format!("Could not finalise {}: {}", name, e))?;
    }

    let _ = app.emit("model-download-complete", ());
    Ok(())
}

#[derive(serde::Serialize)]
struct HealthStatus {
    worker_path: String,
    worker_exists: bool,
    model_dir: String,
    model_exists: bool,
}

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

#[tauri::command]
async fn set_shortcut(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    shortcut: String,
) -> Result<(), String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("Shortcut cannot be empty".to_string());
    }

    let old = state.shortcut.lock().unwrap().clone();
    unregister_hotkey(&app, state.inner().clone(), old.as_str())?;

    if let Err(e) = register_hotkey(&app, state.inner().clone(), &shortcut) {
        // Best effort rollback so app still has a working hotkey
        let _ = register_hotkey(&app, state.inner().clone(), &old);
        return Err(e);
    }
    if !hotkey_is_registered(&app, state.inner(), shortcut.as_str()) {
        let _ = unregister_hotkey(&app, state.inner().clone(), shortcut.as_str());
        let _ = register_hotkey(&app, state.inner().clone(), &old);
        return Err(format!("Shortcut '{}' could not be activated on this system", shortcut));
    }

    *state.shortcut.lock().unwrap() = shortcut;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[tauri::command]
async fn set_voicebar_position(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    *state.voicebar_pos.lock().unwrap() = Some((x, y));
    save_voicebar_position(&app, Some((x, y)))
}

#[tauri::command]
async fn reset_voicebar_position(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    *state.voicebar_pos.lock().unwrap() = None;
    save_voicebar_position(&app, None)?;
    if let Some(win) = app.get_webview_window("voicebar") {
        let _ = win.center();
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct AudioInputInfo {
    default_device: Option<String>,
    devices: Vec<String>,
    selected_device: Option<String>,
}

#[tauri::command]
async fn get_audio_input_info(state: tauri::State<'_, SharedState>) -> Result<AudioInputInfo, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();

    let default_device = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    if let Ok(iter) = host.input_devices() {
        for d in iter {
            if let Ok(name) = d.name() {
                devices.push(name);
            }
        }
    }

    Ok(AudioInputInfo {
        default_device,
        devices,
        selected_device: state.mic_device.lock().unwrap().clone(),
    })
}

#[derive(serde::Serialize)]
struct MicrophoneTestResult {
    ok: bool,
    message: String,
}

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

#[tauri::command]
async fn set_audio_input_device(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    device_name: Option<String>,
) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let normalized = device_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(ref name) = normalized {
        let host = cpal::default_host();
        let mut found = false;
        if let Ok(iter) = host.input_devices() {
            for d in iter {
                if let Ok(n) = d.name() {
                    if &n == name {
                        found = true;
                        break;
                    }
                }
            }
        }
        if !found {
            return Err(format!("Input device not found: {}", name));
        }
    }

    *state.mic_device.lock().unwrap() = normalized;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[tauri::command]
async fn get_debug_mic_level(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    Ok(state.debug_mic_level.load(Ordering::SeqCst))
}

#[tauri::command]
async fn set_debug_mic_level(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    enabled: bool,
) -> Result<(), String> {
    state.debug_mic_level.store(enabled, Ordering::SeqCst);
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct VoicebarPosition {
    x: i32,
    y: i32,
}

fn voicebar_position_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("voicebar-position.json"))
}

fn save_voicebar_position(app: &AppHandle, position: Option<(i32, i32)>) -> Result<(), String> {
    let file = voicebar_position_path(app)?;
    match position {
        Some((x, y)) => {
            let payload = serde_json::to_string(&VoicebarPosition { x, y })
                .map_err(|e| format!("Failed to serialize voicebar position: {}", e))?;
            std::fs::write(file, payload)
                .map_err(|e| format!("Failed to save voicebar position: {}", e))
        }
        None => {
            if file.exists() {
                std::fs::remove_file(file)
                    .map_err(|e| format!("Failed to remove voicebar position: {}", e))?;
            }
            Ok(())
        }
    }
}

fn load_voicebar_position(app: &AppHandle) -> Option<(i32, i32)> {
    let file = voicebar_position_path(app).ok()?;
    let text = std::fs::read_to_string(file).ok()?;
    let pos: VoicebarPosition = serde_json::from_str(&text).ok()?;
    Some((pos.x, pos.y))
}

fn app_settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

fn save_app_settings(app: &AppHandle, state: SharedState) -> Result<(), String> {
    let file = app_settings_path(app)?;
    let settings = AppSettings {
        shortcut: state.shortcut.lock().unwrap().clone(),
        mic_device: state.mic_device.lock().unwrap().clone(),
        debug_mic_level: state.debug_mic_level.load(Ordering::SeqCst),
        waveform_color: state.waveform_color.lock().unwrap().clone(),
        asr_model: state.asr_model.lock().unwrap().clone(),
        asr_backend: state.asr_backend.lock().unwrap().clone(),
        runtime_profile: state.runtime_profile.lock().unwrap().clone(),
        onnx_provider: state.onnx_provider.lock().unwrap().clone(),
        hf_token: None,
        onboarding_completed: state.onboarding_completed.load(Ordering::SeqCst),
    };
    let payload = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize app settings: {}", e))?;
    std::fs::write(file, payload)
        .map_err(|e| format!("Failed to save app settings: {}", e))
}

fn load_app_settings(app: &AppHandle, state: SharedState) {
    let Ok(file) = app_settings_path(app) else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(file) else {
        return;
    };
    let Ok(settings) = serde_json::from_str::<AppSettings>(&text) else {
        return;
    };
    *state.shortcut.lock().unwrap() = settings.shortcut;
    *state.mic_device.lock().unwrap() = settings.mic_device;
    state
        .debug_mic_level
        .store(settings.debug_mic_level, Ordering::SeqCst);
    *state.waveform_color.lock().unwrap() = settings.waveform_color;
    *state.asr_model.lock().unwrap() = settings.asr_model;
    *state.asr_backend.lock().unwrap() = settings.asr_backend;
    *state.runtime_profile.lock().unwrap() = settings.runtime_profile;
    *state.onnx_provider.lock().unwrap() = settings.onnx_provider;
    let keyring_token = load_hf_token_secret();
    *state.hf_token.lock().unwrap() = keyring_token.clone().or(settings.hf_token.clone());
    if keyring_token.is_none() {
        if let Some(legacy) = settings.hf_token.as_deref() {
            if !legacy.trim().is_empty() {
                if let Err(err) = save_hf_token_secret(Some(legacy)) {
                    eprintln!("Failed to migrate HF token to keyring: {}", err);
                }
            }
        }
    }
    state
        .onboarding_completed
        .store(settings.onboarding_completed, Ordering::SeqCst);
    {
        let provider = state.onnx_provider.lock().unwrap().clone();
        let mut rt = state.provider_runtime.lock().unwrap();
        rt.requested = provider.clone();
        rt.effective = "unknown".to_string();
        rt.message = format!("Configured provider is '{}'. Start recording to verify runtime backend.", provider);
    }
}

fn hf_token_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.voicenote.app", "huggingface_token")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn load_hf_token_secret() -> Option<String> {
    let entry = hf_token_keyring_entry().ok()?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        }
        Err(_) => None,
    }
}

fn save_hf_token_secret(token: Option<&str>) -> Result<(), String> {
    let entry = hf_token_keyring_entry()?;
    match token {
        Some(value) => entry
            .set_password(value)
            .map_err(|e| format!("Failed to save token in keyring: {}", e)),
        None => match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete token from keyring: {}", e)),
        },
    }
}

fn mask_token(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() <= 8 {
        return "********".to_string();
    }
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("********{}", suffix)
}

async fn compute_sha256_hex(path: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("Could not open file for hashing ({}): {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];

    loop {
        let bytes = file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("Could not read file for hashing ({}): {}", path.display(), e))?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

// ─── Window Helpers ───────────────────────────────────────────────────────────

fn show_voicebar(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("voicebar") {
        if let Some(state) = app.try_state::<SharedState>() {
            state.voicebar_visible.store(true, Ordering::SeqCst);
        }
        // Set a data attribute directly on <html> so the voicebar becomes visible
        // immediately — even before the React event listener has been registered
        // with the Tauri backend. The CSS rule :root[data-vb="1"] overrides the
        // pill-shell--hidden class, so no event round-trip is needed for the
        // first-press case.
        let _ = win.eval("document.documentElement.setAttribute('data-vb','1');");
        let _ = win.emit("voicebar-show", ());
    }
}

fn hide_voicebar(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("voicebar") {
        if let Some(state) = app.try_state::<SharedState>() {
            state.voicebar_visible.store(false, Ordering::SeqCst);
        }
        let _ = win.eval("document.documentElement.removeAttribute('data-vb');");
        let _ = win.emit("voicebar-hide", ());
    }
}

fn open_settings(app: &AppHandle) {
    open_settings_page(app, None);
}

fn open_onboarding(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("onboarding") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "onboarding",
            tauri::WebviewUrl::App("/?window=onboarding".into()),
        )
        .title("Welcome to WhisperVoice")
        .inner_size(760.0, 520.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build();
    }
}

fn open_settings_page(app: &AppHandle, page: Option<&str>) {
    let url = match page {
        Some(p) => format!("/?window=settings&page={}", p),
        None => "/?window=settings".to_string(),
    };
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        // Navigate to the requested page if a specific one was requested
        if let Some(p) = page {
            let _ = win.emit("navigate-to-page", p);
        }
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "settings",
            tauri::WebviewUrl::App(url.into()),
        )
        .title("Settings")
        .inner_size(640.0, 560.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build();
    }
}

fn open_empty_state_page(app: &AppHandle, tab: Option<&str>) {
    let tab = tab.unwrap_or("history");
    let url = format!("/?window=empty&tab={}", tab);
    if let Some(win) = app.get_webview_window("empty") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("navigate-empty-tab", tab);
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "empty",
            tauri::WebviewUrl::App(url.into()),
        )
        .title("Empty State")
        .inner_size(520.0, 360.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build();
    }
}

#[tauri::command]
async fn open_settings_page_command(app: AppHandle, page: Option<String>) -> Result<(), String> {
    open_settings_page(&app, page.as_deref());
    Ok(())
}

#[tauri::command]
async fn open_empty_state(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    open_empty_state_page(&app, tab.as_deref());
    Ok(())
}

// ─── M2: Audio Capture ───────────────────────────────────────────────────────
//
// cpal::Stream is !Send on some platforms, so it MUST live on the thread that
// creates it. We spawn a dedicated thread that owns the stream for its lifetime,
// and communicates via shared Arc<AtomicBool> and Arc<Mutex<Vec<f32>>>.

fn start_audio_capture(
    app: AppHandle,
    state: SharedState,
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate_out: Arc<Mutex<u32>>,
    channels_out: Arc<Mutex<u16>>,
    stop_flag: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        // Get the default host (CoreAudio on macOS, WASAPI on Windows)
        let host = cpal::default_host();

        let preferred_name = state.mic_device.lock().unwrap().clone();
        let preferred_device = preferred_name.as_ref().and_then(|name| {
            host.input_devices().ok()?.find(|d| d.name().ok().as_ref() == Some(name))
        });

        let device = match preferred_device.or_else(|| host.default_input_device()) {
            Some(d) => d,
            None => {
                app.emit(
                    "transcription-error",
                    serde_json::json!({"message": "No microphone found. Check System Preferences → Privacy → Microphone."}),
                )
                .ok();
                stop_flag.store(false, Ordering::SeqCst);
                return;
            }
        };
        if let Ok(name) = device.name() {
            println!("Using input device: {}", name);
            let _ = app.emit("audio-device-selected", serde_json::json!({ "name": name }));
        }

        // Get the default supported config from the device.
        // We'll try to use 16kHz, but if not supported we capture at native
        // rate and resample in finalize_recording().
        let default_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                app.emit(
                    "transcription-error",
                    serde_json::json!({"message": format!("Microphone config error: {}", e)}),
                )
                .ok();
                stop_flag.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Store the actual sample rate and channel count so finalize_recording
        // knows how to interpret the buffer
        let actual_rate = default_config.sample_rate().0;
        let actual_channels = default_config.channels();
        *sample_rate_out.lock().unwrap() = actual_rate;
        *channels_out.lock().unwrap() = actual_channels;

        let config: cpal::StreamConfig = default_config.into();

        // Clone references for the cpal callback (which runs on a separate thread)
        let buffer_for_callback = buffer.clone();
        let channels_for_callback = actual_channels as usize;
        let stop_for_callback = stop_flag.clone();
        let app_for_callback = app.clone();

        // Build the input stream — this sets up the mic capture pipeline
        let stream = match device.build_input_stream(
            &config,
            move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                // This callback fires repeatedly while the stream is active.
                // data contains interleaved f32 samples (e.g. [L, R, L, R, ...] for stereo)
                // `recording` is true while we want to keep capturing.
                if !stop_for_callback.load(Ordering::Relaxed) {
                    return;
                }

                // Downmix multichannel to mono by averaging channels
                let mono_iter = data.chunks(channels_for_callback).map(|frame| {
                    frame.iter().sum::<f32>() / channels_for_callback as f32
                });

                buffer_for_callback
                    .lock()
                    .unwrap()
                    .extend(mono_iter);

                // Emit a lightweight mic level (RMS) for waveform reactivity.
                let mut sum_sq = 0.0f32;
                let mut count = 0usize;
                for frame in data.chunks(channels_for_callback) {
                    let mono = frame.iter().sum::<f32>() / channels_for_callback as f32;
                    sum_sq += mono * mono;
                    count += 1;
                }
                if count > 0 {
                    let rms = (sum_sq / count as f32).sqrt();
                    let level = (rms * 8.0).clamp(0.0, 1.0);
                    let _ = app_for_callback.emit("recording-level", level);
                }
            },
            |err| eprintln!("Audio stream error: {}", err),
            None, // timeout
        ) {
            Ok(s) => s,
            Err(e) => {
                app.emit(
                    "transcription-error",
                    serde_json::json!({"message": format!("Failed to open microphone: {}", e)}),
                )
                .ok();
                stop_flag.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            app.emit(
                "transcription-error",
                serde_json::json!({"message": format!("Failed to start mic: {}", e)}),
            )
            .ok();
            return;
        }

        // Tell the frontend the waveform can start animating
        if stop_flag.load(Ordering::SeqCst) {
            app.emit("recording-started", ()).ok();
        }

        // Keep this thread (and the stream) alive until the stop flag is set.
        // The stream is dropped automatically when this thread ends.
        while stop_flag.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // stream drops here → mic capture stops
        drop(stream);
    });
}

// ─── M2: Audio Processing & WAV ──────────────────────────────────────────────

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

/// Write mono f32 PCM samples as a 16kHz WAV file.
/// hound handles the RIFF header and chunk layout for us.
fn save_wav(samples: &[f32], path: &std::path::Path) -> Result<(), hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        writer.write_sample(s)?;
    }
    writer.finalize()
}

// ─── M2: Finalize Recording ───────────────────────────────────────────────────

async fn finalize_recording(app: AppHandle, state: SharedState) {
    // 1. Signal the audio thread to stop
    state.recording.store(false, Ordering::SeqCst);

    // 2. Give the audio thread a moment to flush its last batch of samples
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    // 3. Grab the captured samples and leave the buffer empty for next time
    let samples = {
        let mut buf = state.audio_buffer.lock().unwrap();
        std::mem::take(&mut *buf)
    };

    if samples.is_empty() {
        app.emit(
            "transcription-error",
            serde_json::json!({"message": "No audio recorded — try holding the key longer."}),
        )
        .ok();
        state.sidecar_busy.store(false, Ordering::SeqCst);
        hide_voicebar(&app);
        return;
    }

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
    if too_short || too_quiet {
        let reason = if too_short { "No speech detected (too short)." } else { "No speech detected." };
        app.emit("transcription-error", serde_json::json!({"message": reason})).ok();
        state.sidecar_busy.store(false, Ordering::SeqCst);
        hide_voicebar(&app);
        return;
    }

    // Tell the frontend to show "Transcribing…" only after speech presence checks pass.
    app.emit("recording-stopped", ()).ok();

    // 5. Save to a temp WAV file
    let wav_path = std::env::temp_dir().join(format!("voicenote_{}.wav", now_millis()));
    if let Err(e) = save_wav(&samples_16khz, &wav_path) {
        app.emit(
            "transcription-error",
            serde_json::json!({"message": format!("Failed to save audio: {}", e)}),
        )
        .ok();
        state.sidecar_busy.store(false, Ordering::SeqCst);
        hide_voicebar(&app);
        return;
    }

    // 6. Send the WAV path to the worker via stdin
    //    The worker transcribes it and replies on stdout (handled in spawn_sidecar)
    {
        let stdin_missing = state.sidecar_stdin.lock().unwrap().is_none();
        if stdin_missing {
            // Sidecar may be offloaded; spawn on demand.
            spawn_sidecar(app.clone(), state.clone());
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        }
    }

    let mut stdin_guard = state.sidecar_stdin.lock().unwrap();
    match stdin_guard.as_mut() {
        Some(stdin) => {
            if let Err(e) = writeln!(stdin, "{}", wav_path.display()) {
                app.emit(
                    "transcription-error",
                    serde_json::json!({"message": format!("STT engine not responding: {}", e)}),
                )
                .ok();
                hide_voicebar(&app);
                state.sidecar_busy.store(false, Ordering::SeqCst);
            }
            state.sidecar_busy.store(true, Ordering::SeqCst);
            state.sidecar_last_used_ms.store(now_millis(), Ordering::SeqCst);
            state.sidecar_standby.store(false, Ordering::SeqCst);
            *state.last_wav_path.lock().unwrap() = Some(wav_path.clone());
            // Transcript will arrive as a "transcript-ready" event from the
            // background stdout-reader thread (see spawn_sidecar below)
        }
        None => {
            app.emit(
                "transcription-error",
                serde_json::json!({"message": "STT engine is not running. Is voicenote-worker.exe built? Run: cargo build -p voicenote-worker"}),
            )
            .ok();
            hide_voicebar(&app);
            state.sidecar_busy.store(false, Ordering::SeqCst);
        }
    }
}

// ─── Rust Worker Sidecar ──────────────────────────────────────────────────────
//
// voicenote-worker is a compiled Rust binary (same workspace) that runs
// Parakeet-TDT via sherpa-onnx / ONNX Runtime. It speaks the same
// stdin/stdout protocol as the old Python sidecar. No Python required.
//
// The worker is spawned on-demand (lazy) and killed when idle, so its
// ONNX Runtime + model memory is fully returned to the OS between uses.

fn worker_binary_path() -> std::path::PathBuf {
    // Dev: Cargo puts the binary in {workspace_root}/target/{profile}/
    // CARGO_MANIFEST_DIR = {workspace_root}/src-tauri  →  go one level up.
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir.join("..");

    #[cfg(debug_assertions)]
    let profile = "debug";
    #[cfg(not(debug_assertions))]
    let profile = "release";

    #[cfg(target_os = "windows")]
    let bin_name = "voicenote-worker.exe";
    #[cfg(not(target_os = "windows"))]
    let bin_name = "voicenote-worker";

    let dev_path = workspace_root.join("target").join(profile).join(bin_name);
    if dev_path.exists() {
        return dev_path;
    }

    // Production: Tauri bundles externalBin next to the app executable.
    // Depending on bundle flow, the binary can be either:
    //   - voicenote-worker(.exe)
    //   - voicenote-worker-<target-triple>(.exe)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let prod_path = dir.join(bin_name);
            if prod_path.exists() {
                return prod_path;
            }

            // Accept target-triple suffixed worker name too.
            #[cfg(target_os = "windows")]
            {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.starts_with("voicenote-worker-") && name.ends_with(".exe") {
                                return path;
                            }
                        }
                    }
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.starts_with("voicenote-worker-") {
                                return path;
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: hope it's on PATH
    std::path::PathBuf::from(bin_name)
}

fn spawn_sidecar(app: AppHandle, state: SharedState) {
    // Atomically claim the spawn slot. If another thread already claimed it, bail.
    if state.sidecar_spawning
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    // Double-check: worker may have been spawned while we waited.
    if state.sidecar_stdin.lock().unwrap().is_some() {
        state.sidecar_spawning.store(false, Ordering::SeqCst);
        return;
    }

    let program = worker_binary_path();
    eprintln!("Spawning worker: {}", program.display());

    let provider = state.onnx_provider.lock().unwrap().clone();
    {
        let mut rt = state.provider_runtime.lock().unwrap();
        rt.requested = provider.clone();
        rt.effective = "starting".to_string();
        rt.message = format!("Starting worker with requested provider '{}'", provider);
    }
    let _ = app.emit(
        "provider-runtime-status",
        state.provider_runtime.lock().unwrap().clone(),
    );

    // Pass the exact model dir so the worker doesn't have to guess.
    // model_data_dir() uses Tauri's app_data_dir() which is the same
    // path used by the download command — they will always agree.
    let model_dir = model_data_dir(&app)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let mut command = std::process::Command::new(&program);
    command
        .env("VOICENOTE_PROVIDER", &provider)
        .env("VOICENOTE_MODEL_DIR", &model_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to spawn sidecar: {}", e);
            app.emit(
                "transcription-error",
                serde_json::json!({"message": format!("Could not start STT engine: {}", e)}),
            )
            .ok();
            state.sidecar_spawning.store(false, Ordering::SeqCst);
            return;
        }
    };

    // Store stdin so finalize_recording() can send WAV paths to the sidecar
    let stdin = child.stdin.take().unwrap();
    *state.sidecar_stdin.lock().unwrap() = Some(stdin);
    state.sidecar_spawning.store(false, Ordering::SeqCst);
    state.sidecar_last_used_ms.store(now_millis(), Ordering::SeqCst);
    state.sidecar_standby.store(false, Ordering::SeqCst);

    // ── Stdout reader thread ──
    // This thread blocks on reading the sidecar's stdout.
    // When the sidecar finishes transcribing, it prints a line and we emit
    // a Tauri event that VoiceBar.tsx is listening for.
    let app_stdout = app.clone();
    let stdout = child.stdout.take().unwrap();
    let state_for_stdout = state.clone();

    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(text) if text.is_empty() => continue,
                Ok(text) if text == "READY" => {
                    println!("STT engine ready ✓");
                    // Trigger model load immediately so it's warm by the time
                    // the user finishes speaking and we send the WAV path.
                    if let Some(ref mut stdin) = *state_for_stdout.sidecar_stdin.lock().unwrap() {
                        let _ = writeln!(stdin, "__CMD__:WARMUP");
                    }
                }
                Ok(text) if text.starts_with("ERROR:") => {
                    let msg = text[6..].trim().to_string();
                    eprintln!("Sidecar error: {}", msg);
                    app_stdout
                        .emit("transcription-error", serde_json::json!({"message": msg}))
                        .ok();

                    // Hide the bar on error
                    hide_voicebar(&app_stdout);
                    state_for_stdout
                        .sidecar_busy
                        .store(false, Ordering::SeqCst);
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                Ok(text) if text.starts_with("STATUS:") => {
                    let msg = text["STATUS:".len()..].to_string();
                    println!("[worker] {}", msg);
                    // Forward to VoiceBar so it can show the current worker state
                    let _ = app_stdout.emit("sidecar-status", serde_json::json!({ "message": msg }));
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                }
                Ok(text) if text.starts_with("TRANSCRIPT:") => {
                    let transcript = text["TRANSCRIPT:".len()..].trim().to_string();
                    if transcript.is_empty() {
                        continue;
                    }
                    println!("Transcript: {}", transcript);

                    // Auto-paste the transcript into the previously active app
                    paste_text(&transcript);

                    // Notify the Voice Bar UI
                    app_stdout
                        .emit(
                            "transcript-ready",
                            serde_json::json!({"text": transcript}),
                        )
                        .ok();
                    state_for_stdout
                        .sidecar_busy
                        .store(false, Ordering::SeqCst);
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                Ok(other) => {
                    // Ignore non-protocol stdout noise from dependencies.
                    println!("Ignored sidecar stdout: {}", other);
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                }
                Err(e) => {
                    eprintln!("Sidecar stdout error: {}", e);
                    break;
                }
            }
        }
    });

    // ── Stderr reader thread ──
    // Forward worker stderr (sherpa-onnx / ONNX Runtime logs) to our console in dev mode
    let stderr = child.stderr.take().unwrap();
    let state_for_stderr = state.clone();
    let app_stderr = app.clone();
    let requested_provider = provider.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().flatten() {
            eprintln!("[sidecar] {}", line);
            if line.contains("Fallback to cpu") {
                let mut rt = state_for_stderr.provider_runtime.lock().unwrap();
                rt.requested = requested_provider.clone();
                rt.effective = "cpu".to_string();
                rt.message = format!(
                    "Requested '{}' but runtime fell back to CPU. Rebuild worker with GPU support.",
                    requested_provider
                );
                let _ = app_stderr.emit("provider-runtime-status", rt.clone());
            } else if line.contains("Loading Parakeet-TDT") && line.contains("provider=") {
                // If no fallback is reported, the configured provider is considered active.
                let mut rt = state_for_stderr.provider_runtime.lock().unwrap();
                rt.requested = requested_provider.clone();
                if rt.effective == "starting" || rt.effective == "unknown" {
                    rt.effective = requested_provider.clone();
                    rt.message = format!("Using provider '{}'", requested_provider);
                    let _ = app_stderr.emit("provider-runtime-status", rt.clone());
                }
            }
            state_for_stderr
                .sidecar_last_used_ms
                .store(now_millis(), Ordering::SeqCst);
        }
    });

    // Keep child handle so we can offload on idle.
    *state.sidecar_child.lock().unwrap() = Some(child);
}

/// Kill the worker process entirely and clear all handles.
/// The OS immediately reclaims the ONNX Runtime + model memory.
/// The worker is re-spawned lazily on the next hotkey press.
fn kill_sidecar(state: &SharedState) {
    // Drop stdin first — closes the pipe so the worker's read loop exits cleanly
    // even if kill() races.
    drop(state.sidecar_stdin.lock().unwrap().take());

    if let Some(mut child) = state.sidecar_child.lock().unwrap().take() {
        let _ = child.kill();
        // Don't wait() here — we're on the idle timer thread. The child becomes
        // a zombie briefly but the OS reaps it when we drop the handle.
    }

    state.sidecar_standby.store(false, Ordering::SeqCst);
    state.sidecar_busy.store(false, Ordering::SeqCst);
    println!("STT worker stopped — RAM freed");
}

// ─── M4: Auto-paste ───────────────────────────────────────────────────────────
//
// enigo simulates keyboard input at the OS level.
// We type the text directly — more reliable than clipboard on some systems.
// On macOS the app needs Accessibility permission for this to work.

fn paste_text(text: &str) {
    use enigo::{Enigo, Keyboard, Settings};

    match Enigo::new(&Settings::default()) {
        Ok(mut enigo) => {
            // Small delay to ensure the original app has focus back
            std::thread::sleep(std::time::Duration::from_millis(150));
            if let Err(e) = enigo.text(text) {
                eprintln!("Paste failed: {} — text: {}", e, text);
            }
        }
        Err(e) => {
            eprintln!("Could not create enigo instance: {}", e);
        }
    }
}

// ─── System Tray ──────────────────────────────────────────────────────────────

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let separator     = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_item     = MenuItemBuilder::with_id("quit", "Quit VoiceNote").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&settings_item)
        .item(&separator)
        .item(&quit_item)
        .build()?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("VoiceNote — Press Right Ctrl to record")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => open_settings(app),
            "quit"     => app.exit(0),
            _          => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                open_settings(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ─── Global Hotkey ────────────────────────────────────────────────────────────
//
// Right Control is the default hotkey.
// Pressed  → show Voice Bar, start mic capture
// Released → stop capture, transcribe, paste

fn register_hotkey(app: &AppHandle, state: SharedState, hotkey: &str) -> Result<(), String> {
    if uses_native_right_ctrl(hotkey) {
        return register_right_ctrl_native(app, state, hotkey);
    }

    let app_on_press   = app.clone();
    let app_on_release = app.clone();
    let state_press    = state.clone();
    let state_release  = state.clone();
    let hotkey_for_callback = hotkey.to_string();
    let hotkey_for_register = hotkey.to_string();

    app.global_shortcut()
        .on_shortcut(hotkey_for_register.as_str(), move |_app, _shortcut, event| {
            match event.state() {
                ShortcutState::Pressed => {
                    handle_shortcut_pressed(app_on_press.clone(), state_press.clone(), hotkey_for_callback.clone());
                }
                ShortcutState::Released => {
                    handle_shortcut_released(app_on_release.clone(), state_release.clone(), hotkey_for_callback.clone());
                }
            }
        })
        .map_err(|e| format!("Failed to register shortcut '{}': {}", hotkey, e))?;

    Ok(())
}

fn uses_native_right_ctrl(hotkey: &str) -> bool {
    hotkey.eq_ignore_ascii_case("ControlRight")
}

fn hotkey_is_registered(app: &AppHandle, state: &SharedState, hotkey: &str) -> bool {
    if uses_native_right_ctrl(hotkey) {
        state.right_ctrl_active.load(Ordering::SeqCst)
    } else {
        app.global_shortcut().is_registered(hotkey)
    }
}

fn unregister_hotkey(app: &AppHandle, state: SharedState, hotkey: &str) -> Result<(), String> {
    if uses_native_right_ctrl(hotkey) {
        state.right_ctrl_stop.store(true, Ordering::SeqCst);
        state.right_ctrl_active.store(false, Ordering::SeqCst);
        return Ok(());
    }
    if app.global_shortcut().is_registered(hotkey) {
        app.global_shortcut()
            .unregister(hotkey)
            .map_err(|e| format!("Failed to unregister old shortcut: {}", e))?;
    }
    Ok(())
}

fn handle_shortcut_pressed(app: AppHandle, state: SharedState, shortcut: String) {
    println!("Shortcut pressed: {}", shortcut);
    let _ = app.emit(
        "shortcut-triggered",
        serde_json::json!({ "state": "pressed", "shortcut": shortcut }),
    );
    if state.sidecar_busy.load(Ordering::SeqCst) {
        return;
    }
    show_voicebar(&app);

    if state.recording.load(Ordering::SeqCst) {
        return;
    }

    state.recording.store(true, Ordering::SeqCst);
    state.audio_buffer.lock().unwrap().clear();

    start_audio_capture(
        app.clone(),
        state.clone(),
        state.audio_buffer.clone(),
        state.device_sample_rate.clone(),
        state.device_channels.clone(),
        state.recording.clone(),
    );

    let app_pw = app.clone();
    let state_pw = state.clone();
    std::thread::spawn(move || {
        let already_running = state_pw.sidecar_stdin.lock().unwrap().is_some();
        if already_running {
            if let Some(ref mut stdin) = *state_pw.sidecar_stdin.lock().unwrap() {
                let _ = writeln!(stdin, "__CMD__:WARMUP");
            }
        } else {
            spawn_sidecar(app_pw, state_pw);
        }
    });
}

fn handle_shortcut_released(app: AppHandle, state: SharedState, shortcut: String) {
    println!("Shortcut released: {}", shortcut);
    let _ = app.emit(
        "shortcut-triggered",
        serde_json::json!({ "state": "released", "shortcut": shortcut }),
    );
    if !state.recording.load(Ordering::SeqCst) {
        return;
    }

    state.sidecar_busy.store(true, Ordering::SeqCst);
    state.sidecar_last_used_ms.store(now_millis(), Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        finalize_recording(app, state).await;
    });
}

#[cfg(target_os = "windows")]
fn register_right_ctrl_native(app: &AppHandle, state: SharedState, hotkey: &str) -> Result<(), String> {
    state.right_ctrl_stop.store(false, Ordering::SeqCst);
    state.right_ctrl_active.store(true, Ordering::SeqCst);

    let app_on_key = app.clone();
    let state_on_key = state.clone();
    let shortcut = hotkey.to_string();

    std::thread::spawn(move || {
        let mut was_pressed = false;
        loop {
            if state_on_key.right_ctrl_stop.load(Ordering::SeqCst) {
                break;
            }
            // SAFETY: GetAsyncKeyState is a pure Win32 query function and does not require
            // additional invariants for this usage.
            let pressed = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(VK_RCONTROL_CODE) } < 0;
            if pressed && !was_pressed {
                handle_shortcut_pressed(app_on_key.clone(), state_on_key.clone(), shortcut.clone());
            } else if !pressed && was_pressed {
                handle_shortcut_released(app_on_key.clone(), state_on_key.clone(), shortcut.clone());
            }
            was_pressed = pressed;
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        state_on_key.right_ctrl_active.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_right_ctrl_native(_app: &AppHandle, _state: SharedState, _hotkey: &str) -> Result<(), String> {
    Err("ControlRight-only shortcut is only supported on Windows in this build".to_string())
}

fn setup_hotkey(app: &AppHandle, state: SharedState) -> Result<(), String> {
    let hotkey = state.shortcut.lock().unwrap().clone();
    match register_hotkey(app, state.clone(), &hotkey) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("Hotkey '{}' failed to register: {}", hotkey, e);
            *state.shortcut.lock().unwrap() = DEFAULT_SHORTCUT.to_string();
            register_hotkey(app, state, DEFAULT_SHORTCUT)
                .map_err(|e2| format!("Failed to register fallback shortcut '{}': {}", DEFAULT_SHORTCUT, e2))
        }
    }
}

// ─── App Entry Point ──────────────────────────────────────────────────────────

pub fn run() {
    let state: SharedState = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            stop_recording,
            cancel_recording,
            check_for_updates,
            get_shortcut,
            get_waveform_color,
            get_asr_model,
            get_asr_backend,
            get_runtime_profile,
            get_shortcut_status,
            set_shortcut,
            set_waveform_color,
            set_asr_model,
            set_asr_backend,
            set_runtime_profile,
            set_voicebar_position,
            reset_voicebar_position,
            get_audio_input_info,
            test_microphone,
            set_audio_input_device,
            get_debug_mic_level,
            set_debug_mic_level,
            run_health_check,
            get_model_status,
            download_model,
            get_onnx_provider,
            get_provider_runtime_status,
            set_onnx_provider,
            get_hf_token,
            set_hf_token,
            get_voicebar_visible,
            get_onboarding_state,
            complete_onboarding,
            open_settings_page_command,
            open_empty_state,
            get_autostart_enabled,
            set_autostart_enabled,
        ])
        .setup(move |app| {
            // Hide from macOS Dock — we're a menu bar app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            load_app_settings(app.handle(), state.clone());

            if let Some((x, y)) = load_voicebar_position(app.handle()) {
                *state.voicebar_pos.lock().unwrap() = Some((x, y));
                if let Some(win) = app.get_webview_window("voicebar") {
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }

            // Keep the voicebar as a non-focusable overlay so shortcut usage
            // does not steal focus from the user's active text field.
            if let Some(win) = app.get_webview_window("voicebar") {
                let _ = win.set_focusable(false);
                let _ = win.show();
            }

            // Log the worker binary path so it's easy to diagnose missing-binary issues.
            let worker = worker_binary_path();
            println!(
                "Worker binary: {} (exists={})",
                worker.display(),
                worker.exists()
            );

            setup_tray(app.handle())?;
            setup_hotkey(app.handle(), state.clone())?;

            // Pre-create Settings hidden so first open is instant.
            // Deferred onto the main thread after a short delay so the Settings
            // webview initialization doesn't race with the voicebar's event-listener
            // setup — a race that caused the first shortcut press to be silently dropped.
            let app_settings = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let app_inner = app_settings.clone();
                let _ = app_settings.run_on_main_thread(move || {
                    if app_inner.get_webview_window("settings").is_none() {
                        let _ = tauri::WebviewWindowBuilder::new(
                            &app_inner,
                            "settings",
                            tauri::WebviewUrl::App("/?window=settings".into()),
                        )
                        .title("Settings")
                        .inner_size(640.0, 560.0)
                        .resizable(false)
                        .decorations(false)
                        .transparent(true)
                        .center()
                        .visible(false)
                        .build();
                    }
                });
            });

            // First-run onboarding flow.
            let model_ready = model_data_dir(app.handle())
                .map(|d| d.join("encoder.int8.onnx").exists())
                .unwrap_or(false);
            let onboarding_completed = state.onboarding_completed.load(Ordering::SeqCst);
            if !onboarding_completed {
                let app_firstrun = app.handle().clone();
                std::thread::spawn(move || {
                    // Brief delay so the tray icon and voicebar finish rendering first.
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    open_onboarding(&app_firstrun);
                });
            } else if !model_ready {
                let app_model_hint = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    open_settings_page(&app_model_hint, Some("models"));
                });
            }

            // Idle-kill manager — kills the worker process after it has been
            // unused for the profile timeout. The worker is re-spawned lazily
            // on the next hotkey press so the OS fully reclaims its RAM.
            let offload_state = state.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));

                // Don't interfere while recording or transcribing.
                if offload_state.recording.load(Ordering::SeqCst) {
                    continue;
                }
                if offload_state.sidecar_busy.load(Ordering::SeqCst) {
                    continue;
                }

                // Nothing to kill if the worker isn't running.
                let running = offload_state.sidecar_child.lock().unwrap().is_some();
                if !running {
                    continue;
                }

                let last = offload_state.sidecar_last_used_ms.load(Ordering::SeqCst);
                let idle_ms = now_millis().saturating_sub(last);
                let profile = offload_state.runtime_profile.lock().unwrap().clone();
                let timeout = idle_timeout_ms(&profile);

                if idle_ms >= timeout {
                    let was_standby = offload_state.sidecar_standby.swap(true, Ordering::SeqCst);
                    if !was_standby {
                        kill_sidecar(&offload_state);
                    }
                } else {
                    offload_state.sidecar_standby.store(false, Ordering::SeqCst);
                }
            });
            // Startup warmup: spawn worker once on app launch so model load
            // happens proactively. After this, existing idle-kill behavior
            // still unloads the worker according to the selected profile.
            let app_prewarm = app.handle().clone();
            let state_prewarm = state.clone();
            std::thread::spawn(move || {
                spawn_sidecar(app_prewarm, state_prewarm);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running VoiceNote");
}
