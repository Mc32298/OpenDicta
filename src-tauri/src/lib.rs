//! OpenDicta — Rust backend
//!
//! Responsibilities:
//!   - System tray + menu
//!   - Global hotkey (hold to record, release to transcribe)
//!   - Real microphone capture via cpal
//!   - WAV file saving via hound
//!   - OpenDicta-worker sidecar management (Parakeet TDT 0.6B v3 via sherpa-onnx)
//!   - Auto-paste via enigo (types text into the active app)

#[allow(dead_code)]
mod ai;
mod history;
mod protected_store;

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEFAULT_SHORTCUT: &str = "Ctrl+-";
const DEFAULT_PUSH_TO_TALK_SHORTCUT: &str = "F6";
const DEFAULT_STOP_DISCARD_SHORTCUT: &str = "Esc";
const DEFAULT_REFINE_AI_SHORTCUT: &str = "Ctrl+Shift+R";

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

    /// stdin of the running OpenDicta-worker process.
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
    /// Optional global shortcuts for non-primary actions.
    shortcut_push_to_talk: Arc<Mutex<Option<String>>>,
    shortcut_stop_discard: Arc<Mutex<Option<String>>>,
    shortcut_refine_ai: Arc<Mutex<Option<String>>>,
    /// Signal to stop the native RightCtrl listener thread.
    right_ctrl_stop: Arc<AtomicBool>,
    /// True while native RightCtrl listener is active.
    right_ctrl_active: Arc<AtomicBool>,
    /// True while settings UI is capturing a new shortcut; suppress runtime actions.
    shortcut_capture_mode: Arc<AtomicBool>,

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

    /// Which local ASR model is active: "parakeet" | "canary_qwen_2_5b"
    active_model_id: Arc<Mutex<String>>,
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
    completion_sound: Arc<AtomicBool>,
    /// Default processing mode for every recording (unless a profile hotkey overrides).
    /// Values: "raw" | "clean" | "translate" | "clean_translate"
    ai_default_mode: Arc<Mutex<String>>,
    ai_enabled: Arc<AtomicBool>,
    /// AI backend: "openai" | "anthropic" | "ollama"
    ai_backend: Arc<Mutex<String>>,
    /// AI model name, e.g. "gpt-4o-mini"
    ai_model: Arc<Mutex<String>>,
    /// Ollama base URL, e.g. "http://localhost:11434"
    ai_ollama_url: Arc<Mutex<String>>,
    /// Typing baseline used for productivity stats.
    typing_baseline_wpm: Arc<Mutex<u32>>,
    /// Metadata captured when audio is finalized and consumed when worker stdout returns.
    pending_transcript_meta: Arc<Mutex<Option<PendingTranscriptMeta>>>,
    /// Serializes read-modify-write transcript history appends.
    history_write_lock: Arc<Mutex<()>>,
    /// OpenAI API key loaded from keyring/encrypted storage at startup
    openai_api_key: Arc<Mutex<Option<String>>>,
    /// Gemini API key loaded from keyring/encrypted storage at startup
    gemini_api_key: Arc<Mutex<Option<String>>>,
    /// Anthropic API key loaded from keyring/encrypted storage at startup
    anthropic_api_key: Arc<Mutex<Option<String>>>,
    /// Target language for translate/clean_translate presets
    ai_target_language: Arc<Mutex<String>>,
    /// Shared HTTP client for AI provider requests (reqwest is cheap to clone)
    http_client: reqwest::Client,
}

#[derive(Clone, serde::Serialize)]
struct ProviderRuntimeStatus {
    requested: String,
    effective: String,
    message: String,
}

#[derive(Clone)]
struct PendingTranscriptMeta {
    duration_seconds: f64,
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
            shortcut_push_to_talk: Arc::new(Mutex::new(Some(
                DEFAULT_PUSH_TO_TALK_SHORTCUT.to_string(),
            ))),
            shortcut_stop_discard: Arc::new(Mutex::new(Some(
                DEFAULT_STOP_DISCARD_SHORTCUT.to_string(),
            ))),
            shortcut_refine_ai: Arc::new(Mutex::new(Some(
                DEFAULT_REFINE_AI_SHORTCUT.to_string(),
            ))),
            right_ctrl_stop: Arc::new(AtomicBool::new(false)),
            right_ctrl_active: Arc::new(AtomicBool::new(false)),
            shortcut_capture_mode: Arc::new(AtomicBool::new(false)),
            voicebar_pos: Arc::new(Mutex::new(None)),
            voicebar_visible: Arc::new(AtomicBool::new(false)),
            mic_device: Arc::new(Mutex::new(None)),
            debug_mic_level: Arc::new(AtomicBool::new(false)),
            waveform_color: Arc::new(Mutex::new("#3082ff".to_string())),
            active_model_id: Arc::new(Mutex::new("parakeet".to_string())),
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
            completion_sound: Arc::new(AtomicBool::new(false)),
            ai_default_mode: Arc::new(Mutex::new("raw".to_string())),
            ai_enabled: Arc::new(AtomicBool::new(true)),
            ai_backend: Arc::new(Mutex::new("openai".to_string())),
            ai_model: Arc::new(Mutex::new("gpt-4o-mini".to_string())),
            ai_ollama_url: Arc::new(Mutex::new("http://localhost:11434".to_string())),
            typing_baseline_wpm: Arc::new(Mutex::new(history::DEFAULT_TYPING_BASELINE_WPM)),
            pending_transcript_meta: Arc::new(Mutex::new(None)),
            history_write_lock: Arc::new(Mutex::new(())),
            openai_api_key: Arc::new(Mutex::new(None)),
            gemini_api_key: Arc::new(Mutex::new(None)),
            anthropic_api_key: Arc::new(Mutex::new(None)),
            ai_target_language: Arc::new(Mutex::new(String::new())),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn iso_timestamp_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    unix_seconds_to_iso(now)
}

fn unix_seconds_to_iso(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + (month <= 2) as i64;
    (year as i32, month as u32, day as u32)
}

fn idle_timeout_ms(profile: &str) -> u64 {
    match profile {
        "low_ram" => 5_000,
        "fast_wake" => 60_000,
        _ => 25_000, // balanced
    }
}

type SharedState = Arc<AppState>;

fn resolve_ai_prompt_and_mode(default_mode: &str) -> (Option<&'static str>, Option<String>) {
    match default_mode {
        "grammar" => (
            Some("Fix grammar and punctuation. Preserve meaning and tone. Return only the corrected text, no explanation. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "email" => (
            Some("Transform the transcript into a well-written email with a clear subject line, greeting, polished body, and sign-off. Return only the email text. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "prompt" => (
            Some("Transform the transcript into a high-quality prompt for an AI coding assistant. Structure it with context, objective, constraints, and desired output. Return only the final prompt. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "pro" => (
            Some("Rewrite in a professional business tone for internal company communication. Be concise, clear, and decision-oriented. Use this structure when applicable: Executive Summary, Key Points, Action Items, and Next Steps. Keep bullets practical, and include owners or timelines only if explicitly mentioned in the transcript. Do not invent facts. Return only the final formatted text. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "bullets" => (
            Some("Convert the transcript into concise bullet points. Fix Grammar and punctuation. Keep important details and remove filler. Return only bullet points. Use plain text bullets with '-' prefix only. Do not use Markdown emphasis like ** or headings with #."),
            Some(default_mode.to_string()),
        ),
        "chat" => (
            Some("Rewrite the transcript into a concise chat message suitable for Slack, Teams, or personal messaging. Keep it natural and clear. Return only the message text. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "summary" => (
            Some("Create a TL;DR summary in 2-4 short sentences covering the key points. Return only the summary. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "clean" => (
            Some("Fix grammar and punctuation. Preserve meaning and tone. Return only the corrected text, no explanation. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "translate" => (
            Some("Translate to English. Return only the translation, no explanation or preamble. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        "clean_translate" => (
            Some("Fix grammar and punctuation, then translate to English. Return only the final corrected and translated text. Output plain text only (no Markdown symbols like **, #, -, *, or backticks)."),
            Some(default_mode.to_string()),
        ),
        _ => (None, None),
    }
}

fn ai_warning_message(err: &str) -> Option<String> {
    let lower = err.to_ascii_lowercase();
    let is_quota_or_rate_limit = lower.contains("429")
        || lower.contains("resource_exhausted")
        || lower.contains("quota")
        || lower.contains("rate limit")
        || lower.contains("too many requests");
    if is_quota_or_rate_limit {
        Some("AI rate limit reached. Pasting raw transcript instead.".to_string())
    } else {
        None
    }
}

// ─── AI Settings Commands ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct AiSettingsInfo {
    default_mode: String,
    enabled: bool,
    backend: String,
    model: String,
    api_key_masked: String,
    ollama_url: String,
}

#[derive(serde::Serialize)]
struct AiConnectionTestResult {
    ok: bool,
    message: String,
    latency_ms: u64,
}

#[tauri::command]
async fn get_ai_settings(state: tauri::State<'_, SharedState>) -> Result<AiSettingsInfo, String> {
    let backend = state.ai_backend.lock().unwrap().clone();
    let has_key = match backend.as_str() {
        "openai" => state.openai_api_key.lock().unwrap().is_some(),
        "gemini" => state.gemini_api_key.lock().unwrap().is_some(),
        "anthropic" => state.anthropic_api_key.lock().unwrap().is_some(),
        _ => false,
    };
    Ok(AiSettingsInfo {
        default_mode: state.ai_default_mode.lock().unwrap().clone(),
        enabled: state.ai_enabled.load(Ordering::SeqCst),
        backend,
        model: state.ai_model.lock().unwrap().clone(),
        api_key_masked: if has_key {
            mask_token("set")
        } else {
            String::new()
        },
        ollama_url: state.ai_ollama_url.lock().unwrap().clone(),
    })
}

#[tauri::command]
async fn test_ai_connection(
    state: tauri::State<'_, SharedState>,
) -> Result<AiConnectionTestResult, String> {
    let backend = state.ai_backend.lock().unwrap().clone();
    let model = state.ai_model.lock().unwrap().clone();
    let ollama_url = state.ai_ollama_url.lock().unwrap().clone();
    let api_key = match backend.as_str() {
        "openai" => state.openai_api_key.lock().unwrap().clone().unwrap_or_default(),
        "gemini" => state.gemini_api_key.lock().unwrap().clone().unwrap_or_default(),
        "anthropic" => state.anthropic_api_key.lock().unwrap().clone().unwrap_or_default(),
        "ollama" => String::new(),
        _ => String::new(),
    };
    if backend != "ollama" && api_key.trim().is_empty() {
        return Ok(AiConnectionTestResult {
            ok: false,
            message: format!("No API key saved for provider '{}'.", backend),
            latency_ms: 0,
        });
    }

    let started = std::time::Instant::now();
    let result = apply_ai_with_prompt(
        &state.http_client,
        "Connection test. Respond with exactly: OK",
        "You are a connectivity check. Reply exactly with OK.",
        backend.as_str(),
        model.as_str(),
        api_key.as_str(),
        ollama_url.as_str(),
    )
    .await;
    let latency_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(_) => Ok(AiConnectionTestResult {
            ok: true,
            message: format!("Connection OK for '{}' using model '{}'.", backend, model),
            latency_ms,
        }),
        Err(e) => Ok(AiConnectionTestResult {
            ok: false,
            message: e,
            latency_ms,
        }),
    }
}

#[tauri::command]
async fn get_ai_default_mode(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.ai_default_mode.lock().unwrap().clone())
}

#[tauri::command]
async fn get_ai_enabled(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    Ok(state.ai_enabled.load(Ordering::SeqCst))
}

#[tauri::command]
async fn set_ai_enabled(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    enabled: bool,
) -> Result<(), String> {
    state.ai_enabled.store(enabled, Ordering::SeqCst);
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_default_mode(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    mode: String,
) -> Result<(), String> {
    const VALID: &[&str] = &[
        "raw",
        "grammar",
        "email",
        "prompt",
        "pro",
        "bullets",
        "chat",
        "summary",
        "clean",
        "translate",
        "clean_translate",
    ];
    if !VALID.contains(&mode.as_str()) {
        return Err(format!("Unknown mode: {}", mode));
    }
    *state.ai_default_mode.lock().unwrap() = mode;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_backend(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    backend: String,
) -> Result<(), String> {
    const VALID: &[&str] = &["openai", "anthropic", "gemini", "ollama"];
    if !VALID.contains(&backend.as_str()) {
        return Err(format!("Unknown AI backend: {}", backend));
    }
    *state.ai_backend.lock().unwrap() = backend;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_api_key(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    key: String,
) -> Result<(), String> {
    // Store only in provider-specific secure storage.
    // Windows: encrypted local file + keyring cleanup path in save_ai_secret.
    // Other OSes: native OS keyring.
    let backend = state.ai_backend.lock().unwrap().clone();
    let (provider_entry, file_key, state_slot) = match backend.as_str() {
        "openai" => (
            Some(openai_keyring_entry()),
            "openai_api_key",
            Some("openai"),
        ),
        "gemini" => (
            Some(gemini_keyring_entry()),
            "gemini_api_key",
            Some("gemini"),
        ),
        "anthropic" => (
            Some(anthropic_keyring_entry()),
            "anthropic_api_key",
            Some("anthropic"),
        ),
        _ => (None, "", None),
    };
    if let Some(pe) = provider_entry {
        let val = if key.is_empty() {
            None
        } else {
            Some(key.as_str())
        };
        let _ = save_ai_secret(&app, file_key, pe, val);
    }
    if let Some(slot) = state_slot {
        let val = if key.is_empty() { None } else { Some(key) };
        match slot {
            "openai" => *state.openai_api_key.lock().unwrap() = val,
            "gemini" => *state.gemini_api_key.lock().unwrap() = val,
            "anthropic" => *state.anthropic_api_key.lock().unwrap() = val,
            _ => {}
        }
    }
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_model(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model: String,
) -> Result<(), String> {
    let model = model.trim().to_string();
    if model.is_empty() || model.len() > 64 {
        return Err("Invalid model name".to_string());
    }
    *state.ai_model.lock().unwrap() = model;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_ollama_url(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    url: String,
) -> Result<(), String> {
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }
    *state.ai_ollama_url.lock().unwrap() = url;
    save_app_settings(&app, state.inner().clone())
}

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
fn get_transcript_history(app: AppHandle) -> Result<Vec<history::TranscriptRecord>, String> {
    let path = transcript_history_path(&app)?;
    history::load_history_file(&path, legacy_transcript_history_path(&app)?.as_deref())
}

#[tauri::command]
fn get_dashboard_stats(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<history::DashboardStats, String> {
    let path = transcript_history_path(&app)?;
    let records =
        history::load_history_file(&path, legacy_transcript_history_path(&app)?.as_deref())?;
    let typing_baseline_wpm = *state.typing_baseline_wpm.lock().unwrap();
    let settings = history::ProductivitySettings {
        typing_baseline_wpm,
    };
    let now_unix_seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(history::calculate_dashboard_stats(
        &records,
        &settings,
        now_unix_seconds,
    ))
}

#[tauri::command]
fn get_insights_stats(
    app: AppHandle,
) -> Result<history::InsightsStats, String> {
    let path = transcript_history_path(&app)?;
    let records =
        history::load_history_file(&path, legacy_transcript_history_path(&app)?.as_deref())?;
    let now_unix_seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(history::calculate_insights_stats(&records, now_unix_seconds))
}

#[tauri::command]
fn get_latest_transcript_data(
    app: AppHandle,
) -> Result<history::DashboardLatestData, String> {
    let path = transcript_history_path(&app)?;
    let records =
        history::load_history_file(&path, legacy_transcript_history_path(&app)?.as_deref())?;
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(history::build_dashboard_latest(&records, now_unix))
}

#[tauri::command]
fn get_productivity_settings(
    state: tauri::State<'_, SharedState>,
) -> Result<history::ProductivitySettings, String> {
    Ok(history::ProductivitySettings {
        typing_baseline_wpm: *state.typing_baseline_wpm.lock().unwrap(),
    })
}

#[tauri::command]
fn set_typing_baseline_wpm(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    value: u32,
) -> Result<(), String> {
    let value = history::validate_typing_baseline_wpm(value)?;
    *state.typing_baseline_wpm.lock().unwrap() = value;
    save_app_settings(&app, state.inner().clone())
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
    *state.pending_transcript_meta.lock().unwrap() = None;
    hide_voicebar(&app);
    Ok(())
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    #[derive(serde::Deserialize)]
    struct GithubRelease {
        tag_name: String,
        html_url: String,
    }
    #[derive(serde::Deserialize)]
    struct GithubTag {
        name: String,
    }

    fn normalize_version(value: &str) -> &str {
        value.trim().trim_start_matches('v')
    }

    fn is_newer_version(current: &str, latest: &str) -> bool {
        match (
            semver::Version::parse(normalize_version(current)),
            semver::Version::parse(normalize_version(latest)),
        ) {
            (Ok(current), Ok(latest)) => latest > current,
            _ => normalize_version(current) != normalize_version(latest),
        }
    }

    let current_version = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .user_agent("OpenDicta/0.1 (update-check)")
        .build()
        .map_err(|e| format!("Failed to build update checker: {}", e))?;

    let release_response = client
        .get("https://api.github.com/repos/Mc32298/OpenDicta/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to contact GitHub: {}", e))?;

    if release_response.status().is_success() {
        let release = release_response
            .json::<GithubRelease>()
            .await
            .map_err(|e| format!("Failed to parse update response: {}", e))?;

        let latest_version = normalize_version(&release.tag_name).to_string();
        let update_available = is_newer_version(&current_version, &latest_version);
        let message = if update_available {
            format!("Update available: {} (current {}).", latest_version, current_version)
        } else {
            format!("You're on the latest version: {}.", current_version)
        };

        return Ok(UpdateCheckResult {
            current_version,
            latest_version,
            update_available,
            release_url: release.html_url,
            message,
        });
    }

    if release_response.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(format!(
            "GitHub update check failed: HTTP status client error ({}) for url ({})",
            release_response.status(),
            "https://api.github.com/repos/Mc32298/OpenDicta/releases/latest"
        ));
    }

    let tags = client
        .get("https://api.github.com/repos/Mc32298/OpenDicta/tags")
        .send()
        .await
        .map_err(|e| format!("Failed to contact GitHub tags endpoint: {}", e))?
        .error_for_status()
        .map_err(|e| format!("GitHub tag lookup failed: {}", e))?
        .json::<Vec<GithubTag>>()
        .await
        .map_err(|e| format!("Failed to parse tag response: {}", e))?;

    let Some(tag) = tags.first() else {
        return Ok(UpdateCheckResult {
            current_version: current_version.clone(),
            latest_version: current_version.clone(),
            update_available: false,
            release_url: "https://github.com/Mc32298/OpenDicta/releases".to_string(),
            message: format!("No published releases or tags found. Current version is {}.", current_version),
        });
    };

    let latest_version = normalize_version(&tag.name).to_string();
    let update_available = is_newer_version(&current_version, &latest_version);
    let message = if update_available {
        format!("Update available: {} (current {}).", latest_version, current_version)
    } else {
        format!("You're on the latest version: {}.", current_version)
    };

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        update_available,
        release_url: "https://github.com/Mc32298/OpenDicta/tags".to_string(),
        message,
    })
}

#[derive(serde::Serialize)]
struct UpdateCheckResult {
    current_version: String,
    latest_version: String,
    update_available: bool,
    release_url: String,
    message: String,
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
async fn get_default_shortcut() -> &'static str {
    DEFAULT_SHORTCUT
}

#[tauri::command]
async fn get_waveform_color(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.waveform_color.lock().unwrap().clone())
}

fn is_valid_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    matches!(b.first(), Some(&b'#'))
        && matches!(b.len(), 4 | 7)
        && b[1..].iter().all(|c| c.is_ascii_hexdigit())
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
    if !is_valid_hex_color(&color) {
        return Err("Color must be a valid hex value (#RGB or #RRGGBB)".to_string());
    }
    *state.waveform_color.lock().unwrap() = color.clone();
    save_app_settings(&app, state.inner().clone())?;
    let _ = app.emit(
        "waveform-color-changed",
        serde_json::json!({ "color": color }),
    );
    Ok(())
}

#[derive(serde::Serialize)]
struct ShortcutStatus {
    shortcut: String,
    registered: bool,
    recording: bool,
}

#[derive(serde::Serialize)]
struct ShortcutBindings {
    record: String,
    push_to_talk: Option<String>,
    stop_and_discard: Option<String>,
    refine_with_ai: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AppSettings {
    shortcut: String,
    #[serde(default = "default_push_to_talk_shortcut")]
    shortcut_push_to_talk: String,
    #[serde(default = "default_stop_discard_shortcut")]
    shortcut_stop_discard: String,
    #[serde(default = "default_refine_ai_shortcut")]
    shortcut_refine_ai: String,
    mic_device: Option<String>,
    debug_mic_level: bool,
    #[serde(default = "default_waveform_color")]
    waveform_color: String,
    #[serde(default = "default_active_model_id")]
    active_model_id: String,
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
    #[serde(default)]
    completion_sound: bool,
    #[serde(default = "default_ai_default_mode")]
    ai_default_mode: String,
    #[serde(default = "default_ai_enabled")]
    ai_enabled: bool,
    #[serde(default = "default_ai_backend")]
    ai_backend: String,
    #[serde(default = "default_ai_model")]
    ai_model: String,
    #[serde(default = "default_ai_ollama_url")]
    ai_ollama_url: String,
    #[serde(default)]
    ai_target_language: String,
    #[serde(default = "default_typing_baseline_wpm")]
    typing_baseline_wpm: u32,
}

fn default_waveform_color() -> String {
    "#3082ff".to_string()
}
fn default_push_to_talk_shortcut() -> String {
    DEFAULT_PUSH_TO_TALK_SHORTCUT.to_string()
}
fn default_stop_discard_shortcut() -> String {
    DEFAULT_STOP_DISCARD_SHORTCUT.to_string()
}
fn default_refine_ai_shortcut() -> String {
    DEFAULT_REFINE_AI_SHORTCUT.to_string()
}

fn default_active_model_id() -> String {
    "parakeet".to_string()
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

fn default_ai_default_mode() -> String {
    "raw".to_string()
}
fn default_ai_enabled() -> bool {
    true
}

fn default_ai_backend() -> String {
    "openai".to_string()
}

fn default_ai_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_ai_ollama_url() -> String {
    "http://localhost:11434".to_string()
}

fn default_typing_baseline_wpm() -> u32 {
    history::DEFAULT_TYPING_BASELINE_WPM
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
async fn get_active_model_id(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    Ok(state.active_model_id.lock().unwrap().clone())
}

#[tauri::command]
async fn set_active_model_id(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model_id: String,
) -> Result<(), String> {
    let valid = [
        "parakeet",
        "canary_qwen_2_5b",
        "whisper_small",
        "whisper_medium",
        "whisper_large",
        "whisper_large_v3_turbo",
        "qwen3_asr",
    ];
    if !valid.contains(&model_id.as_str()) {
        return Err(format!("Unknown model id: {}", model_id));
    }
    *state.active_model_id.lock().unwrap() = model_id;
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
    Ok(state
        .hf_token
        .lock()
        .unwrap()
        .as_ref()
        .map(|t| mask_token(t)))
}

#[tauri::command]
async fn set_hf_token(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    token: Option<String>,
) -> Result<(), String> {
    let token = token.and_then(|t| {
        let t = t.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
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

#[tauri::command]
async fn get_shortcut_bindings(state: tauri::State<'_, SharedState>) -> Result<ShortcutBindings, String> {
    Ok(ShortcutBindings {
        record: state.shortcut.lock().unwrap().clone(),
        push_to_talk: state.shortcut_push_to_talk.lock().unwrap().clone(),
        stop_and_discard: state.shortcut_stop_discard.lock().unwrap().clone(),
        refine_with_ai: state.shortcut_refine_ai.lock().unwrap().clone(),
    })
}

#[tauri::command]
async fn set_shortcut_capture_mode(
    state: tauri::State<'_, SharedState>,
    enabled: bool,
) -> Result<(), String> {
    state.shortcut_capture_mode.store(enabled, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn set_shortcut_binding(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    action: String,
    shortcut: Option<String>,
) -> Result<(), String> {
    let action = action.trim().to_lowercase();
    let next = shortcut
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref s) = next {
        if s.len() > 64 {
            return Err("Shortcut too long".to_string());
        }
        let main_shortcut = state.shortcut.lock().unwrap().clone();
        if s == &main_shortcut {
            return Err("That shortcut is already used by Record toggle".to_string());
        }
        let other_shortcuts = [
            state.shortcut_push_to_talk.lock().unwrap().clone(),
            state.shortcut_stop_discard.lock().unwrap().clone(),
            state.shortcut_refine_ai.lock().unwrap().clone(),
        ];
        let collides_other_action = match action.as_str() {
            "push_to_talk" => other_shortcuts
                .iter()
                .skip(1)
                .flatten()
                .any(|hk| hk == s),
            "stop_and_discard" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 1)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            "refine_with_ai" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 2)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            _ => return Err(format!("Unknown shortcut action: {}", action)),
        };
        if collides_other_action {
            return Err("That shortcut is already assigned to another action".to_string());
        }
    }

    let target = match action.as_str() {
        "push_to_talk" => state.shortcut_push_to_talk.clone(),
        "stop_and_discard" => state.shortcut_stop_discard.clone(),
        "refine_with_ai" => state.shortcut_refine_ai.clone(),
        _ => return Err(format!("Unknown shortcut action: {}", action)),
    };

    let old = target.lock().unwrap().clone();
    if old == next {
        return Ok(());
    }

    if let Some(ref old_hk) = old {
        let _ = unregister_hotkey(&app, state.inner().clone(), old_hk);
    }
    if let Some(ref new_hk) = next {
        if let Err(e) = register_hotkey(&app, state.inner().clone(), new_hk) {
            if let Some(ref old_hk) = old {
                let _ = register_hotkey(&app, state.inner().clone(), old_hk);
            }
            return Err(e);
        }
    }

    *target.lock().unwrap() = next;
    save_app_settings(&app, state.inner().clone())
}

// ─── Model Management Commands ────────────────────────────────────────────────

struct ModelFileSpec {
    name: &'static str,
    expected_bytes: u64,
    sha256: Option<&'static str>,
}

/// Parakeet-TDT 0.6B v3 INT8 — multilingual (25 European languages)
const PARAKEET_FILES: &[ModelFileSpec] = &[
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
        sha256: Some("d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    },
];

const PARAKEET_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main"];

/// Canary-Qwen-2.5B INT8 — English only, encoder-decoder architecture
const CANARY_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "encoder.int8.onnx",
        expected_bytes: 132_678_643,
        sha256: Some("7a75b4e2a5857a6dcc0819503bbe3fad66943db4a3ccf21d3f27c633667d303f"),
    },
    ModelFileSpec {
        name: "decoder.int8.onnx",
        expected_bytes: 74_437_848,
        sha256: Some("e41a2ab9c0c2fe81a1e8ade5a45fb02a74bc4db7d1f91b89a54a25e2cf79cba2"),
    },
    ModelFileSpec {
        name: "tokens.txt",
        expected_bytes: 53_555,
        sha256: Some("2dae6fc7815f9640645e0c765522b278ee0cef49b482d91f6913e334628d3e77"),
    },
];

const CANARY_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-nemo-canary-qwen2.5-0.5b-int8/resolve/main"];

/// Whisper Small INT8 — compact, fast English model (~374 MB total)
const WHISPER_SMALL_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "small-encoder.int8.onnx",
        expected_bytes: 110_000_000,
        sha256: Some("4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9"),
    },
    ModelFileSpec {
        name: "small-decoder.int8.onnx",
        expected_bytes: 260_000_000,
        sha256: Some("acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee"),
    },
    ModelFileSpec {
        name: "small-tokens.txt",
        expected_bytes: 800_000,
        sha256: None,
    },
];
const WHISPER_SMALL_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main"];

/// Whisper Medium INT8 — balanced speed/accuracy (~945 MB total)
const WHISPER_MEDIUM_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "medium-encoder.int8.onnx",
        expected_bytes: 370_000_000,
        sha256: Some("1c54582b4d829de0089f6cb63bbbdb3bf7555398bacaf855fbecf1a84dfd193e"),
    },
    ModelFileSpec {
        name: "medium-decoder.int8.onnx",
        expected_bytes: 565_000_000,
        sha256: Some("595d00a338a365a7bfa0ca7f296cabc639583bef770ab6130df90f49a6412747"),
    },
    ModelFileSpec {
        name: "medium-tokens.txt",
        expected_bytes: 800_000,
        sha256: None,
    },
];
const WHISPER_MEDIUM_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-whisper-medium/resolve/main"];

/// Whisper Large v2 INT8 — high-accuracy (~1.8 GB total)
const WHISPER_LARGE_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "large-v2-encoder.int8.onnx",
        expected_bytes: 760_000_000,
        sha256: Some("f055f8397a69895818c1763fd001e47fb9ca51ea7efaccfafc1b635d121203a3"),
    },
    ModelFileSpec {
        name: "large-v2-decoder.int8.onnx",
        expected_bytes: 1_000_000_000,
        sha256: Some("ea513c5bfcbdc422b025da8fc93065ab8706994ba90053af442145b9aa7c2ee8"),
    },
    ModelFileSpec {
        name: "large-v2-tokens.txt",
        expected_bytes: 800_000,
        sha256: None,
    },
];
const WHISPER_LARGE_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-whisper-large-v2/resolve/main"];

/// Whisper Large v3 Turbo INT8 — maximum accuracy, faster than large (~1.0 GB total)
const WHISPER_TURBO_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "turbo-encoder.int8.onnx",
        expected_bytes: 670_000_000,
        sha256: Some("b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b"),
    },
    ModelFileSpec {
        name: "turbo-decoder.int8.onnx",
        expected_bytes: 355_000_000,
        sha256: Some("20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547"),
    },
    ModelFileSpec {
        name: "turbo-tokens.txt",
        expected_bytes: 800_000,
        sha256: None,
    },
];
const WHISPER_TURBO_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/main"];

/// Qwen3-ASR 0.6B INT8 — encoder-decoder with conv frontend (~982 MB total)
const QWEN3_ASR_FILES: &[ModelFileSpec] = &[
    ModelFileSpec {
        name: "conv_frontend.onnx",
        expected_bytes: 43_000_000,
        sha256: Some("d22dc4423e0940e49884e903d2ea2f7e5567c14fc1aed97e4e26d6b8f208ef9e"),
    },
    ModelFileSpec {
        name: "encoder.int8.onnx",
        expected_bytes: 180_000_000,
        sha256: Some("60748d3e6744a57c9c91e1b17424a6c2990567e8adceb0783940c03ed98fa9d9"),
    },
    ModelFileSpec {
        name: "decoder.int8.onnx",
        expected_bytes: 750_000_000,
        sha256: Some("4f6885be5959ae26af3089d38ee7972c5fafbeeb1cf8d5e76eab6d8b61ca5771"),
    },
    ModelFileSpec {
        name: "tokenizer/merges.txt",
        expected_bytes: 1_600_000,
        sha256: None,
    },
    ModelFileSpec {
        name: "tokenizer/tokenizer_config.json",
        expected_bytes: 10_000,
        sha256: None,
    },
    ModelFileSpec {
        name: "tokenizer/vocab.json",
        expected_bytes: 2_700_000,
        sha256: None,
    },
];
const QWEN3_ASR_DOWNLOAD_BASES: &[&str] =
    &["https://huggingface.co/csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/resolve/main"];

fn model_specs_for(model_id: &str) -> &'static [ModelFileSpec] {
    match model_id {
        "canary_qwen_2_5b" => CANARY_FILES,
        "whisper_small" => WHISPER_SMALL_FILES,
        "whisper_medium" => WHISPER_MEDIUM_FILES,
        "whisper_large" => WHISPER_LARGE_FILES,
        "whisper_large_v3_turbo" => WHISPER_TURBO_FILES,
        "qwen3_asr" => QWEN3_ASR_FILES,
        _ => PARAKEET_FILES,
    }
}

fn download_bases_for(model_id: &str) -> &'static [&'static str] {
    match model_id {
        "canary_qwen_2_5b" => CANARY_DOWNLOAD_BASES,
        "whisper_small" => WHISPER_SMALL_DOWNLOAD_BASES,
        "whisper_medium" => WHISPER_MEDIUM_DOWNLOAD_BASES,
        "whisper_large" => WHISPER_LARGE_DOWNLOAD_BASES,
        "whisper_large_v3_turbo" => WHISPER_TURBO_DOWNLOAD_BASES,
        "qwen3_asr" => QWEN3_ASR_DOWNLOAD_BASES,
        _ => PARAKEET_DOWNLOAD_BASES,
    }
}

fn model_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    model_dir_for(app, "parakeet")
}

/// A model id must be a plain identifier so a crafted value can't traverse out
/// of the models directory (e.g. "../../other") and reach an arbitrary path in
/// create_dir_all / remove_dir_all.
fn is_valid_model_id(model_id: &str) -> bool {
    !model_id.is_empty()
        && model_id.len() <= 64
        && model_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn model_dir_for(app: &AppHandle, model_id: &str) -> Result<std::path::PathBuf, String> {
    if !is_valid_model_id(model_id) {
        return Err("Invalid model id".to_string());
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join("models").join(model_id))
        .map_err(|e| e.to_string())
}

async fn model_file_matches_spec(path: &Path, spec: &ModelFileSpec) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() < spec.expected_bytes {
        return false;
    }
    match spec.sha256 {
        Some(expected_sha256) => match compute_sha256_hex(path).await {
            Ok(actual_sha256) => actual_sha256.eq_ignore_ascii_case(expected_sha256),
            Err(_) => false,
        },
        None => true,
    }
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
async fn get_model_status(
    app: AppHandle,
    model_id: String,
) -> Result<ModelStatus, String> {
    let dir = model_dir_for(&app, &model_id)?;
    let mut files = Vec::new();
    let mut all_present = true;

    for spec in model_specs_for(&model_id) {
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
    model_id: String,
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
    model_id: String,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let dir = model_dir_for(&app, &model_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create model directory: {}", e))?;

    let hf_token = state.hf_token.lock().unwrap().clone();

    let client = reqwest::Client::builder()
        .user_agent("OpenDicta/0.1 (model-downloader)")
        .build()
        .map_err(|e| e.to_string())?;

    let specs = model_specs_for(&model_id);
    let bases = download_bases_for(&model_id);
    let total_files = specs.len();

    use futures_util::StreamExt;

    for (idx, spec) in specs.iter().enumerate() {
        let name = spec.name;
        let expected_size = spec.expected_bytes;
        let dest = dir.join(name);
        // Temp file alongside the final dest; renamed atomically on success.
        // Any leftover .tmp from a previous interrupted download is silently replaced.
        let tmp = dir.join(format!("{}.tmp", name));

        // Skip if already fully downloaded and hash-verified.
        if model_file_matches_spec(&dest, spec).await {
            if let Ok(meta) = std::fs::metadata(&dest) {
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgress {
                        model_id: model_id.clone(),
                        file: name.to_string(),
                        file_index: idx,
                        file_total: total_files,
                        file_bytes: meta.len(),
                        file_size: expected_size,
                        overall_percent: (((idx + 1) * 100) / total_files) as u8,
                    },
                );
            }
            continue;
        }

        // Try each base URL in order; stop at the first that succeeds.
        let mut response = None;
        let mut last_err = String::new();
        for &base in bases {
            let url = format!("{}/{}", base, name);
            let mut req = client.get(&url);
            if let Some(ref token) = hf_token {
                req = req.header("Authorization", format!("Bearer {}", token));
            }
            match req.send().await {
                Err(e) => {
                    last_err = format!("Network error: {}", e);
                }
                Ok(r) if r.status().is_success() => {
                    response = Some(r);
                    break;
                }
                Ok(r) => {
                    last_err = format!("Server returned {} for {} ({})", r.status(), name, base);
                }
            }
        }
        let response = response.ok_or_else(|| last_err)?;

        let content_length = response.content_length().unwrap_or(expected_size);

        // Ensure any subdirectory (e.g. tokenizer/) exists before writing.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create directory for {}: {}", name, e))?;
        }

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

            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    model_id: model_id.clone(),
                    file: name.to_string(),
                    file_index: idx,
                    file_total: total_files,
                    file_bytes: downloaded,
                    file_size: content_length,
                    overall_percent: overall,
                },
            );
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

#[tauri::command]
async fn delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let dir = model_dir_for(&app, &model_id)?;
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| format!("Could not delete model files: {}", e))
}

#[derive(serde::Serialize)]
struct HealthStatus {
    worker_path: String,
    worker_exists: bool,
    model_dir: String,
    model_exists: bool,
}

#[tauri::command]
async fn run_health_check(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<HealthStatus, String> {
    let worker = worker_binary_path();
    let worker_exists = worker.exists();
    let model_id = state.active_model_id.lock().unwrap().clone();
    let model_dir = model_dir_for(&app, &model_id).unwrap_or_default();
    let model_exists = model_specs_for(&model_id)
        .iter()
        .all(|spec| model_dir.join(spec.name).exists());
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
    if shortcut.len() > 64 {
        return Err("Shortcut string is too long".to_string());
    }
    if state.shortcut_push_to_talk.lock().unwrap().as_deref() == Some(shortcut.as_str())
        || state.shortcut_stop_discard.lock().unwrap().as_deref() == Some(shortcut.as_str())
        || state.shortcut_refine_ai.lock().unwrap().as_deref() == Some(shortcut.as_str())
    {
        return Err("That shortcut is already assigned to another action".to_string());
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
async fn get_audio_input_info(
    state: tauri::State<'_, SharedState>,
) -> Result<AudioInputInfo, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();

    let default_device = host.default_input_device().and_then(|d| d.name().ok());

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
async fn test_microphone(
    state: tauri::State<'_, SharedState>,
) -> Result<MicrophoneTestResult, String> {
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
        None => {
            return Ok(MicrophoneTestResult {
                ok: false,
                message: "No input device found.".to_string(),
            })
        }
    };

    let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            return Ok(MicrophoneTestResult {
                ok: false,
                message: format!("Cannot read config for '{}': {}", device_name, e),
            })
        }
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
    let _ = app.emit(
        "completion-sound-changed",
        serde_json::json!({ "enabled": enabled }),
    );
    save_app_settings(&app, state.inner().clone())
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
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
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
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

fn transcript_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    #[cfg(windows)]
    {
        Ok(dir.join("transcript-history.bin"))
    }
    #[cfg(not(windows))]
    {
        Ok(dir.join("transcript-history.json"))
    }
}

fn legacy_transcript_history_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    #[cfg(windows)]
    {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        Ok(Some(dir.join("transcript-history.json")))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(None)
    }
}

fn save_app_settings(app: &AppHandle, state: SharedState) -> Result<(), String> {
    let file = app_settings_path(app)?;
    let settings = AppSettings {
        shortcut: state.shortcut.lock().unwrap().clone(),
        shortcut_push_to_talk: state
            .shortcut_push_to_talk
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default(),
        shortcut_stop_discard: state
            .shortcut_stop_discard
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default(),
        shortcut_refine_ai: state
            .shortcut_refine_ai
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default(),
        mic_device: state.mic_device.lock().unwrap().clone(),
        debug_mic_level: state.debug_mic_level.load(Ordering::SeqCst),
        waveform_color: state.waveform_color.lock().unwrap().clone(),
        active_model_id: state.active_model_id.lock().unwrap().clone(),
        asr_model: state.asr_model.lock().unwrap().clone(),
        asr_backend: state.asr_backend.lock().unwrap().clone(),
        runtime_profile: state.runtime_profile.lock().unwrap().clone(),
        onnx_provider: state.onnx_provider.lock().unwrap().clone(),
        hf_token: None,
        onboarding_completed: state.onboarding_completed.load(Ordering::SeqCst),
        completion_sound: state.completion_sound.load(Ordering::SeqCst),
        ai_default_mode: state.ai_default_mode.lock().unwrap().clone(),
        ai_enabled: state.ai_enabled.load(Ordering::SeqCst),
        ai_backend: state.ai_backend.lock().unwrap().clone(),
        ai_model: state.ai_model.lock().unwrap().clone(),
        ai_ollama_url: state.ai_ollama_url.lock().unwrap().clone(),
        ai_target_language: state.ai_target_language.lock().unwrap().clone(),
        typing_baseline_wpm: *state.typing_baseline_wpm.lock().unwrap(),
    };
    let payload = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize app settings: {}", e))?;
    std::fs::write(file, payload).map_err(|e| format!("Failed to save app settings: {}", e))
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
    *state.shortcut_push_to_talk.lock().unwrap() = if settings.shortcut_push_to_talk.trim().is_empty() {
        None
    } else {
        Some(settings.shortcut_push_to_talk)
    };
    *state.shortcut_stop_discard.lock().unwrap() = if settings.shortcut_stop_discard.trim().is_empty() {
        None
    } else {
        Some(settings.shortcut_stop_discard)
    };
    *state.shortcut_refine_ai.lock().unwrap() = if settings.shortcut_refine_ai.trim().is_empty() {
        None
    } else {
        Some(settings.shortcut_refine_ai)
    };
    *state.mic_device.lock().unwrap() = settings.mic_device;
    state
        .debug_mic_level
        .store(settings.debug_mic_level, Ordering::SeqCst);
    *state.waveform_color.lock().unwrap() = settings.waveform_color;
    *state.active_model_id.lock().unwrap() = settings.active_model_id;
    *state.asr_model.lock().unwrap() = settings.asr_model;
    *state.asr_backend.lock().unwrap() = settings.asr_backend;
    *state.runtime_profile.lock().unwrap() = settings.runtime_profile;
    *state.onnx_provider.lock().unwrap() = settings.onnx_provider;
    *state.ai_target_language.lock().unwrap() = settings.ai_target_language;
    let keyring_token = load_hf_token_secret();
    *state.hf_token.lock().unwrap() = keyring_token.clone().or(settings.hf_token.clone());
    let openai_entry = openai_keyring_entry();
    if let Err(ref e) = openai_entry {
        eprintln!("[keyring] Failed to init OpenAI entry: {}", e);
    }
    *state.openai_api_key.lock().unwrap() = load_ai_secret(app, "openai_api_key", openai_entry);

    let gemini_entry = gemini_keyring_entry();
    if let Err(ref e) = gemini_entry {
        eprintln!("[keyring] Failed to init Gemini entry: {}", e);
    }
    *state.gemini_api_key.lock().unwrap() = load_ai_secret(app, "gemini_api_key", gemini_entry);

    let anthropic_entry = anthropic_keyring_entry();
    if let Err(ref e) = anthropic_entry {
        eprintln!("[keyring] Failed to init Anthropic entry: {}", e);
    }
    *state.anthropic_api_key.lock().unwrap() =
        load_ai_secret(app, "anthropic_api_key", anthropic_entry);
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
    state
        .completion_sound
        .store(settings.completion_sound, Ordering::SeqCst);
    *state.ai_default_mode.lock().unwrap() = settings.ai_default_mode;
    state.ai_enabled.store(settings.ai_enabled, Ordering::SeqCst);
    *state.ai_backend.lock().unwrap() = settings.ai_backend;
    *state.ai_model.lock().unwrap() = settings.ai_model;
    *state.ai_ollama_url.lock().unwrap() = settings.ai_ollama_url;
    *state.typing_baseline_wpm.lock().unwrap() =
        history::validate_typing_baseline_wpm(settings.typing_baseline_wpm)
            .unwrap_or(history::DEFAULT_TYPING_BASELINE_WPM);
    {
        let provider = state.onnx_provider.lock().unwrap().clone();
        let mut rt = state.provider_runtime.lock().unwrap();
        rt.requested = provider.clone();
        rt.effective = "unknown".to_string();
        rt.message = format!(
            "Configured provider is '{}'. Start recording to verify runtime backend.",
            provider
        );
    }
}

fn hf_token_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.OpenDicta.app", "huggingface_token")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn openai_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.OpenDicta.app", "openai_api_key")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn gemini_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.OpenDicta.app", "gemini_api_key")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn anthropic_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.OpenDicta.app", "anthropic_api_key")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn ai_secret_file_path(app: &AppHandle, key: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config dir: {}", e))?
        .join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create secrets dir: {}", e))?;
    Ok(dir.join(format!("{key}.bin")))
}

fn load_secret(entry: Result<keyring::Entry, String>) -> Option<String> {
    let entry = entry.ok()?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        Err(_) => None,
    }
}

fn save_secret(entry: Result<keyring::Entry, String>, value: Option<&str>) -> Result<(), String> {
    let entry = entry?;
    match value {
        Some(secret) => entry
            .set_password(secret)
            .map_err(|e| format!("Failed to save token in keyring: {}", e)),
        None => match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete token from keyring: {}", e)),
        },
    }
}

fn save_ai_secret(
    app: &AppHandle,
    key: &str,
    entry: Result<keyring::Entry, String>,
    value: Option<&str>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let path = ai_secret_file_path(app, key)?;
        protected_store::save_encrypted_string(&path, value)?;
        let _ = save_secret(entry, None);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = key;
        save_secret(entry, value)
    }
}

fn load_ai_secret(
    app: &AppHandle,
    key: &str,
    entry: Result<keyring::Entry, String>,
) -> Option<String> {
    #[cfg(windows)]
    {
        let path = ai_secret_file_path(app, key).ok()?;
        if let Some(secret) = protected_store::load_encrypted_string(&path) {
            return Some(secret);
        }
        let legacy = load_secret(entry);
        if let Some(ref value) = legacy {
            let _ = protected_store::save_encrypted_string(&path, Some(value));
            let _ = save_secret(
                match key {
                    "openai_api_key" => openai_keyring_entry(),
                    "gemini_api_key" => gemini_keyring_entry(),
                    _ => return legacy,
                },
                None,
            );
        }
        legacy
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = key;
        load_secret(entry)
    }
}

fn load_hf_token_secret() -> Option<String> {
    load_secret(hf_token_keyring_entry())
}

fn save_hf_token_secret(token: Option<&str>) -> Result<(), String> {
    save_secret(hf_token_keyring_entry(), token)
}

fn mask_token(token: &str) -> String {
    if token.is_empty() {
        return String::new();
    }
    "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}".to_string()
}

async fn compute_sha256_hex(path: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path).await.map_err(|e| {
        format!(
            "Could not open file for hashing ({}): {}",
            path.display(),
            e
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];

    loop {
        let bytes = file.read(&mut buffer).await.map_err(|e| {
            format!(
                "Could not read file for hashing ({}): {}",
                path.display(),
                e
            )
        })?;
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
        // SAFETY: eval() string is hardcoded; no user input is interpolated here.
        // Do not extend this pattern with dynamic values — use win.emit() instead.
        let _ = win.eval("document.documentElement.setAttribute('data-vb','1');");
        let _ = win.emit("voicebar-show", ());
    }
}

fn hide_voicebar(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("voicebar") {
        if let Some(state) = app.try_state::<SharedState>() {
            state.voicebar_visible.store(false, Ordering::SeqCst);
        }
        // SAFETY: eval() string is hardcoded; no user input is interpolated here.
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
        .title("OpenDicta Setup")
        .inner_size(760.0, 520.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build();
    }
}

fn settings_window_dimensions() -> (f64, f64, f64, f64) {
    // The settings UI uses a four-column theme grid and a two-column content row.
    // These dimensions keep that layout visible without forcing initial scroll.
    (1120.0, 860.0, 1040.0, 820.0)
}

fn open_settings_page(app: &AppHandle, page: Option<&str>) {
    let url = match page {
        Some(p) => format!("/?window=settings&page={}", p),
        None => "/?window=settings".to_string(),
    };
    let (width, height, min_width, min_height) = settings_window_dimensions();
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_skip_taskbar(false);
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(p) = page {
            let _ = win.emit("navigate-to-page", p);
        }
    } else {
        let _ =
            tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App(url.into()))
                .title("OpenDicta")
                .inner_size(width, height)
                .min_inner_size(min_width, min_height)
                .resizable(true)
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
        let _ = tauri::WebviewWindowBuilder::new(app, "empty", tauri::WebviewUrl::App(url.into()))
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
    const VALID_PAGES: &[&str] = &[
        // New 6-page nav (preferred)
        "dashboard",
        "insights",
        "models",
        "style",
        "ai",
        "settings",
        // Legacy aliases — still accepted; the renderer remaps them.
        "general",
        "shortcut",
        "shortcuts",
        "microphone",
        "mic",
        "model",
        "appearance",
        "productivity",
        "diagnostics",
        "about",
        "history",
    ];
    if let Some(ref p) = page {
        if !VALID_PAGES.contains(&p.as_str()) {
            return Err(format!("Unknown settings page: {}", p));
        }
    }
    open_settings_page(&app, page.as_deref());
    Ok(())
}

#[tauri::command]
async fn open_empty_state(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    const VALID_TABS: &[&str] = &["history", "models", "prompts"];
    if let Some(ref t) = tab {
        if !VALID_TABS.contains(&t.as_str()) {
            return Err(format!("Unknown empty-state tab: {}", t));
        }
    }
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
            host.input_devices()
                .ok()?
                .find(|d| d.name().ok().as_ref() == Some(name))
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
        let mut last_level_ms = 0u64;

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
                let mono_iter = data
                    .chunks(channels_for_callback)
                    .map(|frame| frame.iter().sum::<f32>() / channels_for_callback as f32);

                buffer_for_callback.lock().unwrap().extend(mono_iter);

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
                    let now = now_millis();
                    if now.saturating_sub(last_level_ms) >= 33 {
                        last_level_ms = now;
                        let _ = app_for_callback.emit("recording-level", level);
                    }
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

/// Boost quiet recordings toward a healthy speech level so whispers and
/// far-from-mic speech transcribe reliably. RMS-targeted with a capped gain
/// (so silence isn't blown up into noise) and a hard limiter (so the boost
/// can't introduce clipping). Pure and in-place. No-op on empty/silent input.
fn normalize_audio(samples: &mut [f32]) {
    const TARGET_RMS: f32 = 0.1;
    const MAX_GAIN: f32 = 20.0;
    const LIMIT: f32 = 0.97;

    if samples.is_empty() {
        return;
    }

    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum_sq / samples.len() as f32).sqrt();
    if !rms.is_finite() || rms <= 0.0 {
        return;
    }

    let gain = (TARGET_RMS / rms).min(MAX_GAIN);
    if gain <= 1.0 {
        for s in samples.iter_mut() {
            *s = s.clamp(-LIMIT, LIMIT);
        }
        return;
    }

    for s in samples.iter_mut() {
        *s = (*s * gain).clamp(-LIMIT, LIMIT);
    }
}

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
        *state.pending_transcript_meta.lock().unwrap() = None;
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
    if too_short || too_quiet {
        *state.pending_transcript_meta.lock().unwrap() = None;
        let reason = if too_short {
            "No speech detected (too short)."
        } else {
            "No speech detected."
        };
        app.emit(
            "transcription-error",
            serde_json::json!({"message": reason}),
        )
        .ok();
        state.sidecar_busy.store(false, Ordering::SeqCst);
        hide_voicebar(&app);
        return;
    }

    *state.pending_transcript_meta.lock().unwrap() = Some(PendingTranscriptMeta {
        duration_seconds: duration_sec as f64,
    });

    // Tell the frontend to show "Transcribing…" only after speech presence checks pass.
    app.emit("recording-stopped", ()).ok();

    // 5. Save to a temp WAV file
    let wav_path = std::env::temp_dir().join(format!("OpenDicta_{}.wav", now_millis()));
    if let Err(e) = save_wav(&samples_16khz, &wav_path) {
        *state.pending_transcript_meta.lock().unwrap() = None;
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
                *state.pending_transcript_meta.lock().unwrap() = None;
                app.emit(
                    "transcription-error",
                    serde_json::json!({"message": format!("STT engine not responding: {}", e)}),
                )
                .ok();
                hide_voicebar(&app);
                state.sidecar_busy.store(false, Ordering::SeqCst);
                return;
            }
            state.sidecar_busy.store(true, Ordering::SeqCst);
            state
                .sidecar_last_used_ms
                .store(now_millis(), Ordering::SeqCst);
            state.sidecar_standby.store(false, Ordering::SeqCst);
            *state.last_wav_path.lock().unwrap() = Some(wav_path.clone());
            // Transcript will arrive as a "transcript-ready" event from the
            // background stdout-reader thread (see spawn_sidecar below)
        }
        None => {
            *state.pending_transcript_meta.lock().unwrap() = None;
            app.emit(
                "transcription-error",
                serde_json::json!({"message": "STT engine is not running. Is opendicta-worker.exe built? Run: cargo build -p opendicta-worker"}),
            )
            .ok();
            hide_voicebar(&app);
            state.sidecar_busy.store(false, Ordering::SeqCst);
        }
    }
}

// ─── Rust Worker Sidecar ──────────────────────────────────────────────────────
//
// OpenDicta-worker is a compiled Rust binary (same workspace) that runs
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
    let bin_name = "opendicta-worker.exe";
    #[cfg(not(target_os = "windows"))]
    let bin_name = "opendicta-worker";

    let dev_path = workspace_root.join("target").join(profile).join(bin_name);
    if dev_path.exists() {
        return dev_path;
    }

    // Production: Tauri bundles externalBin next to the app executable.
    // Depending on bundle flow, the binary can be either:
    //   - opendicta-worker(.exe)
    //   - opendicta-worker-<target-triple>(.exe)
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
                            if name.starts_with("opendicta-worker-") && name.ends_with(".exe") {
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
                            if name.starts_with("opendicta-worker-") {
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

fn finish_transcript_request(state: &SharedState) {
    state.sidecar_busy.store(false, Ordering::SeqCst);
    state
        .sidecar_last_used_ms
        .store(now_millis(), Ordering::SeqCst);
    *state.pending_transcript_meta.lock().unwrap() = None;
    if let Some(path) = state.last_wav_path.lock().unwrap().take() {
        let _ = std::fs::remove_file(&path);
    }
}

fn spawn_sidecar(app: AppHandle, state: SharedState) {
    // Atomically claim the spawn slot. If another thread already claimed it, bail.
    if state
        .sidecar_spawning
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

    // Pass model id and exact dir so the worker doesn't have to guess.
    let model_id = state.active_model_id.lock().unwrap().clone();
    let model_dir = model_dir_for(&app, &model_id)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let mut command = std::process::Command::new(&program);
    command
        .env("OpenDicta_PROVIDER", &provider)
        .env("OpenDicta_MODEL_ID", &model_id)
        .env("OpenDicta_MODEL_DIR", &model_dir)
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
    state
        .sidecar_last_used_ms
        .store(now_millis(), Ordering::SeqCst);
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
                    let msg = text.strip_prefix("ERROR:").unwrap_or("").trim().to_string();
                    eprintln!("Sidecar error: {}", msg);
                    app_stdout
                        .emit("transcription-error", serde_json::json!({"message": msg}))
                        .ok();

                    // Hide the bar on error
                    hide_voicebar(&app_stdout);
                    *state_for_stdout.pending_transcript_meta.lock().unwrap() = None;
                    state_for_stdout.sidecar_busy.store(false, Ordering::SeqCst);
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
                }
                Ok(text) if text.starts_with("STATUS:") => {
                    let msg = text.strip_prefix("STATUS:").unwrap_or("").to_string();
                    println!("[worker] {}", msg);
                    // Forward to VoiceBar so it can show the current worker state
                    let _ =
                        app_stdout.emit("sidecar-status", serde_json::json!({ "message": msg }));
                    state_for_stdout
                        .sidecar_last_used_ms
                        .store(now_millis(), Ordering::SeqCst);
                }
                Ok(text) if text.starts_with("TRANSCRIPT:") => {
                    let transcript = text
                        .strip_prefix("TRANSCRIPT:")
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if transcript.is_empty() {
                        let _ = app_stdout.emit(
                            "transcription-error",
                            serde_json::json!({"message": "No speech detected."}),
                        );
                        hide_voicebar(&app_stdout);
                        finish_transcript_request(&state_for_stdout);
                        continue;
                    }
                    #[cfg(debug_assertions)]
                    println!("Transcript: {}", transcript);

                    let default_mode = state_for_stdout.ai_default_mode.lock().unwrap().clone();
                    let (effective_prompt, requested_ai_mode) =
                        resolve_ai_prompt_and_mode(&default_mode);

                    let mut applied_ai_mode = None;
                    let ai_enabled = state_for_stdout.ai_enabled.load(Ordering::SeqCst);
                    let final_text = if ai_enabled {
                        if let Some(prompt) = effective_prompt {
                            // Notify the UI that we are applying AI
                            let _ = app_stdout.emit(
                                "sidecar-status",
                                serde_json::json!({ "message": "Applying AI\u{2026}" }),
                            );

                            let backend = state_for_stdout.ai_backend.lock().unwrap().clone();
                            let model = state_for_stdout.ai_model.lock().unwrap().clone();
                            let ollama_url = state_for_stdout.ai_ollama_url.lock().unwrap().clone();
                            // Read from the encrypted in-memory store (loaded at startup via DPAPI
                            // on Windows, OS keyring on other platforms). Never re-read from disk here.
                            let api_key = match backend.as_str() {
                                "openai" => state_for_stdout
                                    .openai_api_key
                                    .lock()
                                    .unwrap()
                                    .clone()
                                    .unwrap_or_default(),
                                "gemini" => state_for_stdout
                                    .gemini_api_key
                                    .lock()
                                    .unwrap()
                                    .clone()
                                    .unwrap_or_default(),
                                "anthropic" => state_for_stdout
                                    .anthropic_api_key
                                    .lock()
                                    .unwrap()
                                    .clone()
                                    .unwrap_or_default(),
                                _ => String::new(), // Ollama needs no API key
                            };

                            match tauri::async_runtime::block_on(apply_ai_with_prompt(
                                &state_for_stdout.http_client,
                                &transcript,
                                prompt,
                                &backend,
                                &model,
                                &api_key,
                                &ollama_url,
                            )) {
                                Ok(processed) => {
                                    let processed_trimmed = processed.trim().to_string();
                                    #[cfg(debug_assertions)]
                                    println!(
                                        "[ai] success backend={} model={} output_preview={:?}",
                                        backend,
                                        model,
                                        processed_trimmed.chars().take(240).collect::<String>()
                                    );
                                    if processed_trimmed.is_empty() {
                                        eprintln!(
                                            "[ai] empty output from backend={}, falling back to raw transcript",
                                            backend
                                        );
                                        transcript.clone()
                                    } else {
                                        applied_ai_mode = requested_ai_mode;
                                        processed_trimmed
                                    }
                                }
                                Err(e) => {
                                    eprintln!("AI post-processing failed: {}", e);
                                    let _ = app_stdout.emit(
                                        "ai-processing-error",
                                        serde_json::json!({ "message": e }),
                                    );
                                    if let Some(warning) = ai_warning_message(&e) {
                                        let _ = app_stdout.emit(
                                            "ai-processing-warning",
                                            serde_json::json!({ "message": warning }),
                                        );
                                        let _ = app_stdout.emit(
                                            "sidecar-status",
                                            serde_json::json!({ "message": warning }),
                                        );
                                    }
                                    // Fall back to raw transcript
                                    transcript.clone()
                                }
                            }
                        } else {
                            transcript.clone()
                        }
                    } else {
                        transcript.clone()
                    };

                    // Auto-paste the result into the previously active app
                    if !final_text.trim().is_empty() {
                        #[cfg(debug_assertions)]
                        println!(
                            "[ai] paste final_text_len={} preview={:?}",
                            final_text.len(),
                            final_text.chars().take(240).collect::<String>()
                        );
                        // Ensure the voice bar window is hidden before we type,
                        // so focus can return to the previously active app.
                        hide_voicebar(&app_stdout);
                        paste_text(&app_stdout, &final_text);
                    } else {
                        eprintln!("[ai] final_text is empty, skipping paste");
                    }

                    let pending_meta = {
                        state_for_stdout
                            .pending_transcript_meta
                            .lock()
                            .unwrap()
                            .take()
                    };
                    if let Some(meta) = pending_meta {
                        let word_count = history::count_words(&final_text);
                        let record = history::TranscriptRecord {
                            id: format!("tr_{}", now_millis()),
                            created_at: iso_timestamp_now(),
                            text: final_text.clone(),
                            raw_text: transcript.clone(),
                            duration_seconds: meta.duration_seconds,
                            word_count,
                            wpm: history::calculate_wpm(word_count, meta.duration_seconds),
                            ai_mode: applied_ai_mode,
                        };
                        match transcript_history_path(&app_stdout) {
                            Ok(path) => {
                                let _history_guard =
                                    state_for_stdout.history_write_lock.lock().unwrap();
                                if let Err(err) = history::append_history_record(
                                    &path,
                                    legacy_transcript_history_path(&app_stdout)
                                        .ok()
                                        .flatten()
                                        .as_deref(),
                                    record,
                                ) {
                                    eprintln!("Failed to save transcript history: {}", err);
                                }
                            }
                            Err(err) => {
                                eprintln!("Failed to resolve transcript history path: {}", err);
                            }
                        }
                    }

                    // Notify the Voice Bar UI
                    let _ = app_stdout.emit(
                        "transcript-ready",
                        serde_json::json!({ "text": final_text }),
                    );
                    finish_transcript_request(&state_for_stdout);
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

// ─── AI Post-Processing ───────────────────────────────────────────────────────
//
// Sends the raw transcript to the configured AI backend and returns the
// processed text.  Supports OpenAI, Anthropic, and Ollama.

/// Core AI call — sends `transcript` to the backend with the given `system_prompt`.
async fn apply_ai_with_prompt(
    client: &reqwest::Client,
    transcript: &str,
    system_prompt: &str,
    backend: &str,
    model: &str,
    api_key: &str,
    ollama_url: &str,
) -> Result<String, String> {
    const AI_MAX_OUTPUT_TOKENS: u32 = 4096;
    #[cfg(debug_assertions)]
    {
        let transcript_preview: String = transcript.chars().take(240).collect();
        let prompt_preview: String = system_prompt.chars().take(240).collect();
        println!(
            "[ai] request backend={} model={} transcript_preview={:?} prompt_preview={:?}",
            backend, model, transcript_preview, prompt_preview
        );
    }
    match backend {
        "openai" => {
            let body = serde_json::json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": transcript}
                ],
                "max_tokens": AI_MAX_OUTPUT_TOKENS
            });
            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("OpenAI request failed: {}", e))?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                eprintln!(
                    "[ai] OpenAI error status={} body={}",
                    status,
                    text.chars().take(1500).collect::<String>()
                );
                return Err(format!("OpenAI request failed with status {}", status));
            }
            let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            json["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| "OpenAI returned no usable text".to_string())
        }
        "anthropic" => {
            let body = serde_json::json!({
                "model": model,
                "system": system_prompt,
                "messages": [{"role": "user", "content": transcript}],
                "max_tokens": AI_MAX_OUTPUT_TOKENS
            });
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Anthropic request failed: {}", e))?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                eprintln!(
                    "[ai] Anthropic error status={} body={}",
                    status,
                    text.chars().take(1500).collect::<String>()
                );
                return Err(format!("Anthropic request failed with status {}", status));
            }
            let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            json["content"][0]["text"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| "Anthropic returned no usable text".to_string())
        }
        "gemini" => {
            let body = serde_json::json!({
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": transcript}]}],
                "generationConfig": {"maxOutputTokens": AI_MAX_OUTPUT_TOKENS}
            });
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model
            );
            let resp = client
                .post(&url)
                .header("x-goog-api-key", api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Gemini request failed: {}", e))?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                eprintln!(
                    "[ai] Gemini error status={} body={}",
                    status,
                    text.chars().take(1500).collect::<String>()
                );
                return Err(format!("Gemini request failed with status {}", status));
            }
            let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let parts = json["candidates"][0]["content"]["parts"]
                .as_array()
                .ok_or_else(|| "Gemini returned no usable text".to_string())?;
            let combined = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("");
            let trimmed = combined.trim().to_string();
            if trimmed.is_empty() {
                Err("Gemini returned no usable text".to_string())
            } else {
                Ok(trimmed)
            }
        }
        "ollama" => {
            let body = serde_json::json!({
                "model": model,
                "stream": false,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": transcript}
                ]
            });
            let url = format!("{}/api/chat", ollama_url.trim_end_matches('/'));
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Ollama request failed: {}", e))?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                eprintln!(
                    "[ai] Ollama error status={} body={}",
                    status,
                    text.chars().take(1500).collect::<String>()
                );
                return Err(format!("Ollama request failed with status {}", status));
            }
            let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            json["message"]["content"]
                .as_str()
                .map(|s| s.trim().to_string())
                .ok_or_else(|| "Ollama returned no usable text".to_string())
        }
        other => Err(format!("Unknown AI backend: {}", other)),
    }
}

// ─── M4: Auto-paste ───────────────────────────────────────────────────────────
//
// enigo simulates keyboard input at the OS level.
// We type the text directly — more reliable than clipboard on some systems.
// On macOS the app needs Accessibility permission for this to work.

fn paste_text(app: &AppHandle, text: &str) {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    match Enigo::new(&Settings::default()) {
        Ok(mut enigo) => {
            // Delay to ensure the original app regains focus before typing.
            std::thread::sleep(std::time::Duration::from_millis(360));
            let clipboard_ok = app
                .clipboard()
                .write_text(text.to_string())
                .map(|_| true)
                .unwrap_or_else(|e| {
                    eprintln!("Clipboard write failed: {}", e);
                    false
                });

            if clipboard_ok {
                let mut pasted = true;
                if let Err(e) = enigo.key(Key::Control, Direction::Press) {
                    eprintln!("Ctrl down failed: {}", e);
                    pasted = false;
                }
                if let Err(e) = enigo.key(Key::Unicode('v'), Direction::Click) {
                    eprintln!("V click failed: {}", e);
                    pasted = false;
                }
                if let Err(e) = enigo.key(Key::Control, Direction::Release) {
                    eprintln!("Ctrl up failed: {}", e);
                }

                if pasted {
                    #[cfg(debug_assertions)]
                    println!("[ai] paste sent via clipboard+Ctrl+V");
                    return;
                }
            }

            if let Err(e) = enigo.text(text) {
                eprintln!("Paste typing fallback failed: {} — text: {}", e, text);
            } else {
                #[cfg(debug_assertions)]
                println!("[ai] paste sent via typing fallback");
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
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit OpenDicta").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&settings_item)
        .item(&separator)
        .item(&quit_item)
        .build()?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("OpenDicta — Press Right Ctrl to record")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
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

    let app_on_press = app.clone();
    let app_on_release = app.clone();
    let state_press = state.clone();
    let state_release = state.clone();
    let hotkey_for_callback = hotkey.to_string();
    let hotkey_for_register = hotkey.to_string();

    app.global_shortcut()
        .on_shortcut(
            hotkey_for_register.as_str(),
            move |_app, _shortcut, event| match event.state() {
                ShortcutState::Pressed => {
                    handle_shortcut_pressed(
                        app_on_press.clone(),
                        state_press.clone(),
                        hotkey_for_callback.clone(),
                    );
                }
                ShortcutState::Released => {
                    handle_shortcut_released(
                        app_on_release.clone(),
                        state_release.clone(),
                        hotkey_for_callback.clone(),
                    );
                }
            },
        )
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
    if state.shortcut_capture_mode.load(Ordering::SeqCst) {
        return;
    }
    println!("Shortcut pressed: {}", shortcut);
    let _ = app.emit(
        "shortcut-triggered",
        serde_json::json!({ "state": "pressed", "shortcut": shortcut }),
    );
    let push_to_talk = state.shortcut_push_to_talk.lock().unwrap().clone();
    let stop_and_discard = state.shortcut_stop_discard.lock().unwrap().clone();
    let refine_with_ai = state.shortcut_refine_ai.lock().unwrap().clone();

    if stop_and_discard.as_deref() == Some(shortcut.as_str()) {
        if state.recording.load(Ordering::SeqCst) {
            state.recording.store(false, Ordering::SeqCst);
            state.audio_buffer.lock().unwrap().clear();
            *state.pending_transcript_meta.lock().unwrap() = None;
            hide_voicebar(&app);
        }
        return;
    }
    if refine_with_ai.as_deref() == Some(shortcut.as_str()) {
        open_settings_page(&app, Some("style"));
        return;
    }

    let is_main_record = state.shortcut.lock().unwrap().as_str() == shortcut.as_str();
    let is_push_to_talk = push_to_talk.as_deref() == Some(shortcut.as_str());
    if !(is_main_record || is_push_to_talk) {
        return;
    }

    if is_main_record && state.recording.load(Ordering::SeqCst) {
        state.sidecar_busy.store(true, Ordering::SeqCst);
        state
            .sidecar_last_used_ms
            .store(now_millis(), Ordering::SeqCst);
        tauri::async_runtime::spawn(async move {
            finalize_recording(app, state).await;
        });
        return;
    }

    if state.sidecar_busy.load(Ordering::SeqCst) {
        return;
    }
    show_voicebar(&app);

    if state.recording.load(Ordering::SeqCst) {
        return;
    }

    state.recording.store(true, Ordering::SeqCst);
    state.audio_buffer.lock().unwrap().clear();
    *state.pending_transcript_meta.lock().unwrap() = None;

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
    if state.shortcut_capture_mode.load(Ordering::SeqCst) {
        return;
    }
    println!("Shortcut released: {}", shortcut);
    let _ = app.emit(
        "shortcut-triggered",
        serde_json::json!({ "state": "released", "shortcut": shortcut }),
    );
    let is_recording_release = {
        let main_shortcut = state.shortcut.lock().unwrap().clone();
        let push_to_talk = state.shortcut_push_to_talk.lock().unwrap().clone();
        push_to_talk.as_deref() == Some(shortcut.as_str()) && push_to_talk.as_deref() != Some(main_shortcut.as_str())
    };
    if !is_recording_release {
        return;
    }
    if !state.recording.load(Ordering::SeqCst) {
        return;
    }

    state.sidecar_busy.store(true, Ordering::SeqCst);
    state
        .sidecar_last_used_ms
        .store(now_millis(), Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        finalize_recording(app, state).await;
    });
}

#[cfg(target_os = "windows")]
fn register_right_ctrl_native(
    app: &AppHandle,
    state: SharedState,
    hotkey: &str,
) -> Result<(), String> {
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
            let pressed = unsafe {
                windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(VK_RCONTROL_CODE)
            } < 0;
            if pressed && !was_pressed {
                handle_shortcut_pressed(app_on_key.clone(), state_on_key.clone(), shortcut.clone());
            } else if !pressed && was_pressed {
                handle_shortcut_released(
                    app_on_key.clone(),
                    state_on_key.clone(),
                    shortcut.clone(),
                );
            }
            was_pressed = pressed;
            std::thread::sleep(std::time::Duration::from_millis(12));
        }
        state_on_key
            .right_ctrl_active
            .store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn register_right_ctrl_native(
    _app: &AppHandle,
    _state: SharedState,
    _hotkey: &str,
) -> Result<(), String> {
    Err("ControlRight-only shortcut is only supported on Windows in this build".to_string())
}

fn setup_hotkey(app: &AppHandle, state: SharedState) -> Result<(), String> {
    let hotkey = state.shortcut.lock().unwrap().clone();
    match register_hotkey(app, state.clone(), &hotkey) {
        Ok(()) => {}
        Err(e) => {
            eprintln!("Hotkey '{}' failed to register: {}", hotkey, e);
            *state.shortcut.lock().unwrap() = DEFAULT_SHORTCUT.to_string();
            register_hotkey(app, state.clone(), DEFAULT_SHORTCUT).map_err(|e2| {
                format!(
                    "Failed to register fallback shortcut '{}': {}",
                    DEFAULT_SHORTCUT, e2
                )
            })?;
        }
    }
    for extra in [
        state.shortcut_push_to_talk.lock().unwrap().clone(),
        state.shortcut_stop_discard.lock().unwrap().clone(),
        state.shortcut_refine_ai.lock().unwrap().clone(),
    ] {
        if let Some(hk) = extra {
            if hk.trim().is_empty() {
                continue;
            }
            if hk == state.shortcut.lock().unwrap().clone() {
                continue;
            }
            if let Err(e) = register_hotkey(app, state.clone(), &hk) {
                eprintln!("Optional shortcut '{}' failed to register: {}", hk, e);
            }
        }
    }
    Ok(())
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
            get_transcript_history,
            get_dashboard_stats,
            get_insights_stats,
            get_latest_transcript_data,
            get_productivity_settings,
            set_typing_baseline_wpm,
            cancel_recording,
            check_for_updates,
            get_shortcut,
            get_waveform_color,
            get_active_model_id,
            set_active_model_id,
            get_asr_model,
            get_asr_backend,
            get_runtime_profile,
            get_shortcut_status,
            get_shortcut_bindings,
            set_shortcut_capture_mode,
            set_shortcut,
            set_shortcut_binding,
            set_waveform_color,
            set_asr_model,
            set_asr_backend,
            set_runtime_profile,
            set_voicebar_position,
            reset_voicebar_position,
            get_audio_input_info,
            test_microphone,
            set_audio_input_device,
            get_completion_sound,
            set_completion_sound,
            get_default_shortcut,
            get_debug_mic_level,
            set_debug_mic_level,
            run_health_check,
            get_model_status,
            download_model,
            delete_model,
            get_onnx_provider,
            get_provider_runtime_status,
            set_onnx_provider,
            get_ai_settings,
            get_ai_enabled,
            set_ai_model,
            get_hf_token,
            set_hf_token,
            get_voicebar_visible,
            get_onboarding_state,
            complete_onboarding,
            open_settings_page_command,
            open_empty_state,
            get_autostart_enabled,
            set_autostart_enabled,
            get_ai_settings,
            get_ai_default_mode,
            set_ai_enabled,
            set_ai_default_mode,
            set_ai_backend,
            set_ai_api_key,
            set_ai_model,
            set_ai_ollama_url,
            test_ai_connection,
        ])
        .setup(move |app| {
            // Hide from macOS Dock — we're a menu bar app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            load_app_settings(app.handle(), state.clone());

            if let Some((x, y)) = load_voicebar_position(app.handle()) {
                *state.voicebar_pos.lock().unwrap() = Some((x, y));
                if let Some(win) = app.get_webview_window("voicebar") {
                    let _ = win.set_position(tauri::LogicalPosition::new(x as f64, y as f64));
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
            } else {
                // Pre-create Settings off-screen so WebView2 renders eagerly.
                // visible(false) prevents WebView2 from rendering content, causing a
                // blank first show. Off-screen + visible is the fix, but we only
                // do it after onboarding so first-run stays onboarding-only.
                let app_settings = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    let app_inner = app_settings.clone();
                    let _ = app_settings.run_on_main_thread(move || {
                        if app_inner.get_webview_window("settings").is_none() {
                            let (width, height, min_width, min_height) = settings_window_dimensions();
                            let _ = tauri::WebviewWindowBuilder::new(
                                &app_inner,
                                "settings",
                                tauri::WebviewUrl::App("/?window=settings".into()),
                            )
                            .title("OpenDicta")
                            .inner_size(width, height)
                            .min_inner_size(min_width, min_height)
                            .resizable(true)
                            .decorations(false)
                            .transparent(true)
                            .position(-32000.0, -32000.0)
                            .skip_taskbar(false)
                            .build();
                        }
                    });
                });

                if !model_ready {
                    let app_model_hint = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        open_settings_page(&app_model_hint, Some("model"));
                    });
                }
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
        .expect("Error running OpenDicta");
}

#[cfg(test)]
mod ai_settings_tests {
    use super::*;
    use crate::ai::AiProvider;

    #[test]
    fn default_ai_preset_is_raw() {
        assert_eq!(default_ai_model(), "raw");
    }

    #[test]
    fn settings_window_uses_larger_no_scroll_defaults() {
        let (width, height, min_width, min_height) = settings_window_dimensions();

        assert_eq!((width, height), (1120.0, 860.0));
        assert_eq!((min_width, min_height), (1040.0, 820.0));
        assert!(width >= min_width);
        assert!(height >= min_height);
    }

    #[test]
    fn ai_provider_validation_accepts_supported_values() {
        assert!(AiProvider::from_settings_value("openai").is_some());
        assert!(AiProvider::from_settings_value("gemini").is_some());
        assert!(AiProvider::from_settings_value("other").is_none());
    }

    #[test]
    fn model_id_validation_rejects_path_traversal_and_accepts_known_ids() {
        // Real model ids resolve cleanly.
        for id in [
            "parakeet",
            "canary_qwen_2_5b",
            "whisper_small",
            "whisper_large_v3_turbo",
            "qwen3_asr",
        ] {
            assert!(is_valid_model_id(id), "expected {id} to be valid");
        }

        // Traversal / absolute / UNC / drive paths must be rejected before any
        // filesystem operation in model_dir_for.
        for id in [
            "",
            "../../evil",
            "..",
            "models/../../etc",
            "/etc/passwd",
            "\\\\server\\share",
            "C:\\Windows",
            "foo/bar",
            "foo.bar",
        ] {
            assert!(!is_valid_model_id(id), "expected {id:?} to be rejected");
        }
    }

    #[test]
    fn finish_transcript_request_clears_busy_and_cleans_up_wav_path() {
        let state: SharedState = Arc::new(AppState::new());
        state.sidecar_busy.store(true, Ordering::SeqCst);
        state.sidecar_last_used_ms.store(0, Ordering::SeqCst);
        *state.last_wav_path.lock().unwrap() =
            Some(std::path::PathBuf::from("nonexistent-test-audio.wav"));

        finish_transcript_request(&state);

        assert!(!state.sidecar_busy.load(Ordering::SeqCst));
        assert!(state.sidecar_last_used_ms.load(Ordering::SeqCst) > 0);
        assert!(state.last_wav_path.lock().unwrap().is_none());
    }

    #[test]
    fn timestamp_helpers_format_unix_seconds_as_utc_iso() {
        assert_eq!(unix_seconds_to_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_seconds_to_iso(1_778_932_800), "2026-05-16T12:00:00Z");
    }

    #[test]
    fn app_state_initializes_history_defaults() {
        let state = AppState::new();

        assert_eq!(
            *state.typing_baseline_wpm.lock().unwrap(),
            history::DEFAULT_TYPING_BASELINE_WPM
        );
        assert!(state.pending_transcript_meta.lock().unwrap().is_none());
    }

    #[test]
    fn ai_history_mode_matches_prompt_resolution() {
        let (prompt, mode) = resolve_ai_prompt_and_mode("clean");
        assert!(prompt.is_some());
        assert_eq!(mode.as_deref(), Some("clean"));

        let (prompt, mode) = resolve_ai_prompt_and_mode("raw");
        assert!(prompt.is_none());
        assert!(mode.is_none());

        let (prompt, mode) = resolve_ai_prompt_and_mode("email");
        assert!(prompt.is_some());
        assert_eq!(mode.as_deref(), Some("email"));
    }

    #[test]
    fn model_specs_define_sha256_for_every_file() {
        for spec in PARAKEET_FILES.iter().chain(CANARY_FILES.iter()) {
            assert!(
                spec.sha256.is_some(),
                "missing sha256 for model file {}",
                spec.name
            );
        }
    }

    #[test]
    fn model_file_matches_spec_accepts_matching_hash() {
        let unique = crate::now_millis();
        let dir = std::env::temp_dir().join(format!("OpenDicta-model-hash-ok-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tokens.txt");
        let content = b"voice note tokens";
        std::fs::write(&path, content).unwrap();
        let expected_hash = format!("{:x}", Sha256::digest(content));
        let spec = ModelFileSpec {
            name: "tokens.txt",
            expected_bytes: content.len() as u64,
            sha256: Some(Box::leak(expected_hash.into_boxed_str())),
        };

        let matches = tauri::async_runtime::block_on(model_file_matches_spec(&path, &spec));

        assert!(matches);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn model_file_matches_spec_rejects_wrong_hash_even_with_matching_size() {
        let unique = crate::now_millis();
        let dir = std::env::temp_dir().join(format!("OpenDicta-model-hash-bad-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tokens.txt");
        let content = b"voice note tokens";
        std::fs::write(&path, content).unwrap();
        let spec = ModelFileSpec {
            name: "tokens.txt",
            expected_bytes: content.len() as u64,
            sha256: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        };

        let matches = tauri::async_runtime::block_on(model_file_matches_spec(&path, &spec));

        assert!(!matches);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn normalize_boosts_quiet_signal_toward_target() {
        let mut samples = vec![0.01_f32; 16_000];
        normalize_audio(&mut samples);
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        assert!(rms > 0.08 && rms <= 0.12, "rms after boost was {rms}");
    }

    #[test]
    fn normalize_caps_gain_for_near_silent_signal() {
        let mut samples = vec![0.00001_f32; 16_000];
        normalize_audio(&mut samples);
        let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        assert!(peak < 0.0003, "near-silent signal over-amplified: peak {peak}");
    }

    #[test]
    fn normalize_never_clips_with_loud_transient() {
        let mut samples = vec![0.02_f32; 16_000];
        samples[0] = 1.0;
        normalize_audio(&mut samples);
        let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        assert!(peak <= 0.97, "output clipped: peak {peak}");
    }

    #[test]
    fn normalize_handles_empty_and_silent_buffers() {
        let mut empty: Vec<f32> = vec![];
        normalize_audio(&mut empty);

        let mut silent = vec![0.0_f32; 1_000];
        normalize_audio(&mut silent);
        assert!(silent.iter().all(|s| s.is_finite() && *s == 0.0));
    }

    #[test]
    fn normalize_does_not_amplify_already_loud_signal() {
        let mut samples = vec![0.3_f32; 16_000];
        normalize_audio(&mut samples);
        let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        assert!(peak <= 0.97);
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        assert!(rms >= 0.29 && rms <= 0.31, "signal level changed unexpectedly: rms {rms}");
    }
}
