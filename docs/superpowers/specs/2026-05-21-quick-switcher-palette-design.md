# Quick Switcher Palette — Design

**Date:** 2026-05-21
**Status:** Approved

## Problem

Changing the transcription model or the AI output style currently requires
opening the settings window and navigating to the Models or Style tab. There is
no fast way to switch on the fly — for example, jumping from Parakeet (fast
dictation) to Whisper MAX (high-accuracy transcript), or from "Raw" to "Email"
style — without breaking flow.

## Goal

A command-palette-style quick switcher, opened by a dedicated global hotkey from
anywhere, that lets the user pick a model or style by typing/arrowing. Selecting
applies the change (persisted, exactly like changing it in Settings) and closes
the palette. The next recording uses the new setting.

## Approach: borderless focus-taking window + command palette

### Window

A new Tauri window `quickswitch`, in the same family as the existing `voicebar`
window: borderless, transparent, always-on-top, `skipTaskbar`, centered, hidden
by default. Unlike the voicebar, it **takes keyboard focus** when shown so the
search field is immediately live.

- Defined in `src-tauri/tauri.conf.json` `app.windows[]`.
- Routed in `src/App.tsx` via the `?window=quickswitch` query param.
- Rendered by a new component `src/windows/QuickSwitch.tsx`.

Suggested dimensions: width 380, height 420, `decorations: false`,
`transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`,
`resizable: false`, `visible: false`, `center: true`.

### Trigger

A new shortcut binding `quick_switcher` is added to the existing shortcut system
(alongside `record`, `push_to_talk`, `stop_and_discard`). Default:
`Ctrl+Shift+Space`.

- The shortcut handler (`handle_shortcut_pressed`) detects the `quick_switcher`
  binding and calls a new `show_quickswitch(app)` which mirrors `show_voicebar`
  but also calls `win.set_focus()`.
- Esc, a selection, or window blur calls `hide_quickswitch(app)`.

### Data flow

When the window becomes visible, `QuickSwitch.tsx` loads fresh state on each
open (re-fetch on the `quickswitch-show` event), so it always reflects current
settings:

1. **Models** — for each model in the shared catalog, call `get_model_status`;
   keep only those with `all_present === true`. Mark the active one via
   `get_active_model_id`.
2. **Styles** — call `get_ai_enabled`. If true, include all styles from the
   shared catalog. If false, include only the `raw` style. Mark the active one
   via `get_ai_default_mode`.

Both groups are merged into one flat, filterable list. Each row shows the name
and a muted tag: `· model` or `· style`.

Interaction:
- Typing filters rows by name (case-insensitive substring) across both groups.
- Arrow Up/Down move a highlight; the highlight wraps.
- Enter selects the highlighted row.
- Mouse click selects a row directly.
- Esc or window blur closes without applying.

On select:
- Model row → `invoke("set_active_model_id", { modelId })` (re-spawns the
  sidecar with the new model in the background, same path the Models page uses).
- Style row → `invoke("set_ai_default_mode", { mode })`.
- Then immediately `invoke("hide_quickswitch")` (or the window hides itself via
  `getCurrentWindow().hide()`), returning OS focus to the previous app.

### Style id mapping note

The Style page maps backend AI modes to display ids (e.g. backend `clean` →
`grammar`, `translate` → `summary`). The shared catalog stores the **display**
ids and names. `set_ai_default_mode` is called with the same id the Style page
sends today (the palette reuses the Style page's existing `chooseStyle`
contract). No new mapping logic is introduced — the palette imports the same
catalog the Style page uses.

## Shared catalog

Model and style `{ id, name }` metadata currently lives inline in
`src/pages/Models.tsx` (the `MODELS` array) and `src/pages/Style.tsx` (the
`STYLES` array). Extract the id+name+ordering into a shared module
`src/lib/catalog.ts`:

```ts
export interface CatalogItem { id: string; name: string; }
export const MODEL_CATALOG: CatalogItem[] = [ /* parakeet, qwen3_asr, whisper_small, whisper_large, whisper_large_v3_turbo */ ];
export const STYLE_CATALOG: CatalogItem[] = [ /* raw, grammar, email, prompt, pro, bullets, chat, summary */ ];
```

`Models.tsx` and `Style.tsx` keep their richer per-item fields (descriptions,
icons, perf/qual, langMode) but derive id+name from the catalog so there is one
source of truth for the set of ids and their display names. `QuickSwitch.tsx`
imports the catalog directly.

## Edge cases

- **Empty filter result:** show a single muted "No matches" row; Enter does
  nothing.
- **Undownloaded models:** hidden entirely (only `all_present` models listed).
  The active model is always downloaded, so the list is never empty of models.
- **AI off:** style group shows only `raw`.
- **Switch while recording:** no special handling — `set_active_model_id` is the
  same command Settings uses; behavior is identical to switching from the
  Models page.

## Out of scope (YAGNI)

- Showing greyed-out/unavailable items (decided: hide instead).
- "Set and start recording" in one motion (decided: set and close only).
- Staying open for multiple changes (decided: pick one, close).
- Per-recording one-shot overrides (selection persists like Settings).
- Reordering, favorites, or recently-used sorting.

## Testing

- **Rust unit test:** the `quick_switcher` binding registers and validates
  through the existing shortcut registration path (mirrors existing binding
  tests).
- **Frontend:** type-check `src/lib/catalog.ts` and the refactors in
  `Models.tsx` / `Style.tsx` that consume it.
- **Manual checklist:**
  1. Hotkey opens the palette and the search field has focus.
  2. Typing filters across both models and styles.
  3. Enter on a highlighted row applies and closes.
  4. Esc closes without applying.
  5. Clicking outside the window (blur) closes it.
  6. Selecting a model actually switches the active model (verify next
     transcription uses it).
  7. Selecting a style changes the active style.
  8. With AI disabled, only "Raw" appears in the style group.

## Components summary

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `tauri.conf.json` window | Declares the `quickswitch` window | — |
| `App.tsx` routing | Renders `QuickSwitch` for `?window=quickswitch` | QuickSwitch |
| `QuickSwitch.tsx` | Palette UI, filtering, keyboard nav, apply+close | catalog, Tauri commands |
| `catalog.ts` | Single source of model/style id+name metadata | — |
| `quick_switcher` binding + `show/hide_quickswitch` (Rust) | Global hotkey opens/focuses/hides the window | existing shortcut system |
