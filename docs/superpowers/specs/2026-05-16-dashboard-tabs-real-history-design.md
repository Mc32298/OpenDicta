# VoiceNote Dashboard Tabs And Real History Design

Date: 2026-05-16
Area: `src/windows/Settings.tsx`, dashboard/history UI, Tauri transcript persistence

## Goal

Turn the existing VoiceNote settings window into the main VoiceNote app window with a neutral, engaging Apple-inspired dashboard.

The main window should use top-level tabs:

- Dashboard
- History
- Settings

The Dashboard must show real usage metrics from saved transcriptions:

- Avg WPM
- Words in total
- Hours saved by talking
- weekly progress in an Apple Activity-style circular goal tracker
- last 5 transcriptions
- a calm engagement box that encourages continued use

## Chosen Direction

The approved visual and structural direction is `Focused Overview`.

Dashboard should be the default first tab. It should have one large Activity-style circular progress element as the visual anchor, with supporting metric cards, last 5 transcriptions, and a calm coach panel.

The existing settings UI should not be discarded. Existing settings pages move under the new Settings top-level tab.

## Non-Goals

- No dense analytics dashboard in v1.
- No charts beyond the circular weekly progress tracker.
- No badges, gamified rewards, confetti, or aggressive streak mechanics.
- No cloud sync.
- No import/backfill of old transcriptions that were never stored.
- No transcript editing, tagging, export, or advanced filtering in v1.
- No replacement component library.

## App Structure

The existing `settings` window becomes the main VoiceNote window.

The main layout should remain close to the existing Apple-style settings shell:

- quiet top chrome
- left navigation/sidebar
- main content pane
- frosted/light native-inspired material
- restrained controls and typography

The top-level navigation should be:

1. Dashboard
2. History
3. Settings

The Settings tab contains the existing settings pages:

- General
- Shortcut
- Microphone
- Model
- AI
- Appearance
- Diagnostics
- About

The simplest implementation can keep a nested settings sidebar/list inside the Settings tab, provided it does not feel like nested cards inside cards. If layout space becomes tight, the Settings tab can reuse the current left settings navigation within the content pane.

## Data Model

Every successful transcription should create a saved history record.

Fields:

- `id`: stable unique id
- `created_at`: ISO timestamp
- `text`: final transcript text after AI post-processing if AI was applied, otherwise raw transcript
- `raw_text`: raw transcript before AI post-processing when available; otherwise same as `text`
- `duration_seconds`: recording duration in seconds
- `word_count`: count of words in final text
- `wpm`: `word_count / (duration_seconds / 60)`
- `ai_mode`: AI mode/profile used for the recording, or `null` when none was used

Storage should be local-first and live in the Tauri app data directory.

For v1, JSON storage is acceptable:

- simple to inspect
- avoids adding a database dependency
- fits current local settings persistence patterns

The backend should expose Tauri commands for:

- listing transcript history, newest first
- returning dashboard stats
- reading productivity settings
- updating productivity settings

## Metrics

Dashboard metrics are derived from saved history records.

### Avg WPM

`total_words / total_speaking_minutes`

If there is no history, show `0` or a quiet empty state value.

### Words In Total

Sum of all `word_count` values.

### Hours Saved By Talking

The user chose a configurable typing baseline.

Default:

- typing baseline: `40 WPM`

Formula:

`time_saved_minutes = (total_words / typing_baseline_wpm) - total_speaking_minutes`

Display:

- clamp negative values to `0`
- show minutes for small values
- show hours once the value is at least 60 minutes

Settings should include a Productivity row where the user can set typing baseline WPM.

### Weekly Goal Tracker

Use a circular Apple Activity-style tracker as the Dashboard anchor.

Recommended v1 goal:

- weekly words dictated
- default target: `5,000 words / week`

Rationale:

- easier to understand than abstract productivity score
- derived directly from history
- aligns with the requested Words in total metric

The tracker should show progress for the current week only.

## Dashboard UI

Dashboard should use the approved Focused Overview wireframe:

- Page title and short quiet subtitle
- Large circular goal tracker on the left/top
- Supporting metric cards for Avg WPM, Words in total, and Hours saved
- Last 5 transcriptions list
- Calm coach engagement panel

The Dashboard should feel engaging but neutral:

- Apple-like
- calm
- premium through restraint
- no visual noise
- no playful gamification

### Activity-Style Circle

The circular tracker should resemble Apple Activity in spirit, not copy it exactly.

It should use:

- rounded ring caps
- soft Apple system colors
- clear center label
- compact supporting label for weekly progress

The ring should not be decorative only. It must represent real weekly progress.

### Stat Tiles

Stat tiles should be compact and readable.

Required labels:

- Avg WPM
- Words total
- Hours saved

Use tabular numerals where practical.

### Last 5 Transcriptions

Show the newest five saved records.

Each row should include:

- transcript preview
- relative or short timestamp
- word count
- duration or WPM

Rows should feel like a native list, not marketing cards.

### Calm Coach Panel

Tone:

- encouraging
- factual
- not gamified

Example copy style:

- "You saved 18 minutes this week. Keep going."
- "Three short recordings today. Your notes are adding up."
- "A few more notes will complete this week's goal."

Do not use badges, trophies, confetti, or hype copy.

## History UI

History should be a list/table surface.

Each row should show:

- transcript preview
- date/time
- duration
- word count
- WPM

Selecting a row can reveal more text inline or in a detail pane if the layout has room.

v1 does not need:

- editing
- deleting
- tagging
- export
- advanced filters
- transcript search

Those can be future additions.

## Settings UI

Existing settings functionality must be preserved.

Settings should gain a Productivity section with:

- typing baseline WPM

Default value:

- `40`

Validation:

- accept values from `10` to `180`
- reject invalid values with a quiet inline error
- keep the previous saved value when validation fails

The weekly goal should be fixed at `5,000 words / week` in v1. Goal customization is a future feature.

## Empty States

If no history exists:

- Dashboard shows quiet empty metrics and guidance to make the first recording.
- The Activity-style circle should show zero progress.
- Last 5 transcriptions shows an empty native list state.
- History shows a clear empty state.

Do not show fake sample data in the real app.

## Integration Points

The backend already emits `transcript-ready` after transcription and optional AI post-processing.

The history save should happen on successful transcription completion, near the point where final text is emitted to the frontend.

The backend must also capture recording duration for the saved record. The voicebar already tracks elapsed time in the frontend, but persistence should use backend-known timing or sample duration so saved metrics are reliable even if the UI was hidden.

## Files In Scope

Primary frontend:

- `src/App.tsx`
- `src/windows/Settings.tsx`
- `src/windows/settingsTypes.ts`
- `src/styles.css`
- `src/ui/controls.tsx`
- `src/ui/icons.tsx`

Possible new frontend files:

- `src/windows/MainWindow.tsx`
- `src/windows/Dashboard.tsx`
- `src/windows/History.tsx`
- `src/windows/ProductivitySettings.tsx`

Primary backend:

- `src-tauri/src/lib.rs`

Possible new backend files:

- `src-tauri/src/history.rs`

## Verification

Implementation should be verified with:

- `npm run build`
- relevant Rust checks/tests if backend helpers are added
- manual visual review of Dashboard, History, and Settings tabs
- at least one saved transcription path verified through backend event flow
- empty-state review with no history records
- populated-state review with several history records

## Open Decisions Resolved

- Use Focused Overview layout.
- Use top-level tabs: Dashboard, History, Settings.
- Convert existing settings window into the main app window.
- Keep existing settings pages under Settings.
- Use real saved transcription data in v1.
- Use configurable typing baseline WPM, default 40.
- Use calm coach engagement tone.
