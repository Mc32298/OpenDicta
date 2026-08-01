import { execSync } from "child_process";

const script =
  process.platform === "win32"
    ? "tauri:build:windows"
    : process.platform === "linux"
      ? "tauri:build:fedora"
      : null;

if (!script) {
  console.error(`tauri-build: unsupported platform ${process.platform}`);
  process.exit(1);
}

execSync(`npm run ${script}`, { stdio: "inherit" });
