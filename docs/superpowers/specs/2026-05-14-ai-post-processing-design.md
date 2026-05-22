# AI Post-Processing — Design Spec

## Context

VoiceNote V5 currently pastes raw ASR transcripts. Users often need the same post-editing actions repeatedly (fixing grammar, formatting as bullet points, drafting an email). This feature eliminates that manual step by letting users hold a different hotkey to record — each hotkey maps to an AI profile that reshapes the text automatically.

The "Prompt Profiles" empty-state pane already exists in the UI, confirming this is a planned feature.

## Goal

Add per-hotkey AI post-processing profiles. Each profile applies a system prompt to the raw transcript via a cloud or local LLM before pasting, with zero changes to the existing raw-recording flow.

## Architecture

New "AI" tab in Settings (8th tab). Hardcoded preset profiles stored in Rust, each with an optional assigned hotkey. After transcription, if the triggering hotkey matches a profile, the transcript is sent to the configured AI backend (OpenAI / Anthropic / Ollama) via `reqwest` and the AI result is pasted instead. Raw recording path is completely unchanged.

---

## Preset Profiles (hardcoded, not user-editable)

| ID | Display name | System prompt |
|----|-------------|---------------|
| `fix_grammar` | Fix Grammar | "Fix grammar and punctuation. Preserve meaning and tone. Return only the corrected text, no explanation." |
| `bullet_points` | Bullet Points | "Convert to a concise bulleted list. Return only the list, no preamble." |
| `email_draft` | Email Draft | "Format as a professional email with an appropriate greeting and closing. Return only the email." |
| `make_formal` | Make Formal | "Rewrite in formal, professional language. Return only the rewritten text." |
| `summarize` | Summarize | "Summarize in 1–2 sentences. Return only the summary." |

## Data Storage

| Field | Storage location |
|-------|-----------------|
| `ai_backend` — `"openai"` \| `"anthropic"` \| `"ollama"` | Settings JSON |
| `ai_model` — e.g. `"gpt-4o-mini"` | Settings JSON |
| `ai_ollama_url` — e.g. `"http://localhost:11434"` | Settings JSON |
| `profile_hotkeys` — `{ "fix_grammar": "RCtrl+1", … }` | Settings JSON |
| API key | OS keyring (`keyring` crate, same pattern as HF token) |

## UI — Settings AI Tab (Layout A)

- **AI Backend section** (top): Provider dropdown (OpenAI / Anthropic / Ollama), masked API key field, model field (or Ollama URL + model for local)
- **Profiles section** (below): 5 rows, each showing profile name + hotkey chip (green dot = assigned, gray = unset). Clicking a chip enters capture mode.

## VoiceBar Changes (minimal)

- Profile badge (`✦ Fix Grammar`) floats below pill during recording — no pill layout changes
- "Applying AI…" reuses the existing `sidecar-status` event + dot-loader — no new VoiceBar state machine states
- Done state shows AI result preview (same 64-char truncation as today)
- Error fallback: raw transcript still pastes; non-blocking toast fires

## Hotkey Model

- Profile hotkeys registered via the existing `register_hotkey` / `unregister_hotkey` path
- Guard: reject any profile hotkey that equals the main recording shortcut
- Guard: reject duplicate profile hotkeys (one hotkey → one profile)
- `active_profile: Mutex<Option<String>>` in `SharedState` — set when profile hotkey fires, cleared after paste

## New Tauri Commands

| Command | Description |
|---------|-------------|
| `get_ai_settings()` | Returns backend, model, masked key, ollama URL, profile hotkey map |
| `set_ai_backend(backend)` | Allowlist: openai / anthropic / ollama |
| `set_ai_api_key(key)` | Writes to OS keyring |
| `set_ai_model(model)` | Max 64 chars |
| `set_ai_ollama_url(url)` | Must start with http:// or https:// |
| `set_profile_hotkey(profile_id, hotkey?)` | Validates profile_id; None clears |
| `get_profiles()` | Returns hardcoded list with assigned hotkeys |

## Known Implementation Challenge: Hotkey Press/Release

Hold-to-record needs both keydown and keyup. Tauri's global shortcut plugin only fires on press. The codebase already solves this for RightCtrl via a native Windows polling thread (`GetAsyncKeyState`).

**Recommended approach for profile hotkeys:** Start with toggle mode (press once = start, press again = stop) using the Tauri global shortcut plugin. Upgrade to hold-to-record (Option A: extend native polling thread) once the feature is end-to-end working.
