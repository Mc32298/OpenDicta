# Validation Report

## Rubric
- [x] Identify source, sink, and trust boundary.
- [x] Check whether current code already has a reachable direct exploit path.
- [x] Check whether controls are absent or merely defense-in-depth.
- [x] Calibrate impact for a local desktop app with no network server.
- [x] Record counterevidence and proof gaps.

## Closure Table

| Row | Instance key | Root control | Entrypoint/source | Sink/control | Disposition | Counterevidence or proof gap | Survives |
|---|---|---|---|---|---|---|---|
| RW-001 | `privilege-boundary:src-tauri/capabilities/default.json:20` | `src-tauri/capabilities/default.json:15-21`, `src-tauri/tauri.conf.json:33` | compromised renderer | shell spawn/kill, clipboard read, disabled CSP | reportable | No current XSS found; issue is a privilege-amplifying configuration if renderer content is compromised. | yes |
| RW-002 | `supply-chain:src-tauri/src/lib.rs:538` | `src-tauri/src/lib.rs:538`, `src-tauri/src/lib.rs:605`, `src-tauri/src/lib.rs:637` | remote model bytes | native ONNX model load in worker | reportable | HTTPS limits network MITM, but repository/CDN/account compromise and absence of pinned integrity remain. | yes |
| RW-003 | `secret-handling:src-tauri/src/lib.rs:380` | `src-tauri/src/lib.rs:380-394`, `src-tauri/src/lib.rs:884-898` | local UI / renderer | plaintext settings JSON, getter command | reportable | Requires token use and local/renderer compromise; severity is low. | yes |
| RW-004 | `xss-routing:src/App.tsx:18` | `src/App.tsx:18`, `src/windows/Settings.tsx:31`, `src/windows/EmptyStates.tsx:31` | URL query params | component/page/tab selection | suppressed | Inputs are normalized to enums/defaults; React escapes output; no `dangerouslySetInnerHTML` found. | no |
| RW-005 | `path-worker:worker/src/main.rs:83` | `worker/src/main.rs:83` | worker stdin | WAV file open | suppressed | Stdin is private to Rust host; no renderer command lets arbitrary users send file paths. | no |
| RW-006 | `rust-advisory:Cargo.lock` | `Cargo.lock` | lockfile | cargo advisory DB | deferred | `cargo audit` is not installed. | uncertain |
| RW-007 | `npm-advisory:package-lock.json` | `package-lock.json` | lockfile | npm advisory DB | suppressed | `npm audit --omit=dev --json` returned zero production vulnerabilities. | no |

## Candidate Validation

### CAND-001
Confidence: medium. Method: code tracing and capability inspection. The app grants shell spawn/kill and clipboard read to both windows while CSP is null. The current frontend does not use shell APIs and no HTML injection sink was found, so this is not a standalone RCE today. It survives as a meaningful hardening issue because any renderer compromise would inherit unnecessary desktop capabilities.

### CAND-002
Confidence: medium-high. Method: code tracing. `download_model` accepts successful HTTPS responses, writes them to `.tmp`, and renames to final names. Existing size checks only skip apparently complete files and do not prove authenticity. Worker model loading uses the files directly through sherpa-onnx. No hash, signature, manifest, or pinned release verification was found.

### CAND-003
Confidence: high. Method: code tracing. `set_hf_token` writes the token into shared state; `save_app_settings` serializes it into normal JSON settings; `get_hf_token` returns it to the renderer. This is real but low severity because the token is optional and the primary attack precondition is local config access or renderer compromise.
