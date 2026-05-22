# VoiceNote V5 — Optional AI Post-Processing Design

**Date:** 2026-05-13
**Scope:** Add optional AI cleanup and translation on top of the existing local-first transcription flow, with user-supplied OpenAI or Gemini API keys.

---

## Overview

VoiceNote should remain fully usable without any cloud dependency. The current local recording and transcription path stays intact and remains the default behavior. A new optional AI post-processing stage will run in the Tauri Rust host after the local transcript returns and before text is pasted into the target application.

This design adds four user-facing output presets:

- `Raw`
- `Clean`
- `Translate`
- `Clean + Translate`

`Raw` remains the default. The other presets require the user to opt in, choose a provider, configure an API key, and, for translation presets, select a target language.

---

## Goals

- Preserve the current local-first experience and keep it off by default.
- Allow users to supply their own OpenAI or Gemini API key.
- Support filler-word removal and transcript cleanup without changing the core meaning.
- Support translation from whatever language the user speaks into one configured target language.
- Ensure failures in the AI stage do not lose the transcript or block paste indefinitely.

## Non-Goals

- No cloud audio upload in v1.
- No replacement of the current local worker or model pipeline.
- No free-form custom prompt editing in v1.
- No per-recording modal or chooser before paste.
- No attempt to guarantee perfect language detection in the local model; AI refinement only works on the transcript text that already came back.

---

## Current Architecture

Today the app records audio, saves a temporary WAV, sends the WAV path to the Rust worker, receives a `TRANSCRIPT:` line on stdout, and immediately pastes the transcript. Settings already live in the Rust host, and Hugging Face token storage already uses the OS keyring.

That makes the Rust host the correct place for the new feature because it already owns:

- settings persistence
- secrets storage
- provider-independent orchestration
- the final paste decision

The worker remains transcription-only.

---

## Proposed Architecture

### Pipeline

The new pipeline becomes:

1. Record audio locally
2. Transcribe locally with the existing worker
3. Receive transcript in `src-tauri/src/lib.rs`
4. Decide whether AI post-processing is enabled
5. If disabled, paste the raw transcript immediately
6. If enabled, send transcript text to the selected provider
7. Receive transformed text
8. Paste the transformed text
9. If provider processing fails, fall back to the raw transcript and surface a non-blocking error

### Ownership Boundaries

- `worker/`: local STT only, no network behavior
- `src-tauri/src/lib.rs`: orchestration, settings, keyring access, provider calls, fallback logic, paste
- `src/windows/Settings.tsx`: new AI settings UI
- `src/windows/settingsTypes.ts`: new frontend types for AI settings and status

### Why Rust Host Instead of Frontend

- API keys stay out of the renderer process
- Existing keyring pattern can be reused
- The paste pipeline stays centralized
- Provider failures can be handled before paste without cross-window coordination

---

## User Experience

### Defaults

- AI features are off by default
- Preset defaults to `Raw`
- No provider is selected until the user enables an AI preset
- No transcript text leaves the machine unless the user explicitly enables an AI preset

### Settings Surface

Add a new `AI` section or tab in Settings with:

- `Preset`: `Raw`, `Clean`, `Translate`, `Clean + Translate`
- `Provider`: `OpenAI` or `Gemini`
- `Target language`: shown for translation presets only
- `OpenAI API key`: masked, stored in keyring
- `Gemini API key`: masked, stored in keyring
- `Model`: optional v1 field if needed for provider-specific defaults, otherwise hidden and hardcoded in backend
- Privacy note: `AI presets send transcript text, not audio, to the selected provider`

### Preset Semantics

- `Raw`: paste transcript exactly as returned by the local model
- `Clean`: remove filler words such as `uh`, `um`, `uhm`, remove obvious false starts and repeated fragments, normalize punctuation, preserve language and meaning
- `Translate`: translate the transcript into the configured target language, preserve meaning, do not summarize
- `Clean + Translate`: first clean semantically, then translate into the configured target language

### Failure UX

If AI processing fails:

- paste the raw local transcript
- emit a toast or lightweight status event explaining that AI refinement failed
- do not discard the user’s recording result

This fallback is the default behavior because dropping text is worse than pasting an unrefined transcript.

---

## Settings and Secret Storage

### Persisted App Settings

Add new non-secret settings to the Rust settings file model:

- `ai_preset`
- `ai_provider`
- `ai_target_language`

Secrets must not be written to `settings.json`.

### Keyring Entries

Add separate keyring entries for:

- OpenAI API key
- Gemini API key

This should follow the same migration-safe pattern already used for the Hugging Face token:

- load from keyring on startup
- expose masked getter commands to the frontend
- write and delete through Tauri commands only

---

## Backend Design

### New Rust Types

Add enums or validated string settings for:

- AI preset
- AI provider

Add a backend request struct representing:

- provider
- preset
- target language
- transcript text

### New Tauri Commands

Add commands to:

- get AI settings
- set AI preset
- set AI provider
- get AI target language
- set AI target language
- get masked OpenAI key
- set OpenAI key
- get masked Gemini key
- set Gemini key

The frontend should not build raw provider requests itself. It should only read and write settings.

### Post-Processing Hook

The AI stage should be inserted where `TRANSCRIPT:` is currently handled before `paste_text(...)` runs.

The flow should become:

1. receive raw transcript from the worker
2. load current AI settings from shared state
3. if preset is `Raw`, paste raw transcript
4. otherwise validate:
   - provider exists
   - provider key exists
   - target language exists when required
5. call provider adapter with transcript text
6. if success, paste transformed text
7. if failure, paste raw transcript and emit an error event

### Network Client

Use a Rust HTTP client in the Tauri host for provider calls. The implementation should be provider-adapter based so OpenAI and Gemini are isolated behind the same internal interface.

Suggested shape:

- `transform_transcript(request) -> Result<String, TransformError>`
- `OpenAiAdapter`
- `GeminiAdapter`

This keeps provider-specific endpoints, payload formats, and response parsing out of the hotkey and worker orchestration code.

---

## Provider Behavior

### OpenAI

Send transcript text to a text-generation API with a strict instruction to return only the final transformed text. No markdown, explanation, or labels.

### Gemini

Send the same normalized internal request to Gemini through a separate adapter with the same contract: return only the final transformed text.

### Provider Model Selection

V1 will not expose provider model selection in the UI. Each adapter should use one backend-defined default model so the first release keeps the settings surface small and predictable.

### Prompt Contract

The backend should generate instructions from preset + target language, not store editable prompts in v1.

Required constraints:

- preserve meaning
- do not summarize unless a future preset explicitly asks for it
- do not add commentary
- return only the transformed text
- keep names, numbers, and key details intact when possible

---

## Error Handling

The backend must handle these cases explicitly:

- no provider selected
- selected provider missing API key
- translation preset missing target language
- provider timeout
- provider rate limit
- provider returns empty or malformed output
- network unavailable

Result policy:

- log the backend error
- emit an event for UI feedback
- paste raw transcript as fallback

The only case that should avoid paste entirely is when the raw transcript itself is empty.

---

## Privacy and Trust Model

VoiceNote needs a clear privacy distinction:

- `Raw` mode: local audio and local transcript only
- AI modes: transcript text is sent to the selected provider, but audio is not

The settings UI should state that clearly near the AI controls. This is important because the app is currently positioned as local-first.

---

## Testing Strategy

### Backend Tests

- setting validation for preset/provider/target language combinations
- request-building tests for each preset
- response parsing tests for OpenAI and Gemini adapters
- fallback tests proving that provider errors still return raw transcript for paste
- keyring command tests where practical

### Frontend Tests

- AI settings UI shows and hides fields correctly by preset
- masked key status renders correctly
- invalid combinations are blocked or explained

### Manual Verification

- `Raw` still pastes instantly with no network dependency
- `Clean` removes filler words but preserves language
- `Translate` converts mixed-language input into the configured target language
- `Clean + Translate` performs both steps
- missing key falls back to raw transcript with UI warning
- provider outage falls back to raw transcript with UI warning

---

## Implementation Plan Shape

Implementation should be split into four passes:

1. Backend settings and keyring support
2. AI settings UI in React
3. Provider adapter layer in Rust
4. Transcript post-processing integration and fallback tests

This keeps risk low because each pass can be verified independently before the paste path changes.

---

## Open Questions Resolved

- AI is off by default: yes
- AI runs in Rust host: yes
- v1 uses presets instead of custom prompts: yes
- target language is fixed in Settings, not chosen per paste: yes
- user may speak any source language; translation targets a configured output language: yes
- AI failure falls back to raw transcript: yes

---

## Files Likely To Change

- `src-tauri/src/lib.rs`
- `src/windows/Settings.tsx`
- `src/windows/settingsTypes.ts`
- `src/ui/controls.tsx` if existing controls need small extensions
- `src-tauri/Cargo.toml` for any new HTTP dependency

Possible new files:

- `src-tauri/src/ai.rs`
- `src-tauri/src/ai/openai.rs`
- `src-tauri/src/ai/gemini.rs`

---

## Acceptance Criteria

- The app behaves exactly as it does today when preset is `Raw`
- Users can store their own OpenAI or Gemini API key securely
- Users can choose `Clean`, `Translate`, or `Clean + Translate`
- Translation uses one configured target language
- AI modes send transcript text only, not audio
- Provider failures do not lose the transcript and do not block paste indefinitely
