# VoiceNote UI/UX Overhaul Design

Date: 2026-05-11

## Goal

Overhaul VoiceNote's UI/UX while preserving the working speech-to-text foundation. The app should become a modern, sleek, platform-neutral dictation utility guided by Apple Human Interface Guidelines principles: hierarchy, harmony, consistency, purposeful materials, clear control roles, and reliable interaction feedback.

The redesign must make every visible button work. A visible control must either perform a real action, change real state, navigate to a real surface, be disabled with an understandable reason, or be removed.

## Product Direction

VoiceNote should be a focused menu-bar utility, not a full desktop productivity app. The primary workflow is:

1. Hold the configured shortcut.
2. The voicebar appears immediately.
3. Speak.
4. Release the shortcut or press stop.
5. VoiceNote transcribes, pastes, confirms, and disappears.
6. If anything fails, VoiceNote explains the issue and offers a direct recovery path.

The redesign focuses on these surfaces:

- Voicebar: the main interaction surface.
- Settings: compact control center for working app configuration.
- Onboarding: first-run setup that proves the core workflow is ready.
- Recovery states: clear paths for missing model, failed shortcut, unavailable microphone, provider fallback, paste failure, and download failure.
- Tray/menu: quick access to settings, pause/resume, setup check, and quit.

Large transcript history, account/sync, advanced prompt profiles, and decorative dashboards are out of scope for this overhaul. Existing placeholder pages should become real, be hidden, or move to future-work documentation.

## Visual And Interaction System

The UI should feel calm, compact, tactile, and predictable. It should be Apple-influenced but platform-neutral, so it does not pretend to be a native AppKit app on Windows.

### Materials

Use dark translucent materials for the floating voicebar and window chrome. Use solid, high-contrast content areas where readability matters. Blur and transparency should create hierarchy, not decoration.

### Typography

Use the existing system font stack. Keep headings compact and functional. Avoid oversized marketing-style typography inside settings and utility surfaces.

### Spacing

Use an 8px-based spacing rhythm. Settings rows should stay compact, grouped, and scannable. Avoid nested cards inside cards.

### Controls

Controls need explicit roles:

- Primary: the preferred nondestructive action in a view.
- Secondary: supporting action.
- Ghost/plain: low-emphasis action.
- Destructive/cancel: stop, cancel, delete, or risky action.
- Icon-only: compact commands with labels and tooltips.

Every custom button requires hover, pressed, disabled, loading, and focus-visible states. Small visual buttons can remain compact, but their hit regions should be comfortable.

### Color

Use a neutral dark palette with one accent color. Accent color is reserved for current state, primary actions, waveform, and selected navigation. Use red for errors/destructive actions, green for success, and amber for warnings.

### Motion

Use short purposeful transitions:

- Voicebar appear/disappear.
- Listening waveform.
- Processing pulse.
- Success and error feedback.

Do not add ornamental animation.

### Icons And Accessibility

Use a consistent icon system instead of mixed hand-rolled SVGs. Icon-only controls need accessible labels and tooltips. Form controls, buttons, and navigation items need visible focus states.

### Copy

Use short verb-first labels. Do not expose placeholder surfaces as if they are complete features. Error text should say what failed and which action fixes it.

## UX Architecture

### Voicebar States

The voicebar should have explicit states:

- Hidden: default state.
- Idle preview: optional tray-opened state that shows shortcut and settings/cancel actions.
- Listening: waveform, timer, stop, and cancel.
- Processing: progress message. Include cancel only if the backend can actually cancel safely; otherwise disable or omit it.
- Success: transcript preview and paste/copy confirmation, then auto-hide.
- Error: clear message plus one relevant action such as Open Settings, Retry Setup, or Dismiss.
- Cancelled: brief neutral confirmation, then hide.

### Settings Structure

Keep a sidebar-based settings window, but reduce it to real sections:

- General: launch at login, paste behavior, app behavior.
- Shortcut: capture shortcut, registration status, reset, and test shortcut.
- Microphone: selected input, level meter, and test mic.
- Model: installed status, download progress, provider, and runtime status.
- Appearance: accent/waveform color and reset voicebar position.
- Diagnostics: health check, logs/status, and recovery actions.
- About: version and update check only if update checking is real.

Hide or postpone Account, History, and AI Prompts until they have real workflows.

### Button Audit Rule

Every visible button must satisfy one of these:

- Calls a real backend command and handles loading, success, and error.
- Changes real local UI state and persists it when appropriate.
- Navigates to a real surface.
- Is disabled with a clear reason.
- Is removed.

No inert CTAs should remain. For example, if update checking is still a Rust stub, it should not be shown as a working button.

### Recovery Flows

Recovery should be direct and local to the problem:

- Missing model: Model page with download, progress, and retry.
- Microphone unavailable: Microphone page with device picker and test.
- Shortcut not registered: Shortcut page with retry/reset guidance.
- Provider fallback: Model page explains requested and active provider, with restart/retry guidance.
- Paste failure: General or Diagnostics page explains paste behavior and recovery.
- Download failure: Keep partial state visible, allow retry, and explain token/network causes.

## Implementation Boundaries

The implementation should focus on the React/Tauri UI boundary and avoid rewriting the speech pipeline.

### Frontend

Create reusable UI primitives:

- Button
- IconButton
- Switch
- SelectRow
- Notice
- SettingsSection
- StatusBadge

Centralize visual tokens in CSS for color, spacing, radius, material, text, focus, and motion. Keep voicebar state rendering explicit and testable. Split settings into smaller components or hooks where that reduces complexity.

### Backend

Keep existing Tauri commands where they already work. Add only the missing commands needed to make visible controls real, such as:

- test microphone
- reset voicebar position
- richer health check
- paste capability/status reporting

Remove or hide UI actions that only call stubs.

Preserve the existing hotkey, audio capture, worker, model, and paste flow.

## Verification

Required verification:

- `npm run build`
- `cargo check` if Rust commands or backend state change
- Manual Tauri verification of:
  - onboarding
  - hold-to-record
  - stop
  - cancel
  - transcription success
  - model missing/download
  - shortcut change/reset
  - microphone selection/test
  - provider change/fallback messaging
  - tray settings/quit

If the project lacks UI test infrastructure, use a deterministic manual control audit checklist instead of claiming automated coverage.

## Rollout Sequence

1. Introduce design tokens and shared controls.
2. Redesign voicebar and clean up state rendering.
3. Restructure settings and perform the button audit.
4. Improve onboarding and recovery flows.
5. Fill backend command gaps required by real controls.
6. Run visual QA and full interaction audit.
7. Run build/check verification.

## Acceptance Criteria

- The core dictation flow remains working.
- The voicebar clearly communicates listening, processing, success, error, and cancellation.
- Settings contains only real, useful controls.
- Every visible button works, is clearly disabled, or is removed.
- First-run onboarding can guide a new user through shortcut, microphone, model, and provider setup.
- Recoverable failures route the user to the right fix.
- The UI is platform-neutral, Apple-influenced, compact, modern, and visually consistent.
- Build verification passes before implementation is considered complete.
