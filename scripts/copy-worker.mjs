/**
 * Copies the release worker binary into src-tauri/binaries/ with the
 * target-triple suffix that Tauri's externalBin bundler expects.
 *
 * Tauri looks for:  src-tauri/binaries/voicenote-worker-<triple>[.exe]
 * Cargo produces:   target/release/voicenote-worker[.exe]
 */

import { execSync } from "child_process";
import { mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");

// Ask rustc for the host triple (e.g. x86_64-pc-windows-msvc)
const triple = execSync("rustc -Vv", { encoding: "utf8" })
  .split("\n")
  .find((l) => l.startsWith("host:"))
  ?.split(":")[1]
  ?.trim();

if (!triple) {
  console.error("copy-worker: could not determine host triple from rustc -Vv");
  process.exit(1);
}

const ext = process.platform === "win32" ? ".exe" : "";
const src = join(root, "target", "release", `voicenote-worker${ext}`);
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, `voicenote-worker-${triple}${ext}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

console.log(`copy-worker: ${src} → ${dest}`);
