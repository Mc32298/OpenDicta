# Repository Coverage Ledger

| Row | Boundary | Area | Family | Source / boundary | Sink / control | Disposition | Evidence |
|---|---|---|---|---|---|---|---|
| RW-001 | Renderer to Tauri host | Tauri capabilities and CSP | Privilege boundary / command execution amplifier | Any compromised renderer in windows listed in capability | `shell:allow-spawn`, `shell:allow-kill`, clipboard read, `csp: null` | reportable | Capability lines 15-21 expose shell/clipboard commands; config line 33 disables CSP. |
| RW-002 | Remote model host to native parser | Model download and worker model load | Supply-chain trusted artifact parsing | HuggingFace model files downloaded by app | ONNX files saved without checksum/signature and later loaded by sherpa-onnx | reportable | `download_model` writes remote bytes; `model.rs` loads files from model dir. |
| RW-003 | Renderer/settings to local config | HuggingFace token setting | Secret handling | Optional user-entered token | Plain JSON config and `get_hf_token` command | reportable-low | Token is persisted and returned to renderer; no encryption/secret store. |
| RW-004 | Renderer query params | Window/page/tab selection | XSS / route injection | `window.location.search` | React render selection, normalized aliases | suppressed | Values only choose internal components/pages/tabs; React escapes text; no dangerous HTML sink found. |
| RW-005 | Worker stdin | WAV path processing | Path traversal / arbitrary file read | Host sends temp WAV path over private stdin pipe | Worker opens provided path | suppressed | Private child stdin is controlled by Rust host; no renderer command accepts arbitrary WAV path. |
| RW-006 | Rust dependencies | Cargo crates | Known vulnerable dependencies | Manifest/lockfile | Rust advisory DB | deferred | `cargo audit` is not installed in this environment. |
| RW-007 | NPM production dependencies | React/Tauri JS deps | Known vulnerable dependencies | `package-lock.json` | npm advisory DB | suppressed | `npm audit --omit=dev --json` reported zero vulnerabilities. |
