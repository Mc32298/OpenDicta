import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const files = {
  voicebar: read("src/windows/VoiceBar.tsx"),
  settings: read("src/windows/Settings.tsx"),
  tauri: read("src-tauri/src/lib.rs"),
  audit: read("docs/superpowers/control-audit/2026-05-11-voicenote-ui-controls.md"),
};

const checks = [
  {
    name: "voicebar stop action invokes stop_recording",
    pass:
      files.voicebar.includes('function handleStop()') &&
      files.voicebar.includes('invoke("stop_recording")') &&
      files.voicebar.includes('label="Stop recording"'),
  },
  {
    name: "voicebar stop transition listens for recording-stopped and enters processing",
    pass:
      files.voicebar.includes('listen("recording-stopped"') &&
      files.voicebar.includes('setState("processing")') &&
      files.voicebar.includes('setStatusText("Transcribing…")'),
  },
  {
    name: "voicebar cancel action invokes cancel_recording and shows cancelled state",
    pass:
      files.voicebar.includes('invoke("cancel_recording")') &&
      files.voicebar.includes('setState("cancelled")') &&
      files.voicebar.includes('setStatusText("Cancelled")'),
  },
  {
    name: "voicebar dismiss path hides and resets to idle",
    pass:
      files.voicebar.includes("function hideAndReset()") &&
      files.voicebar.includes('setState("idle")') &&
      files.voicebar.includes('setStatusText("Ready")') &&
      files.voicebar.includes('setVisible(false)') &&
      files.voicebar.includes("setLastError(null)"),
  },
  {
    name: "voicebar error recovery opens diagnostics",
    pass:
      files.voicebar.includes("GearIcon") &&
      files.voicebar.includes("open_settings_page_command") &&
      files.voicebar.includes("Open diagnostics"),
  },
  {
    name: "backend exposes settings page command",
    pass:
      files.tauri.includes("async fn open_settings_page_command") &&
      files.tauri.includes("open_settings_page_command,"),
  },
  {
    name: "backend exposes reset voicebar position command",
    pass:
      files.tauri.includes("async fn reset_voicebar_position") &&
      files.tauri.includes("save_voicebar_position(&app, None)") &&
      files.tauri.includes("reset_voicebar_position,"),
  },
  {
    name: "backend exposes microphone test command",
    pass:
      files.tauri.includes("struct MicrophoneTestResult") &&
      files.tauri.includes("async fn test_microphone") &&
      files.tauri.includes("test_microphone,"),
  },
  {
    name: "settings includes microphone test control",
    pass:
      files.settings.includes("test_microphone") &&
      files.settings.includes("Test Microphone"),
  },
  {
    name: "settings includes voicebar position reset control",
    pass:
      files.settings.includes("reset_voicebar_position") &&
      files.settings.includes("Reset Position"),
  },
  {
    name: "audit tracks newly real controls",
    pass:
      files.audit.includes("Microphone test invokes `test_microphone`") &&
      files.audit.includes("Reset voicebar position invokes `reset_voicebar_position`"),
  },
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
