# First-run Tutorial — Design

**Date:** 2026-05-22
**Status:** Approved (pending spec review)

## Summary

After a user completes onboarding (clicks **Finish** on step 4), the onboarding
window transitions in place into a 6-step guided product tour. The tour teaches
the core features of OpenDicta using a **showcase layout**: a large animated
visual area on top, with explanatory copy, a dot-progress indicator, and
navigation controls below. The user can **Skip** the tour at any point and
**Replay** it later from the Settings page.

No new window is created — the tour is a second *phase* of the existing
onboarding window.

## Goals

- Introduce new users to the app's core features immediately after setup.
- Keep the experience continuous with onboarding (same window, same theme).
- Ship without depending on screenshot/video assets that don't exist yet, while
  leaving a clear path to add real media per-step later.
- Let users skip and replay.

## Non-goals

- Producing real screenshots or recorded video (deferred; the layout supports
  swapping them in later).
- Interactive/guided overlays on the live app UI.
- Persisting granular tour progress or a "tour seen" flag (see Open Decisions).

## Visual / theme direction

- **Reuse the app's existing theme tokens** — the cream/oklch palette
  (`--bg-*`, `--ink-1..4`, `--line`, `--accent`, `--ac-green`, etc.), the
  `Instrument Serif` display font for headings, and the existing `.wv-btn`
  controls. The tour must feel like the same product as onboarding and the
  AppShell, not a separate styled surface.
- **Layout: showcase (option B).** Each step is laid out vertically:
  1. Large animated visual area (~55% of content height) at the top.
  2. Step title (`Instrument Serif`) + body copy.
  3. Dot-progress indicator (one dot per step) + `Back` / `Next` buttons
     (bottom-right). `Next` becomes `Done` on the final step.
  4. A `Skip tour` button top-right.

- **Visuals are hybrid.** Each step's visual is a small, self-contained
  component that renders an illustrated/animated CSS/SVG representation of the
  feature. Each visual component exposes an optional image slot so a real
  screenshot/GIF can be dropped in later for that step without changing the
  step's structure.

## The 6 steps

| # | id          | Title              | Teaches |
|---|-------------|--------------------|---------|
| 1 | `dictation` | How dictation works | Hold/press shortcut → speak → transcribes locally → pastes into the active app. Recaps the shortcuts the user just set. |
| 2 | `toolbar`   | The quick toolbar   | The floating VoiceBar pill, what its buttons do, and the Quick-switch palette. |
| 3 | `models`    | Changing models     | Switching transcription models from the Models page and via Quick-switch; what "installed model" means. |
| 4 | `ai`        | AI features         | What the AI page does — cleanup, formatting, custom styles/commands applied to dictation. |
| 5 | `insights`  | Insights            | Time saved vs typing, word counts, usage trends. |
| 6 | `wrap`      | You're all set      | Where settings live + how to replay this tour later. |

## Architecture

### Phase model

The onboarding window gains a `phase` concept:

- `"setup"` — the existing 4-step onboarding flow.
- `"tour"` — the new 6-step tutorial.

`Onboarding.tsx` owns `phase` state. When `phase === "setup"` it renders the
existing setup steps. When `phase === "tour"` it renders a new `Tutorial`
component.

### Transition from setup → tour

The current `finish()` handler calls `complete_onboarding` then hides the
window. New behavior:

1. `await invoke("complete_onboarding")` (unchanged — marks onboarding done so
   the window won't auto-open on next launch).
2. Resize the window to the showcase size (≈ **820 × 660**) and re-center, via
   `getCurrentWindow().setSize(...)` + `center()`.
3. `setPhase("tour")`, `setTourStep(0)`.

The window stays visible; no new window.

### Ending the tour

Both **Skip tour** and pressing **Done** on the final step call
`getCurrentWindow().hide()`. (The window is hidden, not closed, so it can be
reshown for replay.)

### `Tutorial.tsx` (new component)

- Owns `tourStep` state (0–5) and renders the showcase layout.
- Defines `TOUR_STEPS: Array<{ id: string; title: string; body: string; Visual: ComponentType }>`.
- Each `Visual` is a small component rendering illustrated/animated CSS/SVG for
  that step, with an optional `imageSrc`-style slot for a future real asset.
- Receives callbacks from the parent for `onSkip` / `onDone`, or owns them
  directly via `getCurrentWindow()`. (Implementation detail for the plan;
  either is acceptable.)

### Replay

- **Settings page** (`src/pages/Settings.tsx`): a "Replay tutorial" button calls
  `invoke("start_tutorial")`.
- **Rust `start_tutorial` command** (`src-tauri/src/lib.rs`):
  - If the `onboarding` window exists (it is hidden, not closed, after first
    run): emit a `start-tutorial` event to it, then `show()` + `set_focus()`.
  - If it does not exist: build it with URL `"/?window=onboarding&phase=tour"`
    (same builder settings as `open_onboarding`, sized for the tour).
  - Register the command in the `invoke_handler!` list.
- **React wiring** (`Onboarding.tsx`):
  - On mount, read the `phase` URL param; if `phase=tour`, start directly in the
    tour phase (covers the fresh-build replay case).
  - Listen for the `start-tutorial` event; on receipt set `phase="tour"`,
    `tourStep=0`, and resize the window (covers the reuse-existing-window case).

## Data flow

```
Onboarding (setup) --Finish--> complete_onboarding (Rust)
                              \-> resize window + setPhase("tour")
Tutorial --Skip/Done--> window.hide()

Settings "Replay" --invoke--> start_tutorial (Rust)
   exists?  --yes--> emit "start-tutorial" + show/focus --> Onboarding sets phase=tour
            --no---> build window "/?window=onboarding&phase=tour" --> Onboarding reads param
```

## Files touched

- `src/windows/Onboarding.tsx` — add `phase` state; change `finish()` to
  transition + resize instead of hide; read `phase` URL param on mount; listen
  for `start-tutorial`; render `<Tutorial/>` when in tour phase.
- `src/windows/Tutorial.tsx` *(new)* — showcase layout, `TOUR_STEPS`, per-step
  animated visual components.
- `src/styles.css` — new `.wv-tour-*` classes built on existing theme tokens.
- `src/pages/Settings.tsx` — "Replay tutorial" button → `invoke("start_tutorial")`.
- `src-tauri/src/lib.rs` — `start_tutorial` command + registration; reuse
  `open_onboarding`'s builder config for the fresh-build path.

## Error handling

- `complete_onboarding` failure: keep current behavior (show an error notice);
  do not transition to the tour if it throws.
- `set_typing_baseline_wpm` / shortcut errors are unchanged (setup phase only).
- `start_tutorial` invoke failure from Settings: surface a non-blocking error in
  the Settings UI; do not crash.
- Window resize failure: non-fatal — the tour still renders at the current size.

## Testing / verification

- **Browser preview (Vite route `/?window=onboarding`):** walk setup → Finish →
  verify the tour renders in showcase layout, all 6 steps navigate with
  Back/Next, dot-progress updates, Skip and Done behave (Done/Skip call
  `hide()`, which no-ops harmlessly in-browser).
- **Replay React path:** verify `/?window=onboarding&phase=tour` starts directly
  in the tour; simulate the `start-tutorial` event to confirm the phase switch.
- **Tauri-only paths** (`start_tutorial` window build, real `hide()`/resize)
  cannot be exercised in a plain browser; these will be validated structurally
  (types compile, command registered) and noted as needing a Tauri run.
- `npx tsc --noEmit` passes.

## Open decisions (resolved)

- **Auto-show vs. replay:** No persisted "tour seen" flag. The tour shows once
  immediately after setup; the onboarding window won't auto-reopen on later
  launches because `onboarding_completed` is set. Replay is always manual via
  Settings. (Trade-off accepted: if a user closes the window mid-tour on first
  run, the tour does not auto-resume — they replay from Settings.)
- **Window size:** Grow to ≈820×660 on entering the tour to give the showcase
  visual room; exact values tunable during implementation.
