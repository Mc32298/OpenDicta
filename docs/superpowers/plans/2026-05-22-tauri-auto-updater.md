# Tauri Auto Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current manual GitHub version check with Tauri's native updater so OpenDicta checks a GitHub-hosted static updater manifest, prompts when an update exists, downloads and installs it, and then prompts for restart.

**Architecture:** Use `tauri-plugin-updater` as the single source of truth for app updates. Configure Tauri to emit updater artifacts and verify signatures against a committed public key, then expose a small frontend update controller that checks on startup, drives download/install state, and surfaces prompt/restart UI inside the existing Settings shell.

**Tech Stack:** Tauri v2, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`, `tauri-plugin-updater`, React 19, existing toast/settings UI, GitHub Releases static `latest.json` feed.

---

### Task 1: Wire Tauri updater dependencies and config

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/tauri.bundle.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add updater dependencies to Rust and JS manifests**
- [ ] **Step 2: Enable updater artifact generation and configure GitHub static manifest endpoint**
- [ ] **Step 3: Add updater public-key placeholder and Windows install mode**
- [ ] **Step 4: Grant updater/process plugin permissions to app windows**

### Task 2: Replace manual GitHub release checker with native updater runtime

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs` helpers via focused unit tests if extracted

- [ ] **Step 1: Remove or retire `check_for_updates` manual GitHub logic**
- [ ] **Step 2: Add minimal backend helpers only if frontend needs app-specific state**
- [ ] **Step 3: Keep restart/install behavior on the supported updater/process APIs rather than custom installer spawning**

### Task 3: Add frontend updater controller and prompts

**Files:**
- Create: `src/lib/updater.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/styles.css`
- Test: `tests/updaterState.test.mjs`

- [ ] **Step 1: Write failing tests for updater state transitions and status messaging**
- [ ] **Step 2: Implement a small updater controller around `check()` / `downloadAndInstall()` / `relaunch()`**
- [ ] **Step 3: Check once on app startup and cache discovered update state**
- [ ] **Step 4: Show prompt when update is available, progress during install, and restart action when ready**
- [ ] **Step 5: Replace fake/manual settings copy with real updater status and actions**

### Task 4: Document release requirements and verify build

**Files:**
- Create: `docs/updater-release.md`
- Modify: `README.md` if release workflow belongs there

- [ ] **Step 1: Document public key vs private key handling**
- [ ] **Step 2: Document GitHub Release assets required for `latest.json` updates**
- [ ] **Step 3: Document required CI secrets (`TAURI_PRIVATE_KEY`, optional password)**
- [ ] **Step 4: Run `npm run build` and `cargo check` to verify integration**

