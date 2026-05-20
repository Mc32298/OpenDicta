# OpenDicta 🎙️

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-FFDD00.svg)](https://www.buymeacoffee.com/SPINOP)

**Speak *Freely*. Stay In Control.**

OpenDicta is a free, open-source speech-to-text app built with Tauri and Rust. It runs completely offline on your device, keeps your voice private, and types directly into any focused text field. Optional AI features are available only when you explicitly choose to use them.

## ✨ Features

* **100% Local & Offline**: A local ASR engine (`whisper-local`) handles transcription on your CPU with roughly 0.21s latency. No audio is ever uploaded.
* **Types Anywhere**: Press your shortcut in any browser, IDE, terminal, or chat. OpenDicta types straight into the active text field (tested on 60+ apps).
* **25 Supported Languages**: Speak in English, Danish, German, Spanish, French, and 20 other European languages.
* **Cross-Platform**: Available for Windows (10/11), macOS (12+ Apple Silicon and Intel), and major Linux distros.
* **Privacy First**: No telemetry, no account needed, and no subscriptions. Audio buffers live only in RAM and are discarded immediately.
* **Optional AI Polish**: Plug in your own API key (Anthropic, OpenAI, Gemini, or a local LLM endpoint) to format, summarise, clean up tone, or translate your text. Traffic flows directly from your machine to the provider—we never proxy your traffic.

## 🛠️ Use Cases

* **Developers**: Dictate PR descriptions and commit messages straight into your terminal or IDE without proprietary code touching the cloud.
* **IT Support**: Turn long spoken explanations into polite, structured ticket responses.
* **Students**: Transcribe lectures on-device with zero internet connection required.
* **Freelancers & Writers**: Draft notes, emails, and scope docs at the speed of thought while keeping your personal writing cadence.

## 🚀 Getting Started

*OpenDicta is currently in Beta. [Join the waitlist](https://www.opendicta.spinop.com/) for v1.0 early access.*

### Prerequisites (for building from source)
- Rust
- Node.js / npm
- Tauri CLI

*(Installation instructions and build commands will be added upon the v1.0 release)*

## 🧠 Optional AI Configuration

OpenDicta is powerful out of the box, but you can enhance your transcripts using an LLM of your choice:
1. Open **Settings**.
2. Paste your preferred API key or local LLM endpoint.
3. Configure custom shortcuts for specific AI workflows:
   * **Format**: Turn rambles into structured headings and bullet points.
   * **Summarise**: Condense long transcripts into decisions and action items.
   * **Tone Cleanup**: Strip filler words and verbal tics.
   * **Translate**: Dictate in one language and instantly output text in another.

## 🤝 Contributing

OpenDicta started as a small, opinionated script and grew into a privacy-respecting tool. We welcome forks, audits, and code contributions! The local app, the model-downloader, and the workflow runtime all live in this repository.

## ☕ Support the Project

OpenDicta is 100% free forever—no paywalls, no pro tiers, and no upsells. The project stays alive through donations and partners. If you find this tool invisible and essential, consider supporting us:
* [Buy us a coffee](https://www.buymeacoffee.com/SPINOP)
* [Become a partner](mailto:info@spinop.com)

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---
*Made quietly in Denmark.*
