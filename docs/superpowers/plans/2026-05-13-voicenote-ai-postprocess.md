# VoiceNote AI Post-Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional AI transcript cleanup and translation in the Tauri host, with user-supplied OpenAI or Gemini API keys, while keeping the existing local-only flow as the default.

**Architecture:** Keep the current Rust worker transcription path unchanged and insert a post-processing stage in the Tauri host after `TRANSCRIPT:` arrives and before `paste_text(...)` runs. Store non-secret AI settings in `settings.json`, store provider API keys in the OS keyring, and isolate provider-specific HTTP logic behind a small Rust `ai` module.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, Reqwest 0.12, Serde, Keyring 3, React 18, TypeScript 5

---

## File Map

| File | Role | Tasks |
|------|------|-------|
| `src-tauri/src/ai.rs` | **NEW** core AI settings types, validation, prompt building, provider dispatch, unit tests | 1, 4 |
| `src-tauri/src/ai/openai.rs` | **NEW** OpenAI request/response adapter | 2 |
| `src-tauri/src/ai/gemini.rs` | **NEW** Gemini request/response adapter | 2 |
| `src-tauri/src/lib.rs` | App state, settings persistence, keyring commands, transcript hook, UI event emission | 3, 4 |
| `src/windows/settingsTypes.ts` | Add AI page + frontend DTOs | 5 |
| `src/windows/Settings.tsx` | Add AI tab, provider/key/target-language controls, privacy note | 5 |

---

## Task 1: Create the Rust AI Core Module

**Files:**
- Create: `src-tauri/src/ai.rs`
- Test: `src-tauri/src/ai.rs`

This task defines the stable internal contract for AI post-processing before any app wiring changes are made.

- [ ] **Step 1: Create `src-tauri/src/ai.rs` with core types**

```rust
use serde::{Deserialize, Serialize};

pub mod gemini;
pub mod openai;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiPreset {
    Raw,
    Clean,
    Translate,
    CleanTranslate,
}

impl AiPreset {
    pub fn from_settings_value(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "raw" => Some(Self::Raw),
            "clean" => Some(Self::Clean),
            "translate" => Some(Self::Translate),
            "clean_translate" => Some(Self::CleanTranslate),
            _ => None,
        }
    }

    pub fn as_settings_value(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Clean => "clean",
            Self::Translate => "translate",
            Self::CleanTranslate => "clean_translate",
        }
    }

    pub fn requires_target_language(self) -> bool {
        matches!(self, Self::Translate | Self::CleanTranslate)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProvider {
    OpenAi,
    Gemini,
}

impl AiProvider {
    pub fn from_settings_value(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "openai" => Some(Self::OpenAi),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }

    pub fn as_settings_value(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConfig {
    pub preset: AiPreset,
    pub provider: Option<AiProvider>,
    pub target_language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformRequest {
    pub provider: AiProvider,
    pub preset: AiPreset,
    pub target_language: Option<String>,
    pub transcript: String,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransformError {
    MissingProvider,
    MissingApiKey,
    MissingTargetLanguage,
    EmptyTranscript,
    Http(String),
    InvalidResponse(String),
}
```

- [ ] **Step 2: Add prompt-building and validation helpers**

Append this code below the type definitions:

```rust
pub fn validate_transform_input(
    config: &AiConfig,
    transcript: &str,
    api_key: Option<&str>,
) -> Result<Option<TransformRequest>, TransformError> {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return Err(TransformError::EmptyTranscript);
    }
    if config.preset == AiPreset::Raw {
        return Ok(None);
    }
    let provider = config.provider.ok_or(TransformError::MissingProvider)?;
    let api_key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(TransformError::MissingApiKey)?;
    let target_language = config
        .target_language
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if config.preset.requires_target_language() && target_language.is_none() {
        return Err(TransformError::MissingTargetLanguage);
    }
    Ok(Some(TransformRequest {
        provider,
        preset: config.preset,
        target_language,
        transcript: transcript.to_string(),
        api_key: api_key.to_string(),
    }))
}

pub fn build_instruction(request: &TransformRequest) -> String {
    let common = "Return only the final transformed text. Do not explain your work. Preserve meaning, names, numbers, and key details.";
    match request.preset {
        AiPreset::Raw => "Return the transcript unchanged.".to_string(),
        AiPreset::Clean => format!(
            "{common} Remove filler words such as uh, um, and uhm. Remove obvious false starts and repeated fragments. Normalize punctuation. Keep the original language."
        ),
        AiPreset::Translate => format!(
            "{common} Translate the transcript into {}. Do not summarize.",
            request.target_language.as_deref().unwrap_or("English")
        ),
        AiPreset::CleanTranslate => format!(
            "{common} First clean filler words, false starts, repeated fragments, and punctuation. Then translate the result into {}. Do not summarize.",
            request.target_language.as_deref().unwrap_or("English")
        ),
    }
}
```

- [ ] **Step 3: Add unit tests in `ai.rs`**

Append this test module at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_preset_skips_transform() {
        let config = AiConfig {
            preset: AiPreset::Raw,
            provider: None,
            target_language: None,
        };
        let result = validate_transform_input(&config, "hej verden", None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn translate_requires_target_language() {
        let config = AiConfig {
            preset: AiPreset::Translate,
            provider: Some(AiProvider::OpenAi),
            target_language: None,
        };
        let err = validate_transform_input(&config, "hej verden", Some("sk-test")).unwrap_err();
        assert_eq!(err, TransformError::MissingTargetLanguage);
    }

    #[test]
    fn clean_translate_builds_expected_instruction() {
        let request = TransformRequest {
            provider: AiProvider::Gemini,
            preset: AiPreset::CleanTranslate,
            target_language: Some("English".to_string()),
            transcript: "uh hej verden".to_string(),
            api_key: "key".to_string(),
        };
        let instruction = build_instruction(&request);
        assert!(instruction.contains("Return only the final transformed text"));
        assert!(instruction.contains("translate the result into English"));
    }
}
```

- [ ] **Step 4: Run the Rust tests for the new module**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai::tests -- --nocapture`

Expected: 3 tests pass and no unresolved module errors.

---

## Task 2: Add Provider Adapters

**Files:**
- Create: `src-tauri/src/ai/openai.rs`
- Create: `src-tauri/src/ai/gemini.rs`
- Test: `src-tauri/src/ai/openai.rs`
- Test: `src-tauri/src/ai/gemini.rs`

This task isolates API-specific payload shapes and response parsing from the rest of the app.

- [ ] **Step 1: Create `src-tauri/src/ai/openai.rs`**

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{build_instruction, TransformError, TransformRequest};

const OPENAI_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_MODEL: &str = "gpt-5-mini";

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    input: Vec<OpenAiInput<'a>>,
}

#[derive(Serialize)]
struct OpenAiInput<'a> {
    role: &'a str,
    content: Vec<OpenAiContent<'a>>,
}

#[derive(Serialize)]
struct OpenAiContent<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    text: &'a str,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    output_text: Option<String>,
}

pub async fn transform(client: &Client, request: &TransformRequest) -> Result<String, TransformError> {
    let instruction = build_instruction(request);
    let payload = OpenAiRequest {
        model: OPENAI_MODEL,
        input: vec![
            OpenAiInput {
                role: "system",
                content: vec![OpenAiContent { kind: "input_text", text: &instruction }],
            },
            OpenAiInput {
                role: "user",
                content: vec![OpenAiContent { kind: "input_text", text: &request.transcript }],
            },
        ],
    };
    let response = client
        .post(OPENAI_URL)
        .bearer_auth(&request.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| TransformError::Http(e.to_string()))?;
    let response = response
        .error_for_status()
        .map_err(|e| TransformError::Http(e.to_string()))?;
    let body: OpenAiResponse = response
        .json()
        .await
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    body.output_text
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| TransformError::InvalidResponse("OpenAI returned empty output_text".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_response_rejects_empty_output() {
        let body = OpenAiResponse { output_text: Some("   ".to_string()) };
        let result = body.output_text
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty());
        assert!(result.is_none());
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/ai/gemini.rs`**

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{build_instruction, TransformError, TransformRequest};

const GEMINI_MODEL: &str = "gemini-2.5-flash";

#[derive(Serialize)]
struct GeminiRequest<'a> {
    contents: Vec<GeminiContent<'a>>,
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiInstruction<'a>,
}

#[derive(Serialize)]
struct GeminiInstruction<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Serialize)]
struct GeminiContent<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Serialize, Deserialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiCandidateContent>,
}

#[derive(Deserialize)]
struct GeminiCandidateContent {
    parts: Option<Vec<GeminiCandidatePart>>,
}

#[derive(Deserialize)]
struct GeminiCandidatePart {
    text: Option<String>,
}

pub async fn transform(client: &Client, request: &TransformRequest) -> Result<String, TransformError> {
    let instruction = build_instruction(request);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        GEMINI_MODEL,
        request.api_key
    );
    let payload = GeminiRequest {
        system_instruction: GeminiInstruction {
            parts: vec![GeminiPart { text: &instruction }],
        },
        contents: vec![GeminiContent {
            parts: vec![GeminiPart { text: &request.transcript }],
        }],
    };
    let response = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| TransformError::Http(e.to_string()))?;
    let response = response
        .error_for_status()
        .map_err(|e| TransformError::Http(e.to_string()))?;
    let body: GeminiResponse = response
        .json()
        .await
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    let text = body
        .candidates
        .unwrap_or_default()
        .into_iter()
        .flat_map(|candidate| candidate.content.into_iter())
        .flat_map(|content| content.parts.unwrap_or_default().into_iter())
        .find_map(|part| part.text)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    text.ok_or_else(|| TransformError::InvalidResponse("Gemini returned no text candidate".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_parsing_prefers_first_non_empty_text() {
        let body = GeminiResponse {
            candidates: Some(vec![GeminiCandidate {
                content: Some(GeminiCandidateContent {
                    parts: Some(vec![GeminiCandidatePart { text: Some("Hello".to_string()) }]),
                }),
            }]),
        };
        let text = body
            .candidates
            .unwrap_or_default()
            .into_iter()
            .flat_map(|candidate| candidate.content.into_iter())
            .flat_map(|content| content.parts.unwrap_or_default().into_iter())
            .find_map(|part| part.text);
        assert_eq!(text.as_deref(), Some("Hello"));
    }
}
```

- [ ] **Step 3: Add provider dispatch to `src-tauri/src/ai.rs`**

Append this function below `build_instruction`:

```rust
pub async fn transform_with_provider(
    client: &reqwest::Client,
    request: &TransformRequest,
) -> Result<String, TransformError> {
    match request.provider {
        AiProvider::OpenAi => openai::transform(client, request).await,
        AiProvider::Gemini => gemini::transform(client, request).await,
    }
}
```

- [ ] **Step 4: Run focused Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml openai::tests gemini::tests ai::tests -- --nocapture`

Expected: provider parsing tests and AI core tests pass.

---

## Task 3: Add AI State, Settings, and Keyring Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

This task wires AI configuration into app state and keeps secrets out of `settings.json`.

- [ ] **Step 1: Declare the new module and import its types**

At the top of `src-tauri/src/lib.rs`, after the crate docs and before the existing `use` blocks, add:

```rust
mod ai;
```

Then add this import near the other `use` lines:

```rust
use ai::{AiConfig, AiPreset, AiProvider, TransformError};
```

- [ ] **Step 2: Extend `AppState` with AI fields**

In the `AppState` struct, after `completion_sound: Arc<AtomicBool>,` add:

```rust
    ai_preset: Arc<Mutex<String>>,
    ai_provider: Arc<Mutex<Option<String>>>,
    ai_target_language: Arc<Mutex<Option<String>>>,
    openai_api_key: Arc<Mutex<Option<String>>>,
    gemini_api_key: Arc<Mutex<Option<String>>>,
    http_client: reqwest::Client,
```

In `AppState::new()`, add these initializers:

```rust
            ai_preset: Arc::new(Mutex::new("raw".to_string())),
            ai_provider: Arc::new(Mutex::new(None)),
            ai_target_language: Arc::new(Mutex::new(None)),
            openai_api_key: Arc::new(Mutex::new(None)),
            gemini_api_key: Arc::new(Mutex::new(None)),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(12))
                .build()
                .expect("failed to build shared HTTP client"),
```

- [ ] **Step 3: Extend `AppSettings` and persistence**

In `AppSettings`, after `completion_sound: bool,` add:

```rust
    #[serde(default = "default_ai_preset")]
    ai_preset: String,
    #[serde(default)]
    ai_provider: Option<String>,
    #[serde(default)]
    ai_target_language: Option<String>,
```

Add the default helper:

```rust
fn default_ai_preset() -> String {
    "raw".to_string()
}
```

In `save_app_settings`, add:

```rust
        ai_preset: state.ai_preset.lock().unwrap().clone(),
        ai_provider: state.ai_provider.lock().unwrap().clone(),
        ai_target_language: state.ai_target_language.lock().unwrap().clone(),
```

In `load_app_settings`, add:

```rust
    *state.ai_preset.lock().unwrap() = settings.ai_preset;
    *state.ai_provider.lock().unwrap() = settings.ai_provider;
    *state.ai_target_language.lock().unwrap() = settings.ai_target_language;
```

- [ ] **Step 4: Add keyring helpers for provider API keys**

Below the existing Hugging Face keyring helpers, add:

```rust
fn openai_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.voicenote.app", "openai_api_key")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn gemini_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.voicenote.app", "gemini_api_key")
        .map_err(|e| format!("Keyring initialization failed: {}", e))
}

fn load_secret(entry: Result<keyring::Entry, String>) -> Option<String> {
    let entry = entry.ok()?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
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
```

Then in `load_app_settings`, add:

```rust
    *state.openai_api_key.lock().unwrap() = load_secret(openai_keyring_entry());
    *state.gemini_api_key.lock().unwrap() = load_secret(gemini_keyring_entry());
```

- [ ] **Step 5: Add Tauri commands for AI settings and masked keys**

Add these structs and commands near the other `#[tauri::command]` functions:

```rust
#[derive(Clone, serde::Serialize)]
struct AiSettingsPayload {
    preset: String,
    provider: Option<String>,
    target_language: Option<String>,
    openai_key: Option<String>,
    gemini_key: Option<String>,
}

#[tauri::command]
async fn get_ai_settings(state: tauri::State<'_, SharedState>) -> Result<AiSettingsPayload, String> {
    Ok(AiSettingsPayload {
        preset: state.ai_preset.lock().unwrap().clone(),
        provider: state.ai_provider.lock().unwrap().clone(),
        target_language: state.ai_target_language.lock().unwrap().clone(),
        openai_key: state.openai_api_key.lock().unwrap().as_deref().map(mask_token),
        gemini_key: state.gemini_api_key.lock().unwrap().as_deref().map(mask_token),
    })
}

#[tauri::command]
async fn set_ai_preset(app: AppHandle, state: tauri::State<'_, SharedState>, preset: String) -> Result<(), String> {
    let preset = preset.trim().to_lowercase();
    AiPreset::from_settings_value(&preset).ok_or_else(|| "Unsupported AI preset".to_string())?;
    *state.ai_preset.lock().unwrap() = preset;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_provider(app: AppHandle, state: tauri::State<'_, SharedState>, provider: Option<String>) -> Result<(), String> {
    let provider = provider
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    if let Some(ref value) = provider {
        AiProvider::from_settings_value(value).ok_or_else(|| "Unsupported AI provider".to_string())?;
    }
    *state.ai_provider.lock().unwrap() = provider;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_ai_target_language(app: AppHandle, state: tauri::State<'_, SharedState>, language: Option<String>) -> Result<(), String> {
    let language = language
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    *state.ai_target_language.lock().unwrap() = language;
    save_app_settings(&app, state.inner().clone())
}

#[tauri::command]
async fn set_openai_api_key(state: tauri::State<'_, SharedState>, token: Option<String>) -> Result<(), String> {
    let token = token.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    save_secret(openai_keyring_entry(), token.as_deref())?;
    *state.openai_api_key.lock().unwrap() = token;
    Ok(())
}

#[tauri::command]
async fn set_gemini_api_key(state: tauri::State<'_, SharedState>, token: Option<String>) -> Result<(), String> {
    let token = token.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    save_secret(gemini_keyring_entry(), token.as_deref())?;
    *state.gemini_api_key.lock().unwrap() = token;
    Ok(())
}
```

Add these command names to `invoke_handler`:

```rust
            get_ai_settings,
            set_ai_preset,
            set_ai_provider,
            set_ai_target_language,
            set_openai_api_key,
            set_gemini_api_key,
```

- [ ] **Step 6: Add a small Rust test module for settings parsing**

Append this to `lib.rs` near the bottom:

```rust
#[cfg(test)]
mod ai_settings_tests {
    use super::*;

    #[test]
    fn default_ai_preset_is_raw() {
        assert_eq!(default_ai_preset(), "raw");
    }

    #[test]
    fn ai_provider_validation_accepts_supported_values() {
        assert!(AiProvider::from_settings_value("openai").is_some());
        assert!(AiProvider::from_settings_value("gemini").is_some());
        assert!(AiProvider::from_settings_value("other").is_none());
    }
}
```

- [ ] **Step 7: Run backend verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai_settings_tests ai::tests openai::tests gemini::tests -- --nocapture`

Expected: all AI-related tests pass and `lib.rs` compiles with the new commands and state.

---

## Task 4: Integrate AI Post-Processing Into Transcript Handling

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ai.rs`
- Test: `src-tauri/src/ai.rs`

This task changes the paste path while preserving fallback-to-raw behavior.

- [ ] **Step 1: Add helper functions in `lib.rs` to read config and key**

Add these helper functions above `spawn_sidecar`:

```rust
fn current_ai_config(state: &SharedState) -> AiConfig {
    let preset = state.ai_preset.lock().unwrap().clone();
    let provider = state
        .ai_provider
        .lock()
        .unwrap()
        .clone()
        .and_then(|value| AiProvider::from_settings_value(&value));
    let target_language = state.ai_target_language.lock().unwrap().clone();
    AiConfig {
        preset: AiPreset::from_settings_value(&preset).unwrap_or(AiPreset::Raw),
        provider,
        target_language,
    }
}

fn current_provider_key(state: &SharedState, provider: AiProvider) -> Option<String> {
    match provider {
        AiProvider::OpenAi => state.openai_api_key.lock().unwrap().clone(),
        AiProvider::Gemini => state.gemini_api_key.lock().unwrap().clone(),
    }
}
```

- [ ] **Step 2: Add the async transform wrapper**

Add this helper near the other private functions:

```rust
async fn transform_transcript_if_enabled(
    state: SharedState,
    transcript: String,
) -> Result<String, TransformError> {
    let config = current_ai_config(&state);
    let provider = config.provider;
    let api_key = provider.and_then(|value| current_provider_key(&state, value));
    let request = match ai::validate_transform_input(&config, &transcript, api_key.as_deref())? {
        Some(request) => request,
        None => return Ok(transcript),
    };
    ai::transform_with_provider(&state.http_client, &request).await
}
```

- [ ] **Step 3: Replace the direct paste path in the `TRANSCRIPT:` handler**

In `spawn_sidecar`, replace this block:

```rust
                    // Auto-paste the transcript into the previously active app
                    paste_text(&transcript);
```

with this async spawn:

```rust
                    let transcript_for_ui = transcript.clone();
                    let transcript_fallback = transcript.clone();
                    let app_for_transform = app_stdout.clone();
                    let state_for_transform = state_for_stdout.clone();

                    tauri::async_runtime::spawn(async move {
                        match transform_transcript_if_enabled(state_for_transform.clone(), transcript.clone()).await {
                            Ok(final_text) => {
                                paste_text(&final_text);
                                let _ = app_for_transform.emit(
                                    "transcript-ready",
                                    serde_json::json!({ "text": final_text }),
                                );
                            }
                            Err(err) => {
                                eprintln!("AI post-process failed: {:?}", err);
                                paste_text(&transcript_fallback);
                                let _ = app_for_transform.emit(
                                    "ai-transform-error",
                                    serde_json::json!({ "message": format!("AI post-processing failed: {:?}", err) }),
                                );
                                let _ = app_for_transform.emit(
                                    "transcript-ready",
                                    serde_json::json!({ "text": transcript_for_ui }),
                                );
                            }
                        }
                    });
```

Then remove the old immediate `transcript-ready` emit below it, because the async branch now owns it.

- [ ] **Step 4: Keep existing busy/WAV cleanup behavior intact**

Leave these lines in the `TRANSCRIPT:` arm after the new async spawn:

```rust
                    state_for_stdout.sidecar_busy.store(false, Ordering::SeqCst);
                    state_for_stdout.sidecar_last_used_ms.store(now_millis(), Ordering::SeqCst);
                    if let Some(path) = state_for_stdout.last_wav_path.lock().unwrap().take() {
                        let _ = std::fs::remove_file(&path);
                    }
```

This preserves the worker lifecycle regardless of AI success or failure.

- [ ] **Step 5: Add a fallback test in `src-tauri/src/ai.rs`**

Append this test:

```rust
    #[test]
    fn missing_key_is_a_validation_error_for_clean_mode() {
        let config = AiConfig {
            preset: AiPreset::Clean,
            provider: Some(AiProvider::OpenAi),
            target_language: None,
        };
        let err = validate_transform_input(&config, "uh hello", None).unwrap_err();
        assert_eq!(err, TransformError::MissingApiKey);
    }
```

- [ ] **Step 6: Run backend verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ai::tests ai_settings_tests -- --nocapture`

Expected: AI validation tests pass and no type errors remain in `spawn_sidecar`.

---

## Task 5: Add the AI Settings UI

**Files:**
- Modify: `src/windows/settingsTypes.ts`
- Modify: `src/windows/Settings.tsx`

This task exposes the backend settings without adding any new window flow.

- [ ] **Step 1: Extend `settingsTypes.ts`**

Replace the `Page` type with:

```ts
export type Page =
  | "general"
  | "shortcut"
  | "microphone"
  | "model"
  | "ai"
  | "appearance"
  | "diagnostics"
  | "about";
```

Append these exported types:

```ts
export type AiPreset = "raw" | "clean" | "translate" | "clean_translate";
export type AiProvider = "openai" | "gemini";
export type AiSettingsPayload = {
  preset: AiPreset;
  provider: AiProvider | null;
  target_language: string | null;
  openai_key: string | null;
  gemini_key: string | null;
};
```

- [ ] **Step 2: Add the AI page wiring in `Settings.tsx`**

Update `PAGE_ALIASES`:

```ts
  ai: "ai",
```

Update the `Sidebar` tabs array to include:

```tsx
    { id: "ai", label: "AI", icon: <ActivityIcon /> },
```

Update the main pane switch block to include:

```tsx
            <div style={{ display: page === "ai" ? "" : "none" }}><AiTab /></div>
```

- [ ] **Step 3: Add the `AiTab` component**

Append this component above `DiagnosticsTab`:

```tsx
function AiTab() {
  const [settings, setSettings] = useState<AiSettingsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [openAiInput, setOpenAiInput] = useState("");
  const [geminiInput, setGeminiInput] = useState("");
  const { showErr, showOk } = useToast();

  const refresh = async () => {
    const next = await invoke<AiSettingsPayload>("get_ai_settings");
    setSettings(next);
  };

  useEffect(() => {
    void refresh().catch((e) => showErr(`Could not load AI settings: ${String(e)}`));
  }, []);

  const updatePreset = async (preset: AiSettingsPayload["preset"]) => {
    setBusy(true);
    try {
      await invoke("set_ai_preset", { preset });
      await refresh();
      showOk("AI preset updated.");
    } catch (e) {
      showErr(`Failed to update AI preset: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateProvider = async (provider: AiSettingsPayload["provider"]) => {
    setBusy(true);
    try {
      await invoke("set_ai_provider", { provider });
      await refresh();
      showOk("AI provider updated.");
    } catch (e) {
      showErr(`Failed to update AI provider: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateTargetLanguage = async (language: string) => {
    setBusy(true);
    try {
      await invoke("set_ai_target_language", { language });
      await refresh();
      showOk("Target language updated.");
    } catch (e) {
      showErr(`Failed to update target language: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveOpenAiKey = async () => {
    setBusy(true);
    try {
      await invoke("set_openai_api_key", { token: openAiInput || null });
      setOpenAiInput("");
      await refresh();
      showOk("OpenAI key saved.");
    } catch (e) {
      showErr(`Failed to save OpenAI key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveGeminiKey = async () => {
    setBusy(true);
    try {
      await invoke("set_gemini_api_key", { token: geminiInput || null });
      setGeminiInput("");
      await refresh();
      showOk("Gemini key saved.");
    } catch (e) {
      showErr(`Failed to save Gemini key: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const preset = settings?.preset ?? "raw";
  const translationEnabled = preset === "translate" || preset === "clean_translate";

  return (
    <div className="wv-pane">
      <PaneHeader title="AI" subtitle="Optional transcript cleanup and translation before paste." />
      <SettingsSection title="Processing">
        <SettingsRow label="Preset" hint="Raw stays fully local. Other modes send transcript text to your selected provider.">
          <select className="wv-select" value={preset} onChange={(e) => void updatePreset(e.target.value as AiSettingsPayload["preset"])} disabled={busy}>
            <option value="raw">Raw</option>
            <option value="clean">Clean</option>
            <option value="translate">Translate</option>
            <option value="clean_translate">Clean + Translate</option>
          </select>
        </SettingsRow>
        <SettingsRow label="Provider" hint="Only used when preset is not Raw.">
          <select className="wv-select" value={settings?.provider ?? ""} onChange={(e) => void updateProvider((e.target.value || null) as AiSettingsPayload["provider"])} disabled={busy || preset === "raw"}>
            <option value="">Select provider</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </SettingsRow>
        {translationEnabled && (
          <SettingsRow label="Target language" hint="This is the language that will be pasted.">
            <select className="wv-select" value={settings?.target_language ?? ""} onChange={(e) => void updateTargetLanguage(e.target.value)} disabled={busy}>
              <option value="">Select language</option>
              <option value="English">English</option>
              <option value="Danish">Danish</option>
              <option value="German">German</option>
              <option value="French">French</option>
              <option value="Spanish">Spanish</option>
            </select>
          </SettingsRow>
        )}
        <SettingsRow label="Privacy" hint="AI presets send transcript text only. Audio stays local." last>
          <StatusBadge tone={preset === "raw" ? "ok" : "warn"}>
            {preset === "raw" ? "Local only" : "Transcript sent to provider"}
          </StatusBadge>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Provider keys">
        <SettingsRow label="OpenAI key" hint={settings?.openai_key ? `Saved: ${settings.openai_key}` : "No key saved yet."}>
          <div className="wv-inline wv-inline-stack">
            <input className="wv-input" type="password" value={openAiInput} onChange={(e) => setOpenAiInput(e.target.value)} placeholder="sk-..." />
            <Button onClick={() => void saveOpenAiKey()} disabled={busy}>Save</Button>
          </div>
        </SettingsRow>
        <SettingsRow label="Gemini key" hint={settings?.gemini_key ? `Saved: ${settings.gemini_key}` : "No key saved yet."} last>
          <div className="wv-inline wv-inline-stack">
            <input className="wv-input" type="password" value={geminiInput} onChange={(e) => setGeminiInput(e.target.value)} placeholder="AIza..." />
            <Button onClick={() => void saveGeminiKey()} disabled={busy}>Save</Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 4: Add missing imports for the new types**

At the top of `Settings.tsx`, update the type import:

```tsx
import type { AiSettingsPayload, HealthStatus, Page, ProviderRuntimeStatus, ShortcutStatus } from "./settingsTypes";
```

- [ ] **Step 5: Run frontend verification**

Run: `npx tsc --noEmit`

Expected: TypeScript passes with the new AI types and `AiTab` component.

- [ ] **Step 6: Run a production build verification**

Run: `npm run build`

Expected: Vite build succeeds and the settings window compiles with the new AI tab.

---

## Self-Review Checklist

Spec coverage:

- Optional and off-by-default AI behavior: Tasks 1, 3, 4, 5
- User-supplied OpenAI/Gemini API keys in keyring: Task 3
- `Raw`, `Clean`, `Translate`, `Clean + Translate` presets: Tasks 1, 5
- Fixed target language in Settings: Tasks 1, 3, 5
- Transcript-only provider calls, not audio: Tasks 2, 5
- Fallback to raw transcript on AI failure: Task 4

Placeholder scan:

- No `TODO`, `TBD`, or deferred implementation markers remain in the task steps.
- Every verification step includes an exact command.
- Every code-changing step includes the concrete code to add or replace.

Type consistency:

- Preset strings use `raw | clean | translate | clean_translate` consistently across Rust and TypeScript.
- Provider strings use `openai | gemini` consistently across Rust and TypeScript.
- `AiSettingsPayload` matches the backend `AiSettingsPayload` struct fields.
