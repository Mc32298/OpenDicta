# Linux / Wayland Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenDicta fully functional on Fedora / Wayland: global shortcuts, window resizing, auto-paste, model downloads, and diagnostics.

**Architecture:** Ship a udev rule with the RPM to grant keyboard input access without group membership changes. Fix the Settings window by enabling OS decorations on Linux. Add a graceful paste fallback when enigo fails on pure Wayland. Expose a `get_linux_status` Tauri command powering a diagnostics card in Settings.

**Tech Stack:** Rust (Tauri v2, evdev 0.12, libc), React/TypeScript, RPM bundling via `tauri.fedora.conf.json`

## Global Constraints

- All platform-specific Rust code must be gated with `#[cfg(target_os = "linux")]` or `#[cfg(unix)]`
- Windows and macOS behaviour must not change
- No new npm packages
- No new Rust dependencies except `libc = "0.2"` (Linux target only)
- Commit after each task

---

## Task 1: udev rule + RPM post-install

**Files:**
- Create: `src-tauri/scripts/99-opendicta.rules`
- Create: `src-tauri/scripts/rpm-post-install.sh`
- Modify: `src-tauri/tauri.fedora.conf.json`

**Interfaces:**
- Produces: udev rule installed at `/etc/udev/rules.d/99-opendicta.rules` by the RPM; `udevadm trigger` run on install so the rule takes effect immediately

- [ ] **Step 1: Create the udev rule file**

Create `src-tauri/scripts/99-opendicta.rules` with this exact content:

```
# Grant the currently logged-in seat user read access to raw keyboard input.
# Required for global shortcuts on Wayland (evdev-based listener).
# Uses systemd-logind uaccess tag — no group membership or re-login needed.
KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"
```

- [ ] **Step 2: Create the RPM post-install script**

Create `src-tauri/scripts/rpm-post-install.sh`:

```bash
#!/bin/bash
# Reload udev rules so the new rule takes effect immediately after install.
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=input 2>/dev/null || true
```

- [ ] **Step 3: Add to tauri.fedora.conf.json**

Modify `src-tauri/tauri.fedora.conf.json` to include the rule in the RPM and run the post-install script:

```json
{
  "bundle": {
    "active": true,
    "targets": ["rpm"],
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png"
    ],
    "externalBin": ["binaries/opendicta-worker"],
    "license": "MIT",
    "licenseFile": "../LICENSE",
    "linux": {
      "rpm": {
        "depends": [
          "webkit2gtk4.1",
          "libappindicator-gtk3",
          "librsvg2",
          "libxdo",
          "alsa-lib"
        ],
        "files": {
          "/etc/udev/rules.d/99-opendicta.rules": "scripts/99-opendicta.rules"
        },
        "postInstallScript": "scripts/rpm-post-install.sh"
      }
    },
    "resources": {}
  }
}
```

- [ ] **Step 4: Verify files exist**

```bash
ls -la src-tauri/scripts/
```

Expected: both files are present.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/scripts/99-opendicta.rules src-tauri/scripts/rpm-post-install.sh src-tauri/tauri.fedora.conf.json
git commit -m "feat(linux): ship udev rule in RPM for zero-friction keyboard access"
```

---

## Task 2: evdev permission diagnostics (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs` (lines 211–325 evdev section, plus command registration near line 4626)

**Interfaces:**
- Produces: `get_linux_status` Tauri command returning `Option<LinuxStatus>`; `EVDEV_INIT_ERROR` static storing the reason shortcuts failed

- [ ] **Step 1: Add the EVDEV_INIT_ERROR static**

Find this block near line 117 in lib.rs:

```rust
#[cfg(target_os = "linux")]
static EVDEV_SHORTCUTS: std::sync::OnceLock<Arc<Mutex<Vec<LinuxEvdevShortcut>>>> =
    std::sync::OnceLock::new();
```

Add directly after it:

```rust
#[cfg(target_os = "linux")]
static EVDEV_INIT_ERROR: std::sync::OnceLock<Option<String>> =
    std::sync::OnceLock::new();
```

- [ ] **Step 2: Set the static in start_evdev_threads**

Find the block at line 229 in lib.rs:

```rust
    if keyboard_paths.is_empty() {
        state.right_ctrl_active.store(false, Ordering::SeqCst);
        return Err(
            "No keyboard input devices found. \
             Add yourself to the 'input' group: \
             sudo usermod -aG input $USER  (then log out and back in)."
                .to_string(),
        );
    }
```

Replace with:

```rust
    if keyboard_paths.is_empty() {
        state.right_ctrl_active.store(false, Ordering::SeqCst);
        let msg = "No keyboard input devices found. \
                   The OpenDicta udev rule may not be active yet. \
                   Try reinstalling or run: sudo udevadm trigger --subsystem-match=input"
            .to_string();
        let _ = EVDEV_INIT_ERROR.set(Some(msg.clone()));
        return Err(msg);
    }

    // Verify we can actually open a keyboard device (permission check).
    if let Some(first_path) = keyboard_paths.first() {
        if let Err(e) = evdev::Device::open(first_path) {
            state.right_ctrl_active.store(false, Ordering::SeqCst);
            let msg = format!(
                "Cannot read keyboard input ({}). \
                 The udev rule may not have taken effect yet — \
                 try logging out and back in.",
                e
            );
            let _ = EVDEV_INIT_ERROR.set(Some(msg.clone()));
            return Err(msg);
        }
    }

    let _ = EVDEV_INIT_ERROR.set(None);
```

- [ ] **Step 3: Add the LinuxStatus struct and get_linux_status command**

Find the `// ─── System Tray` comment (around line 4148). Add this block just before it:

```rust
// ─── Linux diagnostics ───────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct LinuxStatus {
    wayland: bool,
    xwayland: bool,
    evdev_ok: bool,
    evdev_error: Option<String>,
    enigo_likely_ok: bool,
}

#[tauri::command]
fn get_linux_status() -> Option<LinuxStatus> {
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
        let xwayland = std::env::var("DISPLAY").is_ok();
        let evdev_error = EVDEV_INIT_ERROR.get().and_then(|v| v.clone());
        let evdev_ok = evdev_error.is_none();
        // enigo uses libxdo (X11). On pure Wayland without XWayland it will fail.
        let enigo_likely_ok = !wayland || xwayland;
        return Some(LinuxStatus { wayland, xwayland, evdev_ok, evdev_error, enigo_likely_ok });
    }
    #[allow(unreachable_code)]
    None
}
```

- [ ] **Step 4: Register the command**

Find the `generate_handler!` macro call (around line 4626). Add `get_linux_status` to the list:

```rust
get_linux_status,
```

- [ ] **Step 5: Build to verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(linux): add evdev permission tracking and get_linux_status command"
```

---

## Task 3: Settings and Onboarding window decorations on Linux

**Files:**
- Modify: `src-tauri/src/lib.rs` (`open_settings_page` at line 2828, `open_onboarding` at line 2801)

**Interfaces:**
- Produces: Settings and Onboarding windows rendered with OS chrome (title bar + resize border) on Linux, unchanged on other platforms

**Note:** Settings.tsx has no custom title bar — the React content fills the window directly. Enabling OS decorations on Linux just adds the standard GNOME/KDE title bar on top with no React changes needed.

- [ ] **Step 1: Fix open_settings_page for Linux**

Find this block at line 2843 in lib.rs:

```rust
        let _ =
            tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App(url.into()))
                .title("OpenDicta")
                .inner_size(width, height)
                .min_inner_size(min_width, min_height)
                .resizable(true)
                .decorations(false)
                .transparent(true)
                .center()
                .build();
```

Replace with:

```rust
        let builder =
            tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App(url.into()))
                .title("OpenDicta")
                .inner_size(width, height)
                .min_inner_size(min_width, min_height)
                .resizable(true);

        #[cfg(target_os = "linux")]
        let builder = builder.decorations(true).transparent(false);
        #[cfg(not(target_os = "linux"))]
        let builder = builder.decorations(false).transparent(true);

        let _ = builder.center().build();
```

- [ ] **Step 2: Fix open_onboarding for Linux**

Find this block at line 2807 in lib.rs:

```rust
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "onboarding",
            tauri::WebviewUrl::App("/?window=onboarding".into()),
        )
        .title("OpenDicta Setup")
        .inner_size(760.0, 620.0)
        .resizable(false)
        .decorations(false)
        .transparent(false)
        .center()
        .build();
```

Replace with:

```rust
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "onboarding",
            tauri::WebviewUrl::App("/?window=onboarding".into()),
        )
        .title("OpenDicta Setup")
        .inner_size(760.0, 620.0)
        .resizable(false)
        .transparent(false);

        #[cfg(target_os = "linux")]
        let builder = builder.decorations(true);
        #[cfg(not(target_os = "linux"))]
        let builder = builder.decorations(false);

        let _ = builder.center().build();
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(linux): enable OS window decorations on Linux for resize support"
```

---

## Task 4: Paste fallback — Rust side

**Files:**
- Modify: `src-tauri/src/lib.rs` (`paste_text` function at line 4098)

**Interfaces:**
- Produces: `paste-manual-required` Tauri event emitted with `{ text: String }` payload when enigo fails; clipboard still written before the event fires

- [ ] **Step 1: Modify paste_text to emit fallback event**

Find the `paste_text` function at line 4098. Replace the entire function body:

```rust
fn paste_text(app: &AppHandle, text: &str) {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    // Always write to clipboard first — this works on both Wayland and X11.
    let clipboard_ok = app
        .clipboard()
        .write_text(text.to_string())
        .map(|_| true)
        .unwrap_or_else(|e| {
            eprintln!("Clipboard write failed: {}", e);
            false
        });

    // Delay to ensure the original app regains focus before injecting keys.
    std::thread::sleep(std::time::Duration::from_millis(360));

    match Enigo::new(&Settings::default()) {
        Ok(mut enigo) => {
            if clipboard_ok {
                let mut pasted = true;
                if let Err(e) = enigo.key(Key::Control, Direction::Press) {
                    eprintln!("Ctrl down failed: {}", e);
                    pasted = false;
                }
                if let Err(e) = enigo.key(Key::Unicode('v'), Direction::Click) {
                    eprintln!("V click failed: {}", e);
                    pasted = false;
                }
                if let Err(e) = enigo.key(Key::Control, Direction::Release) {
                    eprintln!("Ctrl up failed: {}", e);
                }
                if pasted {
                    #[cfg(debug_assertions)]
                    println!("[ai] paste sent via clipboard+Ctrl+V");
                    return;
                }
            }
            if let Err(e) = enigo.text(text) {
                eprintln!("Paste typing fallback failed: {} — text: {}", e, text);
            } else {
                #[cfg(debug_assertions)]
                println!("[ai] paste sent via typing fallback");
            }
        }
        Err(e) => {
            eprintln!("Could not create enigo instance: {}", e);
            // On pure Wayland without XWayland, enigo fails. The text is already
            // in the clipboard — tell the UI to show a manual-paste hint.
            if clipboard_ok {
                let _ = app.emit("paste-manual-required", serde_json::json!({ "text": text }));
            }
        }
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(linux): emit paste-manual-required event when enigo unavailable on Wayland"
```

---

## Task 5: Paste fallback — VoiceBar UI

**Files:**
- Modify: `src/windows/VoiceBar.tsx`

**Interfaces:**
- Consumes: `paste-manual-required` Tauri event with `{ text: string }` payload
- Produces: VoiceBar shows "Copied — press Ctrl+V" in done state for 3 seconds when event fires

- [ ] **Step 1: Add pasteHint state and listener**

In VoiceBar.tsx, after the existing state declarations (around line 20), add:

```tsx
const [pasteHint, setPasteHint] = useState(false);
```

- [ ] **Step 2: Add the paste-manual-required listener**

Inside the `useEffect` that registers all listeners (the large one starting around line 62), add this listener alongside the others:

```tsx
    const unlistenPasteManual = listen("paste-manual-required", () => {
      clearHideTimers();
      setVisible(true);
      setState("done");
      setPasteHint(true);
      setStatusText("Copied — press Ctrl+V");
      doneHideTimerRef.current = window.setTimeout(() => {
        setPasteHint(false);
        hideAndReset();
      }, 3000);
    });
```

Add `unlistenPasteManual` to the cleanup return at the bottom of that same `useEffect`:

```tsx
      unlistenPasteManual.then(fn => fn());
```

- [ ] **Step 3: Reset pasteHint in hideAndReset**

In the `hideAndReset` function (around line 235), add `setPasteHint(false)`:

```tsx
  function hideAndReset() {
    clearHideTimers();
    aiWarningRef.current = null;
    setState("idle");
    setStatusText("Ready");
    setVisible(false);
    setLevel(0);
    setPasteHint(false);
    document.documentElement.removeAttribute("data-vb");
  }
```

- [ ] **Step 4: Update done state rendering to show the hint**

Find the `isDone` block in the JSX (around line 289):

```tsx
          {isDone && (
            <div className="pill-status">
              <div className="pill-check"><CheckIcon /></div>
              <span className="pill-status-text pill-status-text--done">{statusText}</span>
            </div>
          )}
```

Replace with:

```tsx
          {isDone && (
            <div className="pill-status">
              {pasteHint
                ? <div className="pill-alert" style={{ color: "var(--accent)" }}>⌨</div>
                : <div className="pill-check"><CheckIcon /></div>
              }
              <span className="pill-status-text pill-status-text--done">{statusText}</span>
            </div>
          )}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/windows/VoiceBar.tsx
git commit -m "feat(linux): show clipboard hint in VoiceBar when Wayland paste unavailable"
```

---

## Task 6: Disk space check in model downloads

**Files:**
- Modify: `src-tauri/Cargo.toml` (add libc for Linux)
- Modify: `src-tauri/src/lib.rs` (`download_model` at line 1906, plus a new helper)

**Interfaces:**
- Produces: `download_model` returns a human-readable error when there's not enough disk space before downloading

- [ ] **Step 1: Add libc as a Linux dependency**

In `src-tauri/Cargo.toml`, find the existing Linux-specific dependencies:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
evdev = "0.12"
```

Add libc:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
evdev = "0.12"
libc  = "0.2"
```

- [ ] **Step 2: Add the disk space helper function**

In `src-tauri/src/lib.rs`, find the `// ─── Linux diagnostics` comment added in Task 2. Add this function directly after the `get_linux_status` command:

```rust
/// Returns available bytes on the filesystem containing `path`, or None if unavailable.
#[cfg(unix)]
fn available_disk_space_bytes(path: &std::path::Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let ret = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if ret == 0 {
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    } else {
        None
    }
}
```

- [ ] **Step 3: Add disk space check in download_model**

Find this block in `download_model` at line 1926:

```rust
    let specs = model_specs_for(&model_id);
    let bases = download_bases_for(&model_id);
    let total_files = specs.len();
```

Add the disk space check immediately after those three lines:

```rust
    // Check available disk space before starting (Unix only).
    // Sum bytes of files not already verified; require 10% headroom.
    #[cfg(unix)]
    {
        let needed: u64 = specs
            .iter()
            .filter(|s| !dir.join(s.name).exists())
            .map(|s| s.expected_bytes)
            .sum();
        if needed > 0 {
            if let Some(available) = available_disk_space_bytes(&dir) {
                let required = (needed as f64 * 1.1) as u64;
                if available < required {
                    let needed_gb = required as f64 / 1_073_741_824.0;
                    let avail_gb = available as f64 / 1_073_741_824.0;
                    return Err(format!(
                        "Not enough disk space. Need {:.1} GB, only {:.1} GB available.",
                        needed_gb, avail_gb
                    ));
                }
            }
        }
    }
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat(linux): check available disk space before model downloads"
```

---

## Task 7: Linux diagnostics card in Settings

**Files:**
- Modify: `src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `get_linux_status` Tauri command returning `LinuxStatus | null` where `LinuxStatus = { wayland: boolean; xwayland: boolean; evdev_ok: boolean; evdev_error: string | null; enigo_likely_ok: boolean }`

- [ ] **Step 1: Add the LinuxStatus type and state**

In Settings.tsx, after the existing type declarations (around line 48), add:

```tsx
type LinuxStatus = {
  wayland: boolean;
  xwayland: boolean;
  evdev_ok: boolean;
  evdev_error: string | null;
  enigo_likely_ok: boolean;
};
```

Inside the `Settings` component function, after the existing state declarations, add:

```tsx
  const [linuxStatus, setLinuxStatus] = useState<LinuxStatus | null>(null);
```

- [ ] **Step 2: Load Linux status on mount**

Add this `useEffect` alongside the existing ones (e.g., after the `getVersion` effect):

```tsx
  useEffect(() => {
    invoke<LinuxStatus | null>("get_linux_status")
      .then(setLinuxStatus)
      .catch(() => setLinuxStatus(null));
  }, []);
```

- [ ] **Step 3: Add the Linux status card to the JSX**

Find the closing `</div>` of the Settings return (around line 523, before the final `)`). Add the Linux card just before the outer closing `</div>`:

```tsx
      {linuxStatus && (
        <div className="card card-lg" style={{ marginTop: "var(--gap)" }}>
          <div className="section-title" style={{ marginBottom: 12 }}>Linux / Wayland status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <LinuxCheck ok={true} label={linuxStatus.wayland ? "Wayland session detected" : "X11 session (Wayland not active)"} />
            <LinuxCheck ok={linuxStatus.evdev_ok} label={
              linuxStatus.evdev_ok
                ? "Keyboard input: accessible (global shortcuts active)"
                : `Keyboard input: ${linuxStatus.evdev_error ?? "inaccessible"}`
            } />
            <LinuxCheck ok={linuxStatus.enigo_likely_ok} label={
              linuxStatus.enigo_likely_ok
                ? "Auto-paste: available (XWayland present)"
                : "Auto-paste: limited — text is copied to clipboard, press Ctrl+V to paste"
            } />
          </div>
        </div>
      )}
```

- [ ] **Step 4: Add the LinuxCheck helper component**

Add this small component at the bottom of Settings.tsx, alongside the other helper components:

```tsx
function LinuxCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--ink-2)" }}>
      <span style={{ color: ok ? "oklch(64% 0.16 145)" : "oklch(65% 0.18 30)", fontWeight: 700, flexShrink: 0 }}>
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ lineHeight: 1.45 }}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(linux): add Linux/Wayland diagnostics card to Settings page"
```

---

## Final: Push the Linux branch

**Note:** `master` is for Windows releases only. All Linux work stays on `fix-fedora`. Push the branch — do NOT open a PR targeting master.

- [ ] **Push the branch**

```bash
git push -u origin fix-fedora
```
