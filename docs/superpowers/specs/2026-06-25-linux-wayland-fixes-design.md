# Linux / Wayland Fixes — Design Spec

**Date:** 2026-06-25
**Branch:** fix-fedora
**Status:** Approved

## Problem

The app launches on Linux (Fedora / Wayland) but three core features are broken:

1. **Global shortcuts don't work** — the evdev listener requires the user to be in the `input` group, which is too much friction for end users and silently fails with no in-app feedback.
2. **Settings window cannot be resized** — the window is created with `decorations: false` + `transparent: true`. On Wayland the compositor only provides resize handles via server-side decorations; without them the window is stuck at its initial size.
3. **Auto-paste silently drops transcriptions** — `enigo` depends on libxdo/X11. On pure Wayland `Enigo::new()` fails, the text is lost, and the user only sees the VoiceBar say "done" with nothing pasted.

## Scope

Changes target Linux/Wayland only. Windows and macOS behaviour is unchanged throughout.

---

## Section 1 — Shortcuts: udev rule

### Approach

Ship a udev rule with the RPM that uses the `TAG+="uaccess"` mechanism. This is the same mechanism used by USB game controllers, MIDI devices, and audio interfaces on modern Fedora/GNOME — no group membership change, no re-login required.

### File

`src-tauri/scripts/99-opendicta.rules`:

```
# Allow the logged-in seat user to read raw keyboard input (needed for global shortcuts on Wayland)
KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"
```

### Delivery

- Add file to `tauri.fedora.conf.json` under `bundle.resources` so it is included in the RPM at `/etc/udev/rules.d/99-opendicta.rules`.
- Add RPM `%post` scriptlet: `udevadm control --reload-rules && udevadm trigger` so the rule takes effect immediately after install without a reboot.

### In-app diagnostics

When the evdev setup loop fails to open any keyboard device (currently silently ignored), emit a `shortcut-permission-error` Tauri event so the Settings page can show a clear actionable card.

---

## Section 2 — Window resizing: OS decorations on Linux

### Root cause

`open_settings_page()` in `lib.rs` creates the window with `.decorations(false).transparent(true)`. On Wayland, this removes all compositor-drawn borders and title bar, leaving no surface the user can grab to resize the window.

### Fix

Add a platform-conditional branch in `open_settings_page()`:

```rust
#[cfg(target_os = "linux")]
let builder = builder.decorations(true).transparent(false);
```

This gives the window standard GNOME/KDE chrome (title bar + resize border) on Linux only. Same treatment for the Onboarding window.

### Frontend change

The Settings and Onboarding UIs currently render a custom title bar and close button (because `decorations: false` was assumed everywhere). On Linux, the OS provides these — the custom ones must be hidden. Use Tauri's `platform()` API at runtime to conditionally suppress the custom chrome on Linux.

---

## Section 3 — Auto-paste: Wayland-aware fallback

### Root cause

`paste_text()` does: write clipboard → enigo Ctrl+V → enigo type-fallback. On pure Wayland `Enigo::new()` returns an error. The code logs to stderr but emits nothing to the frontend. The transcription is silently lost.

### Layered fix

1. **Clipboard write** via Tauri's `app.clipboard().write_text()` — already works on Wayland. Keep this.
2. **Ctrl+V injection** via enigo — keep this attempt; it succeeds when XWayland is present (the common case on Fedora/GNOME).
3. **New fallback**: if enigo initialisation fails, the text is already on the clipboard. Emit a `paste-manual-required` Tauri event containing the transcription text.
4. **VoiceBar UI**: listen for `paste-manual-required`. In the "done" state, instead of the normal dismiss, show **"Copied to clipboard — press Ctrl+V"** with a short linger time (3s) before auto-hiding.

No new system dependencies. Degrades gracefully on pure Wayland and XWayland alike.

---

## Section 4 — Model downloads: disk space check

The download path (`~/.local/share/com.OpenDicta.app/models/`) and SHA256-verified download logic are correct for Linux. One improvement:

- Before starting a download, check available disk space on the target filesystem. If `available < file_size * 1.1`, return an error immediately with a human-readable message ("Not enough disk space — need X GB free") rather than failing mid-download with a cryptic I/O error.

CSP does not apply to Rust-side downloads, so no CSP changes are needed.

---

## Section 5 — Linux diagnostics card in Settings

Add a "Linux / Wayland status" panel to the Settings health-check section. Shows live status for:

| Check | Source |
|---|---|
| Wayland detected | `WAYLAND_DISPLAY` env var |
| Shortcut listener active | at least one evdev keyboard opened successfully |
| Auto-paste available | enigo init succeeded |

This gives users and developers immediate visibility into what's working, reducing support friction significantly.

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/scripts/99-opendicta.rules` | New — udev rule |
| `src-tauri/tauri.fedora.conf.json` | Add rule to bundle resources; add RPM `%post` scriptlet |
| `src-tauri/src/lib.rs` | Platform-conditional decorations in `open_settings_page()` and `open_onboarding()`; paste fallback event; evdev error event; disk space check in `download_model()` |
| `src/windows/VoiceBar.tsx` | Handle `paste-manual-required` event; show clipboard hint in done state |
| `src/pages/Settings.tsx` | Hide custom title bar on Linux; show Linux diagnostics card |

## Out of Scope

- Wayland global shortcut portal (XDG GlobalShortcuts) — evdev + udev is sufficient and simpler
- ydotool / wtype integration — clipboard fallback covers the Wayland paste gap
- Windows or macOS behaviour changes
