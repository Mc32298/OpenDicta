# Quick Switcher Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command-palette window opened by a global hotkey that lets the user switch the active transcription model or AI style on the fly; selecting applies the change and closes.

**Architecture:** A new borderless, transparent, always-on-top Tauri window (`quickswitch`) — same family as `voicebar` but it takes keyboard focus. A new `quick_switcher` shortcut binding (default `Ctrl+Shift+Space`) opens it through the existing global-shortcut system. The React palette loads downloaded models + available styles fresh on each open, filters as the user types, and calls the existing `set_active_model_id` / `set_ai_default_mode` commands. A shared `catalog.ts` becomes the single source of model/style id+name metadata.

**Tech Stack:** Rust, Tauri v2 (global-shortcut plugin, webview windows), React + TypeScript, Vite, `cargo test`, `npx tsc`.

Spec: `docs/superpowers/specs/2026-05-21-quick-switcher-palette-design.md`

---

### Task 1: Shared catalog module

Create one source of truth for model/style id+name metadata, consumed by the existing pages and the new palette.

**Files:**
- Create: `src/lib/catalog.ts`
- Modify: `src/pages/Style.tsx:9-18` (derive `STYLES` from catalog)
- Modify: `src/pages/Models.tsx:9-64` (derive each model's `name` from catalog)

- [ ] **Step 1: Create the catalog module**

Create `src/lib/catalog.ts`:

```ts
export interface CatalogItem {
  id: string;
  name: string;
}

// Order matches the Models page grid and useModelManager MODEL_IDS.
export const MODEL_CATALOG: CatalogItem[] = [
  { id: "parakeet",                name: "Parakeet V3" },
  { id: "qwen3_asr",               name: "Whisper Pro" },
  { id: "whisper_small",           name: "Whisper Light" },
  { id: "whisper_large",           name: "Whisper Pro+" },
  { id: "whisper_large_v3_turbo",  name: "Whisper MAX" },
];

// Order matches the Style page grid.
export const STYLE_CATALOG: CatalogItem[] = [
  { id: "raw",     name: "Raw transcript" },
  { id: "grammar", name: "Fix grammar" },
  { id: "email",   name: "Email" },
  { id: "prompt",  name: "Prompt engineering" },
  { id: "pro",     name: "Professional + todo" },
  { id: "bullets", name: "Bullet points" },
  { id: "chat",    name: "Slack message" },
  { id: "summary", name: "TL;DR summary" },
];

export function catalogName(items: CatalogItem[], id: string): string {
  return items.find((c) => c.id === id)?.name ?? id;
}
```

- [ ] **Step 2: Refactor `Style.tsx` to derive names from the catalog**

In `src/pages/Style.tsx`, replace the `STYLES` array (lines 9-18) so the `name` comes from `STYLE_CATALOG` while local-only fields (`desc`, `Ico`) stay inline. First add the import after the existing icon import (line 7):

```ts
import { STYLE_CATALOG, catalogName } from "../lib/catalog";
```

Then replace lines 9-18 with:

```ts
const STYLE_META: Record<string, { desc: string; Ico: typeof MicIcon }> = {
  raw:     { desc: "Verbatim. Nothing changed. No AI processing.", Ico: MicIcon },
  grammar: { desc: "Punctuation + sentence flow.",                 Ico: CheckIcon },
  email:   { desc: "Subject + greeting + sign-off.",               Ico: MailIcon },
  prompt:  { desc: "Reformats into a clean LLM prompt.",           Ico: CodeIcon },
  pro:     { desc: "Business tone, extracts action items.",        Ico: BriefcaseIcon },
  bullets: { desc: "Hierarchical bullet list.",                    Ico: ListIcon },
  chat:    { desc: "Short, casual, with emoji.",                   Ico: ChatIcon },
  summary: { desc: "Compresses to 3-5 sentences.",                 Ico: SparkleIcon },
};

const STYLES = STYLE_CATALOG.map((c) => ({
  id: c.id,
  name: catalogName(STYLE_CATALOG, c.id),
  desc: STYLE_META[c.id].desc,
  Ico: STYLE_META[c.id].Ico,
}));
```

- [ ] **Step 3: Refactor `Models.tsx` to derive names from the catalog**

In `src/pages/Models.tsx`, add the import after line 5 (`import { useModelManager } ...`):

```ts
import { MODEL_CATALOG, catalogName } from "../lib/catalog";
```

Then in the `MODELS` array (lines 9-64), replace each object's `name:` literal with a catalog lookup. Change each entry's name line:
- `name: "Parakeet V3",` → `name: catalogName(MODEL_CATALOG, "parakeet"),`
- `name: "Whisper Pro",` → `name: catalogName(MODEL_CATALOG, "qwen3_asr"),`
- `name: "Whisper Light",` → `name: catalogName(MODEL_CATALOG, "whisper_small"),`
- `name: "Whisper Pro+",` → `name: catalogName(MODEL_CATALOG, "whisper_large"),`
- `name: "Whisper MAX",` → `name: catalogName(MODEL_CATALOG, "whisper_large_v3_turbo"),`

Leave all other fields (`id`, `tag`, `desc`, `perf`, `qual`, `size`, `badge`, `langMode`, `langLabel`) unchanged.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (Run from the repo root `voicenote/`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog.ts src/pages/Style.tsx src/pages/Models.tsx
git commit -m "Add shared model/style catalog; derive page names from it"
```

---

### Task 2: Respawn the warm sidecar on model change

`set_active_model_id` currently only updates state — the resident worker keeps the old model until idle-offload. Make it respawn the sidecar when the model actually changes, so switches take effect immediately (required by the palette; also fixes the Models page).

**Files:**
- Modify: `src-tauri/src/lib.rs:1026-1047` (the `set_active_model_id` command)

- [ ] **Step 1: Read the current command**

Confirm the current code at `src-tauri/src/lib.rs:1026-1047` matches the `old_string` in Step 2 before editing.

- [ ] **Step 2: Respawn only when the id changes**

Replace this block:

```rust
async fn set_active_model_id(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model_id: String,
) -> Result<(), String> {
    let valid = [
        "parakeet",
        "canary_qwen_2_5b",
        "whisper_small",
        "whisper_medium",
        "whisper_large",
        "whisper_large_v3_turbo",
        "qwen3_asr",
    ];
    if !valid.contains(&model_id.as_str()) {
        return Err(format!("Unknown model id: {}", model_id));
    }
    *state.active_model_id.lock().unwrap() = model_id;
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}
```

with:

```rust
async fn set_active_model_id(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    model_id: String,
) -> Result<(), String> {
    let valid = [
        "parakeet",
        "canary_qwen_2_5b",
        "whisper_small",
        "whisper_medium",
        "whisper_large",
        "whisper_large_v3_turbo",
        "qwen3_asr",
    ];
    if !valid.contains(&model_id.as_str()) {
        return Err(format!("Unknown model id: {}", model_id));
    }
    let changed = *state.active_model_id.lock().unwrap() != model_id;
    *state.active_model_id.lock().unwrap() = model_id;
    save_app_settings(&app, state.inner().clone())?;
    if changed {
        // Restart the resident worker so the new model loads now, not after
        // the next idle-offload. Mirrors set_provider's respawn pattern.
        kill_sidecar(state.inner());
        spawn_sidecar(app.clone(), state.inner().clone());
    }
    Ok(())
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: PASS — builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Respawn sidecar on model change so hot-swap takes effect immediately"
```

---

### Task 3: Backend `quick_switcher` shortcut binding + state plumbing

Add a new optional shortcut binding alongside the existing ones, persisted in settings, with collision validation.

**Files:**
- Modify: `src-tauri/src/lib.rs` — constant (line 38), AppState field (line 113), init (line 216), `ShortcutBindings` struct (line 888-893), `get_shortcut_bindings` (1218-1225), `set_shortcut_binding` (1236-1311), `AppSettings` (895-903), default fn (near 949-955), `save_app_settings` (2140-2145), `load_app_settings` (2192-2195).

- [ ] **Step 1: Add the default constant**

After `src-tauri/src/lib.rs:38` (`const DEFAULT_REFINE_AI_SHORTCUT: &str = "Ctrl+Shift+R";`), add:

```rust
const DEFAULT_QUICK_SWITCHER_SHORTCUT: &str = "Ctrl+Shift+Space";
```

- [ ] **Step 2: Add the AppState field**

After `src-tauri/src/lib.rs:113` (`shortcut_refine_ai: Arc<Mutex<Option<String>>>,`), add:

```rust
    shortcut_quick_switcher: Arc<Mutex<Option<String>>>,
```

- [ ] **Step 3: Initialize the field**

In `AppState::new()` after the `shortcut_refine_ai` initializer (the block ending at `src-tauri/src/lib.rs:217`, which looks like `shortcut_refine_ai: Arc::new(Mutex::new(Some(DEFAULT_REFINE_AI_SHORTCUT.to_string()))),`), add:

```rust
            shortcut_quick_switcher: Arc::new(Mutex::new(Some(
                DEFAULT_QUICK_SWITCHER_SHORTCUT.to_string(),
            ))),
```

- [ ] **Step 4: Add to the `ShortcutBindings` struct**

Replace the struct at `src-tauri/src/lib.rs:887-893`:

```rust
#[derive(serde::Serialize)]
struct ShortcutBindings {
    record: String,
    push_to_talk: Option<String>,
    stop_and_discard: Option<String>,
    refine_with_ai: Option<String>,
}
```

with:

```rust
#[derive(serde::Serialize)]
struct ShortcutBindings {
    record: String,
    push_to_talk: Option<String>,
    stop_and_discard: Option<String>,
    refine_with_ai: Option<String>,
    quick_switcher: Option<String>,
}
```

- [ ] **Step 5: Populate it in `get_shortcut_bindings`**

Replace the body at `src-tauri/src/lib.rs:1218-1225`:

```rust
async fn get_shortcut_bindings(state: tauri::State<'_, SharedState>) -> Result<ShortcutBindings, String> {
    Ok(ShortcutBindings {
        record: state.shortcut.lock().unwrap().clone(),
        push_to_talk: state.shortcut_push_to_talk.lock().unwrap().clone(),
        stop_and_discard: state.shortcut_stop_discard.lock().unwrap().clone(),
        refine_with_ai: state.shortcut_refine_ai.lock().unwrap().clone(),
    })
}
```

with:

```rust
async fn get_shortcut_bindings(state: tauri::State<'_, SharedState>) -> Result<ShortcutBindings, String> {
    Ok(ShortcutBindings {
        record: state.shortcut.lock().unwrap().clone(),
        push_to_talk: state.shortcut_push_to_talk.lock().unwrap().clone(),
        stop_and_discard: state.shortcut_stop_discard.lock().unwrap().clone(),
        refine_with_ai: state.shortcut_refine_ai.lock().unwrap().clone(),
        quick_switcher: state.shortcut_quick_switcher.lock().unwrap().clone(),
    })
}
```

- [ ] **Step 6: Handle the action in `set_shortcut_binding`**

In `set_shortcut_binding` (`src-tauri/src/lib.rs:1236-1311`) there are three places to update.

(a) Add `quick_switcher` to the `other_shortcuts` array (currently `src-tauri/src/lib.rs:1255-1259`):

```rust
        let other_shortcuts = [
            state.shortcut_push_to_talk.lock().unwrap().clone(),
            state.shortcut_stop_discard.lock().unwrap().clone(),
            state.shortcut_refine_ai.lock().unwrap().clone(),
            state.shortcut_quick_switcher.lock().unwrap().clone(),
        ];
```

(b) Replace the `collides_other_action` match (currently `src-tauri/src/lib.rs:1260-1279`) so every action excludes its own index and `quick_switcher` (index 3) is handled:

```rust
        let collides_other_action = match action.as_str() {
            "push_to_talk" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 0)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            "stop_and_discard" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 1)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            "refine_with_ai" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 2)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            "quick_switcher" => other_shortcuts
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != 3)
                .flat_map(|(_, v)| v.as_ref())
                .any(|hk| hk == s),
            _ => return Err(format!("Unknown shortcut action: {}", action)),
        };
```

(c) Add `quick_switcher` to the `target` match (currently `src-tauri/src/lib.rs:1285-1290`):

```rust
    let target = match action.as_str() {
        "push_to_talk" => state.shortcut_push_to_talk.clone(),
        "stop_and_discard" => state.shortcut_stop_discard.clone(),
        "refine_with_ai" => state.shortcut_refine_ai.clone(),
        "quick_switcher" => state.shortcut_quick_switcher.clone(),
        _ => return Err(format!("Unknown shortcut action: {}", action)),
    };
```

- [ ] **Step 7: Add to `AppSettings` + default fn**

In the `AppSettings` struct, after the `shortcut_refine_ai` field (`src-tauri/src/lib.rs:902-903`):

```rust
    #[serde(default = "default_refine_ai_shortcut")]
    shortcut_refine_ai: String,
    #[serde(default = "default_quick_switcher_shortcut")]
    shortcut_quick_switcher: String,
```

Then near the other default fns (after `default_refine_ai_shortcut` at `src-tauri/src/lib.rs:954-956`), add:

```rust
fn default_quick_switcher_shortcut() -> String {
    DEFAULT_QUICK_SWITCHER_SHORTCUT.to_string()
}
```

- [ ] **Step 8: Persist in `save_app_settings`**

In `save_app_settings`, after the `shortcut_refine_ai` field assignment (`src-tauri/src/lib.rs:2140-2145`), add:

```rust
        shortcut_quick_switcher: state
            .shortcut_quick_switcher
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default(),
```

- [ ] **Step 9: Restore in `load_app_settings`**

In `load_app_settings`, after the `shortcut_refine_ai` restore block (`src-tauri/src/lib.rs:2192-2196`, which ends with `};`), add:

```rust
    *state.shortcut_quick_switcher.lock().unwrap() = if settings.shortcut_quick_switcher.trim().is_empty() {
        None
    } else {
        Some(settings.shortcut_quick_switcher)
    };
```

- [ ] **Step 10: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: PASS — builds cleanly.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Add quick_switcher shortcut binding with persistence and validation"
```

---

### Task 4: `quickswitch` window declaration, show/hide, and dispatch

Declare the window, add show/hide helpers that focus the window, dispatch the shortcut, register the binding at startup, and expose a hide command.

**Files:**
- Modify: `src-tauri/tauri.conf.json:13-32` (add the window)
- Modify: `src-tauri/src/lib.rs` — show/hide fns (near `show_voicebar` at 2424), dispatch in `handle_shortcut_pressed` (3737+), `setup_hotkey` extras list (3916-3920), new `hide_quickswitch` command + handler registration (3949+).

- [ ] **Step 1: Declare the window in `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, the `app.windows` array currently holds one object (the `voicebar`, lines 14-31). Add a second object after it (insert a comma after the voicebar object's closing `}`):

```json
      {
        "label": "quickswitch",
        "url": "/?window=quickswitch",
        "title": "OpenDicta Quick Switch",
        "width": 380,
        "height": 420,
        "decorations": false,
        "shadow": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "visible": false,
        "center": true
      }
```

- [ ] **Step 2: Add show/hide helpers**

In `src-tauri/src/lib.rs`, immediately after the `hide_voicebar` function (it ends around line 2450 with a closing `}` after the `voicebar-hide` emit), add:

```rust
fn show_quickswitch(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quickswitch") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("quickswitch-show", ());
    }
}

fn hide_quickswitch(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quickswitch") {
        let _ = win.emit("quickswitch-hide", ());
        let _ = win.hide();
    }
}
```

- [ ] **Step 3: Dispatch the shortcut in `handle_shortcut_pressed`**

In `handle_shortcut_pressed` (`src-tauri/src/lib.rs:3737+`), there is a block that reads the optional bindings and checks `stop_and_discard` then `refine_with_ai`. After the `refine_with_ai` check block (the `if refine_with_ai.as_deref() == Some(shortcut.as_str()) { ... return; }` ending around line 3762), add:

```rust
    let quick_switcher = state.shortcut_quick_switcher.lock().unwrap().clone();
    if quick_switcher.as_deref() == Some(shortcut.as_str()) {
        show_quickswitch(&app);
        return;
    }
```

- [ ] **Step 4: Register the binding at startup**

In `setup_hotkey` (`src-tauri/src/lib.rs:3916-3920`), the `for extra in [...]` array lists the optional bindings to register. Add the quick switcher to that array:

```rust
    for extra in [
        state.shortcut_push_to_talk.lock().unwrap().clone(),
        state.shortcut_stop_discard.lock().unwrap().clone(),
        state.shortcut_refine_ai.lock().unwrap().clone(),
        state.shortcut_quick_switcher.lock().unwrap().clone(),
    ] {
```

- [ ] **Step 5: Add the `hide_quickswitch` command**

Add a new command near the other window commands (e.g. after `get_voicebar_visible` at `src-tauri/src/lib.rs:1156-1158`):

```rust
#[tauri::command]
async fn hide_quickswitch_cmd(app: AppHandle) -> Result<(), String> {
    hide_quickswitch(&app);
    Ok(())
}
```

- [ ] **Step 6: Register the command in the handler list**

In the `tauri::generate_handler![...]` invocation (`src-tauri/src/lib.rs:3949+`), add `hide_quickswitch_cmd,` to the list (e.g. right after `set_active_model_id,` at line 3993):

```rust
            set_active_model_id,
            hide_quickswitch_cmd,
```

- [ ] **Step 7: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: PASS — builds cleanly. (Warnings about an unused `hide_quickswitch` are not expected since it is called by both the command and dispatch; if the frontend window does not yet exist, the window lookups simply return `None` at runtime.)

- [ ] **Step 8: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs
git commit -m "Add quickswitch window, show/hide+focus helpers, shortcut dispatch"
```

---

### Task 5: Frontend routing + QuickSwitch palette component

Route the new window and build the palette UI with data loading, filtering, keyboard navigation, apply-and-close, and dismissal on Esc/blur.

**Files:**
- Create: `src/windows/QuickSwitch.tsx`
- Modify: `src/App.tsx` (route `?window=quickswitch`)

- [ ] **Step 1: Create the palette component**

Create `src/windows/QuickSwitch.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MODEL_CATALOG, STYLE_CATALOG } from "../lib/catalog";

type Kind = "model" | "style";

interface Row {
  kind: Kind;
  id: string;
  name: string;
  active: boolean;
}

// Backend AI mode -> Style display id (mirrors Style.tsx).
function mapMode(mode: string): string {
  if (mode === "clean") return "grammar";
  if (mode === "translate") return "summary";
  if (mode === "clean_translate") return "grammar";
  return mode;
}

export default function QuickSwitch() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    // Models: keep only downloaded ones.
    const activeModel = await invoke<string>("get_active_model_id").catch(() => "");
    const modelRows: Row[] = [];
    for (const m of MODEL_CATALOG) {
      const status = await invoke<{ all_present: boolean }>("get_model_status", { modelId: m.id }).catch(() => null);
      if (status?.all_present) {
        modelRows.push({ kind: "model", id: m.id, name: m.name, active: m.id === activeModel });
      }
    }

    // Styles: all when AI on, else only "raw".
    const aiOn = await invoke<boolean>("get_ai_enabled").catch(() => false);
    const activeStyle = mapMode(await invoke<string>("get_ai_default_mode").catch(() => "raw"));
    const styleSource = aiOn ? STYLE_CATALOG : STYLE_CATALOG.filter((s) => s.id === "raw");
    const styleRows: Row[] = styleSource.map((s) => ({
      kind: "style", id: s.id, name: s.name, active: s.id === activeStyle,
    }));

    setRows([...modelRows, ...styleRows]);
    setQuery("");
    setHighlight(0);
  }

  // Reload + focus every time the window is shown.
  useEffect(() => {
    void loadData();
    inputRef.current?.focus();
    const un = listen("quickswitch-show", () => {
      void loadData();
      inputRef.current?.focus();
    });
    return () => { void un.then((f) => f()); };
  }, []);

  // Close when the window loses focus (click-away).
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void invoke("hide_quickswitch_cmd");
    });
    return () => { void un.then((f) => f()); };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  // Keep highlight in range as the filtered list changes.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  async function applyRow(row: Row) {
    if (row.kind === "model") {
      await invoke("set_active_model_id", { modelId: row.id }).catch(console.error);
    } else {
      await invoke("set_ai_default_mode", { mode: row.id }).catch(console.error);
    }
    await invoke("hide_quickswitch_cmd").catch(() => {});
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      void invoke("hide_quickswitch_cmd");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[highlight];
      if (row) void applyRow(row);
    }
  }

  return (
    <div className="qs-root">
      <input
        ref={inputRef}
        className="qs-search"
        placeholder="Switch model or style…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <div className="qs-list">
        {filtered.length === 0 && <div className="qs-empty">No matches</div>}
        {filtered.map((row, i) => (
          <button
            key={`${row.kind}:${row.id}`}
            type="button"
            className={"qs-item" + (i === highlight ? " qs-item-on" : "")}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => void applyRow(row)}
          >
            <span className="qs-item-name">
              {row.name}
              {row.active && <span className="qs-item-active">active</span>}
            </span>
            <span className="qs-item-kind">{row.kind}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Route the window in `App.tsx`**

In `src/App.tsx`, add a lazy import and a route. After line 17 (`const EmptyStates = lazy(...)`), add:

```tsx
const QuickSwitch = lazy(() => import("./windows/QuickSwitch"));
```

Add the eager import alongside the others (after line 13, the `else if (windowName === "empty")` line):

```tsx
else if (windowName === "quickswitch") void import("./windows/QuickSwitch");
```

Then add the route before the final `return <VoiceBar />;` (line 48):

```tsx
  if (windowName === "quickswitch") return <Suspense fallback={null}><QuickSwitch /></Suspense>;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/windows/QuickSwitch.tsx src/App.tsx
git commit -m "Add QuickSwitch palette component and window routing"
```

---

### Task 6: Palette styling

Style the borderless palette to match the app's refined look (rounded card, search field, list rows, highlight). The window is transparent, so the root element draws the card.

**Files:**
- Modify: `src/styles.css` (append palette styles at end of file)

- [ ] **Step 1: Append styles**

Append to `src/styles.css`:

```css
/* ─── Quick Switcher palette ─── */
.qs-root {
  height: 100vh; box-sizing: border-box; padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
  background: var(--bg-card);
  border: 0.5px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 24px 60px -24px rgba(0,0,0,0.45);
  overflow: hidden;
  font-family: inherit;
}
.qs-search {
  flex: 0 0 auto; height: 40px; padding: 0 12px;
  border: 0.5px solid var(--line); border-radius: 10px;
  background: var(--bg-sunken); color: var(--ink-1);
  font: inherit; font-size: 14px; outline: none;
}
.qs-search:focus { border-color: var(--ink-3); }
.qs-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.qs-empty { padding: 14px 12px; color: var(--ink-3); font-size: 13px; text-align: center; }
.qs-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 9px 11px; border: 0; border-radius: 8px;
  background: transparent; color: var(--ink-1);
  font: inherit; font-size: 13px; cursor: pointer; text-align: left;
}
.qs-item-on { background: var(--bg-sunken); }
.qs-item-name { display: flex; align-items: center; gap: 8px; }
.qs-item-active {
  font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: #1a1a1a; background: var(--accent); border-radius: 5px; padding: 1px 6px;
}
.qs-item-kind { font-size: 11px; color: var(--ink-3); text-transform: lowercase; }
```

- [ ] **Step 2: Type-check (sanity, CSS only)**

Run: `npx tsc --noEmit`
Expected: PASS — no errors (CSS change does not affect types; this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Style the quick switcher palette"
```

---

### Task 7: Settings row to rebind the quick switcher shortcut

Expose the new binding in Settings so it is visible and rebindable, matching the other shortcut rows.

**Files:**
- Modify: `src/pages/Settings.tsx` — `ShortcutBindings` type (19-24), default `shortcuts` state (53-58), both `setShortcuts` merges (101-107 and 213-219), the `actionMap` (200-204), the `beginCapture` key union (542-543), and the shortcut list JSX (near line 470).

- [ ] **Step 1: Extend the `ShortcutBindings` type**

In `src/pages/Settings.tsx`, replace the type (lines 19-24):

```tsx
type ShortcutBindings = {
  record: string;
  push_to_talk: string | null;
  stop_and_discard: string | null;
  refine_with_ai: string | null;
};
```

with:

```tsx
type ShortcutBindings = {
  record: string;
  push_to_talk: string | null;
  stop_and_discard: string | null;
  refine_with_ai: string | null;
  quick_switcher: string | null;
};
```

- [ ] **Step 2: Add to the default `shortcuts` state**

Replace the `useState` initializer (lines 53-58):

```tsx
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({
    record: "ControlRight",
    pushToTalk: "Hold Fn",
    stop: "Esc",
    refine: "Ctrl+Shift+R",
  });
```

with:

```tsx
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({
    record: "ControlRight",
    pushToTalk: "Hold Fn",
    stop: "Esc",
    quick: "Ctrl+Shift+Space",
  });
```

Note: the `refine` entry is removed (its row was already deleted) and replaced by `quick`.

- [ ] **Step 3: Update the mount-time `setShortcuts` merge**

Replace the merge inside the `get_shortcut_bindings` effect (lines 101-107):

```tsx
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          refine: bindings.refine_with_ai ?? prev.refine,
        }));
```

with:

```tsx
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          quick: bindings.quick_switcher ?? prev.quick,
        }));
```

- [ ] **Step 4: Update the `actionMap`**

Replace the `actionMap` (lines 200-204):

```tsx
      const actionMap: Record<Exclude<keyof typeof shortcuts, "record">, "push_to_talk" | "stop_and_discard" | "refine_with_ai"> = {
        pushToTalk: "push_to_talk",
        stop: "stop_and_discard",
        refine: "refine_with_ai",
      };
```

with:

```tsx
      const actionMap: Record<Exclude<keyof typeof shortcuts, "record">, "push_to_talk" | "stop_and_discard" | "quick_switcher"> = {
        pushToTalk: "push_to_talk",
        stop: "stop_and_discard",
        quick: "quick_switcher",
      };
```

- [ ] **Step 5: Update the post-capture `setShortcuts` merge**

Replace the merge in the error-recovery branch (lines 213-219):

```tsx
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          refine: bindings.refine_with_ai ?? prev.refine,
        }));
```

with:

```tsx
        setShortcuts((prev) => ({
          ...prev,
          record: bindings.record,
          pushToTalk: bindings.push_to_talk ?? prev.pushToTalk,
          stop: bindings.stop_and_discard ?? prev.stop,
          quick: bindings.quick_switcher ?? prev.quick,
        }));
```

- [ ] **Step 6: Update the `beginCapture` key union**

Replace the `beginCapture` signature (lines 542-543):

```tsx
  key: "record" | "pushToTalk" | "stop" | "refine",
  setEditingShortcut: (v: "record" | "pushToTalk" | "stop" | "refine" | null) => void,
```

with:

```tsx
  key: "record" | "pushToTalk" | "stop" | "quick",
  setEditingShortcut: (v: "record" | "pushToTalk" | "stop" | "quick" | null) => void,
```

- [ ] **Step 7: Add the Settings row**

In the shortcut card JSX, after the "Stop and discard" `<Shortcut .../>` line (the last shortcut row, near `src/pages/Settings.tsx:470`), add:

```tsx
            <Divider />
            <Shortcut label="Quick switcher" value={captureValue(editingShortcut === "quick", capturePreview, shortcuts.quick)} editing={editingShortcut === "quick"} onEdit={() => beginCapture("quick", setEditingShortcut, setCapturePreview)} />
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "Add Settings row to rebind the quick switcher shortcut"
```

---

### Task 8: Manual verification

**Files:** none (runtime check)

- [ ] **Step 1: Build and run the app**

Run: `npm run tauri dev` (from `voicenote/`)

- [ ] **Step 2: Open the palette**

Press `Ctrl+Shift+Space`.
Expected: a small centered palette appears with the search field focused (you can type immediately without clicking).

- [ ] **Step 3: Filter and keyboard-navigate**

Type part of a model or style name.
Expected: the list filters across both groups; Arrow Up/Down move the highlight; the highlight wraps at the ends.

- [ ] **Step 4: Apply a model with Enter**

Highlight a downloaded model row, press Enter.
Expected: the palette closes; the active model changes (verify the next dictation uses it — e.g. switch between Parakeet and a Whisper model and confirm behavior/latency differs).

- [ ] **Step 5: Apply a style by click**

Open the palette again, click a style row.
Expected: the palette closes and the active style updates (confirm on the Style tab that the selection matches).

- [ ] **Step 6: Esc and click-away dismissal**

Open the palette, press Esc → it closes without changing anything. Open again, click another window → it closes (blur dismissal).

- [ ] **Step 7: Undownloaded models hidden**

With at least one model not downloaded, open the palette.
Expected: only downloaded models appear; undownloaded ones are absent.

- [ ] **Step 8: AI-off shows only Raw**

Turn AI off (AI tab), open the palette.
Expected: the only style row is "Raw transcript"; models still listed.

- [ ] **Step 9: Rebind via Settings**

On the Settings tab, change the "Quick switcher" shortcut to another key (e.g. `Ctrl+Shift+M`), then trigger it.
Expected: the new shortcut opens the palette; the old one no longer does.

---

## Self-Review Notes

- **Spec coverage:**
  - Window (borderless, transparent, focus-taking) → Task 4 Step 1-2, Task 5.
  - Trigger (`quick_switcher` binding, default `Ctrl+Shift+Space`) → Task 3, Task 4 Step 3-4.
  - Data flow (downloaded models, AI-on/off styles, active markers, filter, keyboard nav, apply+close) → Task 5 Step 1.
  - Style id mapping (reuse Style page contract) → Task 5 `mapMode` mirrors `Style.tsx`.
  - Shared catalog (single source of id+name) → Task 1.
  - Edge cases (empty filter, undownloaded hidden, AI-off only Raw, Esc/blur close) → Task 5 + Task 8.
  - Model switch must respawn warm sidecar → Task 2.
  - Rebindable via Settings → Task 7.
- **Placeholders:** none — all steps contain concrete code and exact commands.
- **Type consistency:** `ShortcutBindings` gains `quick_switcher` in both Rust (Task 3 Step 4) and TS (Task 7 Step 1); the TS `shortcuts` map uses key `quick` mapped to action `quick_switcher` consistently across the state init, both merges, `actionMap`, `beginCapture`, and the JSX row. `hide_quickswitch_cmd` is the command name used by both the frontend (`invoke("hide_quickswitch_cmd")`) and the handler registration. `get_model_status` returns `{ all_present }`, matching `useModelManager`. The palette imports `MODEL_CATALOG`/`STYLE_CATALOG` defined in Task 1.
- **Note on the removed `refine` row:** the Settings shortcut row for "Refine with AI" was already removed in earlier work; Task 7 removes its remaining `refine` state key and replaces it with `quick`. The backend `refine_with_ai` binding remains intact (Task 3 leaves it untouched), so no backend behavior is lost.
