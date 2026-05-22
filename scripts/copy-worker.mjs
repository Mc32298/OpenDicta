/**
 * Copies the release worker binary into src-tauri/binaries/ with the
 * target-triple suffix that Tauri's externalBin bundler expects.
 *
 * Tauri looks for:  src-tauri/binaries/opendicta-worker-<triple>[.exe]
 * Cargo produces:   target/release/opendicta-worker[.exe]
 */

import { execSync } from "child_process";
import { mkdirSync, copyFileSync, existsSync } from "fs";
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
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || triple;
const candidateSrcPaths = [
  // Cargo --target builds land here (CI release workflow path)
  join(root, "target", targetTriple, "release", `opendicta-worker${ext}`),
  // Default cargo build path (local dev path)
  join(root, "target", "release", `opendicta-worker${ext}`),
];
const src = candidateSrcPaths.find((p) => existsSync(p));
if (!src) {
  console.error("copy-worker: source worker binary not found. Tried:");
  for (const p of candidateSrcPaths) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, `opendicta-worker-${targetTriple}${ext}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

console.log(`copy-worker: ${src} → ${dest}`);
