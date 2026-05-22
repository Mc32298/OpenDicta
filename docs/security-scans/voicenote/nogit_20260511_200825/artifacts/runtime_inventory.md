# Runtime Inventory

- React webviews: `src/App.tsx`, `src/windows/VoiceBar.tsx`, `src/windows/Settings.tsx`, `src/windows/Onboarding.tsx`, `src/windows/EmptyStates.tsx`.
- Tauri command bridge and privileged host logic: `src-tauri/src/lib.rs`.
- Tauri capabilities/config: `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.bundle.conf.json`.
- Native ASR sidecar: `worker/src/main.rs`, `worker/src/model.rs`, `worker/src/audio.rs`.
- Build/dev scripts: `scripts/copy-worker.mjs`, `scripts/dev-cuda.ps1`, `scripts/control-audit-check.mjs`.

Security-sensitive sinks and controls:
- Tauri capabilities grant core window commands, global shortcut registration, clipboard write/read, autostart enable/disable, and shell spawn/kill.
- CSP is disabled in Tauri config.
- `download_model` downloads four model files from HuggingFace and saves them by name under app data.
- `worker_binary_path` locates and spawns the sidecar; `spawn_sidecar` passes environment variables and pipes stdin/stdout.
- Settings persist `hf_token` in `settings.json` and expose getter/setter commands.
- Sidecar parses local WAV paths received over stdin and loads ONNX model files via sherpa-onnx.
