use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{build_instruction, TransformError, TransformRequest};

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

#[derive(Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Deserialize)]
struct GeminiResponse {
    #[serde(rename = "promptFeedback")]
    prompt_feedback: Option<GeminiPromptFeedback>,
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
    content: Option<GeminiCandidateContent>,
}

#[derive(Deserialize)]
struct GeminiPromptFeedback {
    #[serde(rename = "blockReason")]
    block_reason: Option<String>,
}

#[derive(Deserialize)]
struct GeminiCandidateContent {
    parts: Option<Vec<GeminiCandidatePart>>,
}

#[derive(Deserialize)]
struct GeminiCandidatePart {
    text: Option<String>,
}

fn build_request<'a>(instruction: &'a str, transcript: &'a str) -> GeminiRequest<'a> {
    GeminiRequest {
        system_instruction: GeminiInstruction {
            parts: vec![GeminiPart { text: instruction }],
        },
        contents: vec![GeminiContent {
            parts: vec![GeminiPart { text: transcript }],
        }],
    }
}

fn http_error(status: reqwest::StatusCode, body: &str) -> TransformError {
    let body = body.trim();
    if body.is_empty() {
        TransformError::Http(format!("Gemini request failed with status {}", status))
    } else {
        TransformError::Http(format!(
            "Gemini request failed with status {}: {}",
            status, body
        ))
    }
}

fn parse_candidate_text(body: GeminiResponse) -> Result<String, TransformError> {
    if let Some(block_reason) = body
        .prompt_feedback
        .as_ref()
        .and_then(|feedback| feedback.block_reason.as_deref())
    {
        return Err(TransformError::InvalidResponse(format!(
            "Gemini prompt was blocked: {block_reason}"
        )));
    }

    if let Some(finish_reason) = body
        .candidates
        .as_ref()
        .into_iter()
        .flat_map(|candidates| candidates.iter())
        .filter_map(|candidate| candidate.finish_reason.as_deref())
        .find(|reason| !matches!(*reason, "STOP" | "FINISH_REASON_UNSPECIFIED"))
    {
        return Err(TransformError::InvalidResponse(format!(
            "Gemini candidate finished with {finish_reason}"
        )));
    }

    let text = body
        .candidates
        .unwrap_or_default()
        .into_iter()
        .flat_map(|candidate| candidate.content.into_iter())
        .flat_map(|content| content.parts.unwrap_or_default().into_iter())
        .filter_map(|part| part.text)
        .map(|text| text.trim().to_string())
        .find(|text| !text.is_empty());

    text.ok_or_else(|| TransformError::InvalidResponse("Gemini returned no text candidate".to_string()))
}

pub async fn transform(client: &Client, request: &TransformRequest) -> Result<String, TransformError> {
    let instruction = build_instruction(request);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        request.model.as_settings_value(),
        request.api_key
    );
    let payload = build_request(&instruction, &request.transcript);
    let payload = serde_json::to_vec(&payload)
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(payload)
        .send()
        .await
        .map_err(|e| TransformError::Http(e.to_string()))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    if !status.is_success() {
        return Err(http_error(status, &body));
    }
    let body: GeminiResponse = serde_json::from_str(&body)
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    parse_candidate_text(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_http_error_includes_trimmed_body_text() {
        let result = http_error(reqwest::StatusCode::FORBIDDEN, "  blocked  ");
        assert_eq!(
            result,
            TransformError::Http("Gemini request failed with status 403 Forbidden: blocked".to_string())
        );
    }

    #[test]
    fn gemini_http_error_omits_empty_body_text() {
        let result = http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, "   ");
        assert_eq!(
            result,
            TransformError::Http("Gemini request failed with status 429 Too Many Requests".to_string())
        );
    }

    #[test]
    fn gemini_request_serialization_contains_core_fields() {
        let payload = build_request("Translate this transcript.", "hej verden");
        let value = serde_json::to_value(&payload).unwrap();

        assert_eq!(value["systemInstruction"]["parts"][0]["text"], "Translate this transcript.");
        assert!(value.get("contents").is_some());
        assert_eq!(value["contents"][0]["parts"][0]["text"], "hej verden");
    }

    #[test]
    fn gemini_rejects_blocked_prompt_feedback() {
        let body: GeminiResponse = serde_json::from_str(
            r#"{
                "promptFeedback": {
                    "blockReason": "SAFETY"
                }
            }"#,
        )
        .unwrap();
        let result = parse_candidate_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse("Gemini prompt was blocked: SAFETY".to_string())
        );
    }

    #[test]
    fn gemini_rejects_max_tokens_candidate() {
        let body: GeminiResponse = serde_json::from_str(
            r#"{
                "candidates": [
                    {
                        "finishReason": "MAX_TOKENS",
                        "content": {
                            "parts": [
                                { "text": "Partial text" }
                            ]
                        }
                    }
                ]
            }"#,
        )
        .unwrap();
        let result = parse_candidate_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse("Gemini candidate finished with MAX_TOKENS".to_string())
        );
    }

    #[test]
    fn gemini_parsing_skips_whitespace_before_real_text() {
        let body = GeminiResponse {
            prompt_feedback: None,
            candidates: Some(vec![GeminiCandidate {
                finish_reason: None,
                content: Some(GeminiCandidateContent {
                    parts: Some(vec![
                        GeminiCandidatePart {
                            text: Some("   ".to_string()),
                        },
                        GeminiCandidatePart {
                            text: Some("Hello".to_string()),
                        },
                    ]),
                }),
            }]),
        };
        let text = parse_candidate_text(body).unwrap();
        assert_eq!(text, "Hello");
    }

    #[test]
    fn gemini_parsing_prefers_first_non_empty_text() {
        let body = GeminiResponse {
            prompt_feedback: None,
            candidates: Some(vec![GeminiCandidate {
                finish_reason: None,
                content: Some(GeminiCandidateContent {
                    parts: Some(vec![GeminiCandidatePart {
                        text: Some("Hello".to_string()),
                    }]),
                }),
            }]),
        };
        let text = parse_candidate_text(body).unwrap();
        assert_eq!(text, "Hello");
    }
}
