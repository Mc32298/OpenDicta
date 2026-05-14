use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{build_instruction, TransformError, TransformRequest};

const OPENAI_URL: &str = "https://api.openai.com/v1/responses";

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
    status: Option<String>,
    output: Option<Vec<OpenAiOutputItem>>,
}

#[derive(Deserialize)]
struct OpenAiOutputItem {
    content: Option<Vec<OpenAiOutputContent>>,
}

#[derive(Deserialize)]
struct OpenAiOutputContent {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

fn is_complete_status(status: &str) -> bool {
    matches!(status, "completed" | "complete" | "succeeded" | "success")
}

fn build_request<'a>(instruction: &'a str, transcript: &'a str) -> OpenAiRequest<'a> {
    OpenAiRequest {
        model: "gpt-5-mini",
        input: vec![
            OpenAiInput {
                role: "system",
                content: vec![OpenAiContent {
                    kind: "input_text",
                    text: instruction,
                }],
            },
            OpenAiInput {
                role: "user",
                content: vec![OpenAiContent {
                    kind: "input_text",
                    text: transcript,
                }],
            },
        ],
    }
}

fn http_error(status: reqwest::StatusCode, body: &str) -> TransformError {
    let body = body.trim();
    if body.is_empty() {
        TransformError::Http(format!("OpenAI request failed with status {}", status))
    } else {
        TransformError::Http(format!(
            "OpenAI request failed with status {}: {}",
            status, body
        ))
    }
}

fn parse_output_text(body: OpenAiResponse) -> Result<String, TransformError> {
    if let Some(status) = body.status.as_deref() {
        if !is_complete_status(status) {
            return Err(TransformError::InvalidResponse(format!(
                "OpenAI returned non-complete status: {status}"
            )));
        }
    }

    if let Some(text) = body
        .output_text
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
    {
        return Ok(text);
    }

    if let Some(text) = body
        .output
        .unwrap_or_default()
        .into_iter()
        .flat_map(|item| item.content.unwrap_or_default().into_iter())
        .filter(|content| content.kind.as_deref() == Some("output_text"))
        .filter_map(|content| content.text)
        .map(|text| text.trim().to_string())
        .find(|text| !text.is_empty())
    {
        return Ok(text);
    }

    if let Some(status) = body.status {
        return Err(TransformError::InvalidResponse(format!(
            "OpenAI returned no usable text in a {status} response"
        )));
    }

    Err(TransformError::InvalidResponse(
        "OpenAI returned no usable text".to_string(),
    ))
}

pub async fn transform(client: &Client, request: &TransformRequest) -> Result<String, TransformError> {
    let instruction = build_instruction(request);
    let mut payload = build_request(&instruction, &request.transcript);
    payload.model = request.model.as_settings_value();
    let payload = serde_json::to_vec(&payload)
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    let response = client
        .post(OPENAI_URL)
        .bearer_auth(&request.api_key)
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
    let body: OpenAiResponse = serde_json::from_str(&body)
        .map_err(|e| TransformError::InvalidResponse(e.to_string()))?;
    parse_output_text(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_http_error_includes_trimmed_body_text() {
        let result = http_error(reqwest::StatusCode::BAD_REQUEST, "  bad payload  ");
        assert_eq!(
            result,
            TransformError::Http("OpenAI request failed with status 400 Bad Request: bad payload".to_string())
        );
    }

    #[test]
    fn openai_http_error_omits_empty_body_text() {
        let result = http_error(reqwest::StatusCode::UNAUTHORIZED, "   ");
        assert_eq!(
            result,
            TransformError::Http("OpenAI request failed with status 401 Unauthorized".to_string())
        );
    }

    #[test]
    fn openai_request_serialization_contains_core_fields() {
        let payload = build_request("Clean this transcript.", "hello world");
        let value = serde_json::to_value(&payload).unwrap();

        assert_eq!(value["model"], "gpt-5-mini");
        assert_eq!(value["input"][0]["role"], "system");
        assert_eq!(value["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(value["input"][0]["content"][0]["text"], "Clean this transcript.");
        assert_eq!(value["input"][1]["role"], "user");
        assert_eq!(value["input"][1]["content"][0]["type"], "input_text");
        assert_eq!(value["input"][1]["content"][0]["text"], "hello world");
    }

    #[test]
    fn openai_response_falls_back_to_output_array() {
        let body: OpenAiResponse = serde_json::from_str(
            r#"{
                "output": [
                    {
                        "content": [
                            { "type": "output_text", "text": "  Hello from fallback  " }
                        ]
                    }
                ]
            }"#,
        )
        .unwrap();
        let result = parse_output_text(body).unwrap();
        assert_eq!(result, "Hello from fallback");
    }

    #[test]
    fn openai_response_ignores_non_output_text_fallback_items() {
        let body: OpenAiResponse = serde_json::from_str(
            r#"{
                "output": [
                    {
                        "content": [
                            { "type": "refusal", "text": "Should not count" }
                        ]
                    }
                ]
            }"#,
        )
        .unwrap();
        let result = parse_output_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse("OpenAI returned no usable text".to_string())
        );
    }

    #[test]
    fn openai_response_rejects_incomplete_status_even_with_text() {
        let body: OpenAiResponse = serde_json::from_str(
            r#"{
                "status": "incomplete",
                "output_text": "Hello anyway"
            }"#,
        )
        .unwrap();
        let result = parse_output_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse(
                "OpenAI returned non-complete status: incomplete".to_string()
            )
        );
    }

    #[test]
    fn openai_response_rejects_empty_output() {
        let body = OpenAiResponse {
            output_text: Some("   ".to_string()),
            status: None,
            output: None,
        };
        let result = parse_output_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse("OpenAI returned no usable text".to_string())
        );
    }

    #[test]
    fn openai_response_rejects_failed_or_incomplete_output_without_text() {
        let body: OpenAiResponse = serde_json::from_str(
            r#"{
                "status": "incomplete",
                "output": [
                    {
                        "content": [
                            { "type": "output_text", "text": "   " }
                        ]
                    }
                ]
            }"#,
        )
        .unwrap();
        let result = parse_output_text(body);
        assert_eq!(
            result.unwrap_err(),
            TransformError::InvalidResponse("OpenAI returned non-complete status: incomplete".to_string())
        );
    }
}
