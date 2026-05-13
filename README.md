# VoiceNote

> Push-to-talk speech-to-text. Hold the hotkey, speak, release — text is pasted automatically.

Built with **Tauri 2.0** (Rust + React) and **NVIDIA Parakeet TDT 0.6B v3** (via sherpa-onnx / ONNX Runtime). No Python required.

**Idle RAM: ~150 MB** — the worker process is killed when idle and respawned on demand.

---

## Prerequisites

- **Rust 1.77+** — [rustup.rs](https://rustup.rs)
- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Windows only:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- **macOS only:** `xcode-select --install`

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Download the ASR model
Launch the app once — it will open Settings → Model automatically and prompt you to download the model (~280 MB total, four INT8 ONNX files from HuggingFace).

Or place the files manually in:
- **Windows:** `%APPDATA%\VoiceNote\models\parakeet\`
- **macOS/Linux:** `~/.local/share/VoiceNote/models/parakeet/`

Required files: `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt`

---

## Development

```bash
npm run tauri:dev
```

This builds the worker binary, then starts Vite (frontend hot-reload) + Tauri simultaneously.

---

## Building for distribution

```bash
npm run tauri:build
```

This:
1. Compiles `voicenote-worker` in release mode
2. Copies the binary with the correct target-triple suffix into `src-tauri/binaries/`
3. Runs `cargo tauri build` with the bundle config (NSIS installer on Windows)

Output: `src-tauri/target/release/bundle/`

---

## Project structure

```
voicenote/
├── src/                        # React frontend
│   ├── App.tsx                 # Window router (?window= param)
│   ├── styles.css              # Global dark styles
│   ├── components/
│   │   └── Waveform.tsx        # Animated waveform
│   └── windows/
│       ├── VoiceBar.tsx        # Recording pill UI
│       └── Settings.tsx        # Settings window
│
├── src-tauri/                  # Tauri host (Rust)
│   ├── src/lib.rs              # Tray, hotkey, audio, worker IPC, paste
│   ├── capabilities/
│   │   └── default.json        # Tauri 2.0 permissions
│   ├── tauri.conf.json         # App config (dev)
│   └── tauri.bundle.conf.json  # Bundle overrides (production)
│
├── worker/                     # Native ASR sidecar (Rust)
│   ├── src/main.rs             # stdin/stdout protocol loop
│   ├── src/model.rs            # sherpa-onnx Parakeet loader
│   └── src/audio.rs            # WAV read + resample to 16kHz mono
│
└── scripts/
    └── copy-worker.mjs         # Copies worker binary for bundling
```

---

## How it works

1. **Record** — `cpal` captures mic audio while the hotkey is held
2. **Save** — PCM is written to a temp WAV via `hound`
3. **Transcribe** — WAV path is sent to `voicenote-worker` via stdin; the worker runs Parakeet TDT INT8 through ONNX Runtime and returns a `TRANSCRIPT:` line on stdout
4. **Paste** — `enigo` types the transcript into the focused application
5. **Idle** — after the configured timeout the worker process is killed; the OS fully reclaims its RAM (~200 MB). It respawns automatically on the next hotkey press.

---

## GPU acceleration

Set the ONNX provider in **Settings → Model → GPU Provider**:
- `cpu` — default, works everywhere
- `directml` — Windows generic GPU (AMD, Intel, NVIDIA)
- `cuda` — NVIDIA only, requires CUDA toolkit
