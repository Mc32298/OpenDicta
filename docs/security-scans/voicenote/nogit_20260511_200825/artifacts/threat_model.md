# Threat Model

## Overview
VoiceNote is a local Tauri 2 desktop application for push-to-talk speech transcription. Runtime surfaces are the React webviews, the Tauri command bridge, global hotkey and microphone capture, local settings/model storage, model downloads from HuggingFace, and the native Rust ASR sidecar.

## Threat Model, Trust Boundaries, and Assumptions
Assets include local OS privileges of the signed desktop app, microphone audio, generated transcripts pasted into other apps, clipboard contents if exposed, HuggingFace tokens, app settings, downloaded ONNX model files, and the bundled worker executable. Trust boundaries are crossed between renderer JavaScript and Rust commands, between Rust host and sidecar stdin/stdout, between HTTPS model download source and local model storage, and between local app-generated text and the currently focused external application.

Attacker-controlled inputs are limited in the current codebase: URL query parameters select internal window/page/tab names and are normalized, user preferences are entered through local UI, audio comes from the user's microphone, and model bytes come from the remote model host or manual local placement. The app does not expose an HTTP server or remote multi-user API.

## Attack Surface, Mitigations, and Attacker Stories
Primary attack surfaces are Tauri permissions/capabilities, model download and parsing, stored settings, sidecar process spawning, and renderer event/invoke paths. React escapes rendered text by default, and no dangerous HTML sinks were found. The app uses HTTPS for model downloads and atomically renames temporary model files, but it does not authenticate model file contents. The Tauri capability grants shell spawn/kill and clipboard read permissions to the app windows, and CSP is disabled.

Realistic attacker stories are supply-chain compromise of model artifacts, compromised renderer content through a future XSS/dependency issue, or local malware/user tampering with app data. Out of scope: internet unauthenticated direct access, cross-tenant attacks, server-side auth bypass, SQL injection, SSRF to internal services, and web session theft.

## Severity Calibration (Critical, High, Medium, Low)
Critical/high issues would require credible code execution, privilege escalation, or serious sensitive data exfiltration from a realistic in-scope boundary. Medium issues include renderer compromise amplifiers, unverified trusted artifact download/parse paths, and exposure of desktop permissions that make a future renderer bug more damaging. Low issues include local plaintext storage of optional tokens or defense-in-depth configuration weaknesses without a current exploit path.
