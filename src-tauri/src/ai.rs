use serde::{Deserialize, Serialize};

pub mod gemini;
pub mod openai;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiPreset {
    Raw,
    Clean,
    Professional,
    Translate,
    CleanTranslate,
}

impl AiPreset {
    pub fn from_settings_value(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "raw" => Some(Self::Raw),
            "clean" => Some(Self::Clean),
            "professional" => Some(Self::Professional),
            "translate" => Some(Self::Translate),
            "clean_translate" => Some(Self::CleanTranslate),
            _ => None,
        }
    }

    pub fn as_settings_value(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Clean => "clean",
            Self::Professional => "professional",
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
    #[serde(rename = "openai")]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiModel {
    #[serde(rename = "gpt-5-mini")]
    OpenAiGpt5Mini,
    #[serde(rename = "gpt-5-nano")]
    OpenAiGpt5Nano,
    #[serde(rename = "gpt-4.1-mini")]
    OpenAiGpt41Mini,
    #[serde(rename = "gemini-3-flash-preview")]
    Gemini3FlashPreview,
    #[serde(rename = "gemini-2.5-flash")]
    Gemini25Flash,
}

impl AiModel {
    pub fn from_settings_value(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "gpt-5-mini" => Some(Self::OpenAiGpt5Mini),
            "gpt-5-nano" => Some(Self::OpenAiGpt5Nano),
            "gpt-4.1-mini" => Some(Self::OpenAiGpt41Mini),
            "gemini-3-flash-preview" => Some(Self::Gemini3FlashPreview),
            "gemini-2.5-flash" => Some(Self::Gemini25Flash),
            _ => None,
        }
    }

    pub fn as_settings_value(self) -> &'static str {
        match self {
            Self::OpenAiGpt5Mini => "gpt-5-mini",
            Self::OpenAiGpt5Nano => "gpt-5-nano",
            Self::OpenAiGpt41Mini => "gpt-4.1-mini",
            Self::Gemini3FlashPreview => "gemini-3-flash-preview",
            Self::Gemini25Flash => "gemini-2.5-flash",
        }
    }

    pub fn provider(self) -> AiProvider {
        match self {
            Self::OpenAiGpt5Mini | Self::OpenAiGpt5Nano | Self::OpenAiGpt41Mini => {
                AiProvider::OpenAi
            }
            Self::Gemini3FlashPreview | Self::Gemini25Flash => AiProvider::Gemini,
        }
    }

    pub fn default_for_provider(provider: AiProvider) -> Self {
        match provider {
            AiProvider::OpenAi => Self::OpenAiGpt5Mini,
            AiProvider::Gemini => Self::Gemini3FlashPreview,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConfig {
    pub preset: AiPreset,
    pub provider: Option<AiProvider>,
    pub model: Option<AiModel>,
    pub target_language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformRequest {
    pub provider: AiProvider,
    pub model: AiModel,
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
    let model = config
        .model
        .filter(|model| model.provider() == provider)
        .unwrap_or_else(|| AiModel::default_for_provider(provider));
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
        model,
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
        AiPreset::Professional => format!(
            "{common} Rewrite the transcript in a polished, professional tone. Improve clarity, grammar, punctuation, and sentence flow. Keep the original language. Do not add new facts, remove important details, or make the text sound overly formal."
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

pub async fn transform_with_provider(
    client: &reqwest::Client,
    request: &TransformRequest,
) -> Result<String, TransformError> {
    match request.provider {
        AiProvider::OpenAi => openai::transform(client, request).await,
        AiProvider::Gemini => gemini::transform(client, request).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_preset_skips_transform() {
        let config = AiConfig {
            preset: AiPreset::Raw,
            provider: None,
            model: None,
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
            model: Some(AiModel::OpenAiGpt5Mini),
            target_language: None,
        };
        let err = validate_transform_input(&config, "hej verden", Some("sk-test")).unwrap_err();
        assert_eq!(err, TransformError::MissingTargetLanguage);
    }

    #[test]
    fn clean_translate_builds_expected_instruction() {
        let request = TransformRequest {
            provider: AiProvider::Gemini,
            model: AiModel::Gemini25Flash,
            preset: AiPreset::CleanTranslate,
            target_language: Some("English".to_string()),
            transcript: "uh hej verden".to_string(),
            api_key: "key".to_string(),
        };
        let instruction = build_instruction(&request);
        assert!(instruction.contains("Return only the final transformed text"));
        assert!(instruction.contains("translate the result into English"));
    }

    #[test]
    fn professional_tone_builds_expected_instruction() {
        let request = TransformRequest {
            provider: AiProvider::OpenAi,
            model: AiModel::OpenAiGpt5Mini,
            preset: AiPreset::Professional,
            target_language: None,
            transcript: "hey so i just wanted to say this thing".to_string(),
            api_key: "key".to_string(),
        };
        let instruction = build_instruction(&request);
        assert!(instruction.contains("polished, professional tone"));
        assert!(instruction.contains("Keep the original language"));
        assert!(instruction.contains("Do not add new facts"));
    }

    #[test]
    fn raw_builds_unchanged_instruction() {
        let request = TransformRequest {
            provider: AiProvider::OpenAi,
            model: AiModel::OpenAiGpt5Mini,
            preset: AiPreset::Raw,
            target_language: None,
            transcript: "hej verden".to_string(),
            api_key: "key".to_string(),
        };
        let instruction = build_instruction(&request);
        assert_eq!(instruction, "Return the transcript unchanged.");
    }

    #[test]
    fn translate_defaults_target_language_to_english() {
        let request = TransformRequest {
            provider: AiProvider::OpenAi,
            model: AiModel::OpenAiGpt5Mini,
            preset: AiPreset::Translate,
            target_language: None,
            transcript: "hej verden".to_string(),
            api_key: "key".to_string(),
        };
        let instruction = build_instruction(&request);
        assert!(instruction.contains("Translate the transcript into English."));
    }

    #[test]
    fn validate_transform_input_normalizes_valid_request() {
        let config = AiConfig {
            preset: AiPreset::CleanTranslate,
            provider: Some(AiProvider::Gemini),
            model: Some(AiModel::Gemini25Flash),
            target_language: Some("  English  ".to_string()),
        };
        let request = validate_transform_input(&config, "  uh hej verden  ", Some("  key-123  "))
            .unwrap()
            .unwrap();
        assert_eq!(request.provider, AiProvider::Gemini);
        assert_eq!(request.preset, AiPreset::CleanTranslate);
        assert_eq!(request.target_language.as_deref(), Some("English"));
        assert_eq!(request.transcript, "uh hej verden");
        assert_eq!(request.api_key, "key-123");
    }

    #[test]
    fn openai_provider_serde_uses_openai() {
        let serialized = serde_json::to_string(&AiProvider::OpenAi).unwrap();
        assert_eq!(serialized, "\"openai\"");

        let deserialized: AiProvider = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(deserialized, AiProvider::OpenAi);
    }

    #[test]
    fn missing_key_is_a_validation_error_for_clean_mode() {
        let config = AiConfig {
            preset: AiPreset::Clean,
            provider: Some(AiProvider::OpenAi),
            model: Some(AiModel::OpenAiGpt5Mini),
            target_language: None,
        };
        let err = validate_transform_input(&config, "uh hello", None).unwrap_err();
        assert_eq!(err, TransformError::MissingApiKey);
    }

    #[test]
    fn ai_model_validation_accepts_supported_values() {
        assert_eq!(
            AiModel::from_settings_value("gpt-5-mini"),
            Some(AiModel::OpenAiGpt5Mini)
        );
        assert_eq!(
            AiModel::from_settings_value("gemini-3-flash-preview"),
            Some(AiModel::Gemini3FlashPreview)
        );
        assert!(AiModel::from_settings_value("not-a-real-model").is_none());
    }

    #[test]
    fn ai_model_knows_own_provider() {
        assert_eq!(AiModel::OpenAiGpt5Mini.provider(), AiProvider::OpenAi);
        assert_eq!(AiModel::Gemini25Flash.provider(), AiProvider::Gemini);
    }

    #[test]
    fn validate_transform_input_uses_selected_model() {
        let config = AiConfig {
            preset: AiPreset::Clean,
            provider: Some(AiProvider::OpenAi),
            model: Some(AiModel::OpenAiGpt5Nano),
            target_language: None,
        };
        let request = validate_transform_input(&config, " hello ", Some(" key ")).unwrap().unwrap();

        assert_eq!(request.provider, AiProvider::OpenAi);
        assert_eq!(request.model, AiModel::OpenAiGpt5Nano);
        assert_eq!(request.preset, AiPreset::Clean);
    }
}
