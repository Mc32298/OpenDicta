# VoiceNote UI Control Audit

Date: 2026-05-11

## Rule

Every visible button or control must either work, be disabled with a clear reason, navigate to a real surface, or be removed.

## Voicebar

Note: Voicebar controls implemented in Task 2. Manual Tauri testing required to verify.

- [ ] Stop recording: invokes `stop_recording`, transitions from listening to processing.
- [ ] Cancel recording: invokes `cancel_recording`, transitions to cancelled/hidden without transcription.
- [x] Settings/recovery action: invokes `open_settings_page_command` to open the relevant settings page when shown — implemented Task 5.
- [ ] Dismiss error: hides the voicebar and resets idle state.

## Settings

- [ ] Close traffic button hides settings.
- [ ] Minimize traffic button hides settings.
- [ ] Sidebar items navigate only to real sections.
- [ ] Launch at login invokes `set_autostart_enabled` and reports success/error.
- [ ] Auto-paste changes real stored state or is removed until backend supports it.
- [ ] Shortcut capture invokes `set_shortcut` and refreshes registration status.
- [ ] Shortcut reset invokes `set_shortcut` with the default value and refreshes status.
- [ ] Microphone select invokes `set_audio_input_device`.
- [x] Microphone test invokes `test_microphone` — implemented Task 5.
- [ ] Model download invokes `download_model`, shows progress, and refreshes status.
- [ ] Provider select invokes `set_onnx_provider` and shows requested/effective provider.
- [ ] Accent color invokes `set_waveform_color` and updates the live voicebar.
- [x] Reset voicebar position invokes `reset_voicebar_position` — implemented Task 5.
- [ ] Health check invokes `run_health_check` and shows actionable status.
- [ ] Update check is hidden unless it performs a real update check.

## Deferred surfaces

The following pages were removed in Task 3 because they pointed to placeholder/stub workflows:
- Account tab — hidden until real auth/sync workflow exists
- History tab — hidden until real transcript history exists
- AI tab — hidden until real AI prompt workflow exists

These surfaces should be re-added as real sections when the backend workflows are implemented.

## Onboarding

Updated Task 4 (2026-05-12): shared Button/Notice/StatusBadge controls wired in; Finish disabled until model installed — implemented; empty-state CTAs converted to static `<span className="wv-note">` text.

- [ ] Back moves to the previous step and is disabled on first step.
- [ ] Next moves only when the current step is valid.
- [ ] Change Shortcut captures and saves a shortcut.
- [ ] Save Provider invokes `set_onnx_provider` and shows requested vs. effective provider (warn if they differ).
- [ ] Download Model invokes `download_model`.
- [x] Finish invokes `complete_onboarding` only after required setup is ready — disabled until `modelInstalled` is true; implemented.

## EmptyStates

- [x] CTA text ("Use Shortcut", "Open Settings → Models", "Open Settings → AI") converted from inert `<button>` to static `<span className="wv-note">` — no non-functional buttons remain.

---

## Build Verification — 2026-05-12

### Automated Gates

- cargo check: PASS — `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 0.34s`
- npm run build: PASS — `tsc && vite build` completed in 391 ms; 6 output chunks, no errors or warnings

### Code Scan

1. **HistoryTab / AccountTab / AITab references** — CLEAN. No matches in any `.tsx` file under `src/`. Deferred tabs were removed in Task 3 and are fully absent.
2. **`open_empty_state` invoke calls** — CLEAN. No matches anywhere in `src/`.
3. **Local icon definitions in VoiceBar.tsx** — CLEAN. All icons (`AlertIcon`, `CheckIcon`, `GearIcon`, `MicIcon`, `StopIcon`, `XIcon`) are imported from `../ui/icons`; no inline SVG or local icon function defined in the file.
4. **Settings pages — stub check** — CLEAN. All 7 sidebar pages render real content:
   - `GeneralTab` (line 216) — launch at login, auto-paste
   - `ShortcutTab` (line 404) — shortcut capture and reset
   - `MicrophoneTab` (line 517) — device select, test microphone
   - `ModelTab` (line 298) — download, provider select
   - `AppearanceTab` (line 577) — accent color, reset voicebar position
   - `DiagnosticsTab` (line 628) — health check with live status badges
   - `AboutTab` (line 667) — version display

   No TODOs, "placeholder", "stub", or "coming soon" text found in Settings.tsx.

### Manual Testing Required

The following flows require a running Tauri instance (`npm run tauri:dev`) for verification:

- Voicebar: hold shortcut → waveform appears → stop → processing → success/dismiss
- Voicebar: cancel during recording → "Cancelled" appears briefly → bar hides
- Voicebar: trigger error → gear icon appears → opens diagnostics settings
- Settings: all 7 sidebar pages load without placeholder/stub sections
- Settings: Launch at login toggle reports success/error
- Settings: Auto-paste toggle persists to localStorage
- Settings: Shortcut capture and reset
- Settings: Microphone select
- Settings: Test Microphone button shows result
- Settings: Model download and provider selection
- Settings: Accent color and Reset voicebar position
- Settings: Run health check
- Onboarding: Back disabled on step 1, Finish disabled until model installed
- Onboarding: Provider save shows requested vs effective
- Empty states: No CTA buttons (only static text)

### Final Acceptance Criteria

- [ ] Core dictation flow works end to end
- [ ] Every visible button works, is clearly disabled, or was removed
- [ ] Missing/failed setup states point to a recovery action
- [ ] UI reads as platform-neutral, Apple-influenced, compact, and consistent
