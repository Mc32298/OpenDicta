# First-run Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After onboarding's Finish, transition the same window into a 6-step illustrated product tour (showcase layout) with Skip and replay-from-Settings.

**Architecture:** The onboarding window gains a `phase` (`"setup"` | `"tour"`). `Onboarding.tsx` keeps the setup flow and renders a new `Tutorial.tsx` when in tour phase. Finish marks onboarding complete, resizes the window, and switches to the tour. A Rust `start_tutorial` command re-opens the window into the tour for replay. All styling reuses the existing app theme tokens (`--ink-*`, `--accent`, `Instrument Serif`, `.wv-*` classes).

**Tech Stack:** React + TypeScript (Vite), Tauri v2 (Rust), plain CSS in `src/styles.css`. No test framework in this repo — verification is `npx tsc --noEmit` plus the Claude Preview browser at the onboarding route.

---

## File Structure

- `src-tauri/src/lib.rs` — *modify*: drop the window-hide from `complete_onboarding`; add `start_tutorial` command; register it.
- `src/windows/Tutorial.tsx` — *create*: showcase-layout tour component, `TOUR_STEPS`, per-step visual components.
- `src/windows/Onboarding.tsx` — *modify*: `phase` state, Finish→tour transition + resize, `phase` URL param, `start-tutorial` listener, render `<Tutorial/>`.
- `src/styles.css` — *modify*: add `.wv-tour-*` classes + keyframes (theme tokens only).
- `src/pages/Settings.tsx` — *modify*: add a "Getting started tour" row with a Replay button.

---

## Task 1: Rust — stop auto-hiding on complete, add `start_tutorial`

**Files:**
- Modify: `src-tauri/src/lib.rs:1229-1239` (`complete_onboarding`)
- Modify: `src-tauri/src/lib.rs` (add command after `complete_onboarding`)
- Modify: `src-tauri/src/lib.rs:4147` (invoke_handler registration)

- [ ] **Step 1: Remove the window-hide from `complete_onboarding`**

The tour now takes over the window after completion, so the frontend controls visibility. Replace the existing `complete_onboarding` body (lines 1229-1239) with:

```rust
#[tauri::command]
async fn complete_onboarding(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    state.onboarding_completed.store(true, Ordering::SeqCst);
    save_app_settings(&app, state.inner().clone())?;
    Ok(())
}
```

- [ ] **Step 2: Add the `start_tutorial` command**

Insert immediately after the `complete_onboarding` function. `Emitter` (for `win.emit`) and `Manager` (for `get_webview_window`) are already in scope — `open_settings_page` uses `win.emit("navigate-to-page", ...)` and many commands call `get_webview_window`.

```rust
#[tauri::command]
async fn start_tutorial(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("onboarding") {
        let _ = win.emit("start-tutorial", ());
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "onboarding",
            tauri::WebviewUrl::App("/?window=onboarding&phase=tour".into()),
        )
        .title("OpenDicta")
        .inner_size(820.0, 660.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 3: Register the command**

In the `tauri::generate_handler![...]` list, add `start_tutorial` right after `complete_onboarding,` (line 4147):

```rust
            complete_onboarding,
            start_tutorial,
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: finishes with no errors (warnings about unused are acceptable).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add start_tutorial command, stop auto-hide on onboarding complete"
```

---

## Task 2: Create `Tutorial.tsx`

**Files:**
- Create: `src/windows/Tutorial.tsx`

- [ ] **Step 1: Write the full Tutorial component**

Create `src/windows/Tutorial.tsx` with this exact content. It defines the 6 steps, the showcase layout, and one illustrated/animated visual per step. Each step supports an optional `imageSrc` slot (the hybrid upgrade path): when set, the stage renders that image instead of the illustration.

```tsx
import { useState, type ReactNode } from "react";
import { Button } from "../ui/controls";

type TourStep = {
  id: string;
  title: string;
  body: string;
  Visual: () => ReactNode;
  imageSrc?: string;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "dictation",
    title: "How dictation works",
    body: "Hold or press your shortcut, speak, and OpenDicta transcribes locally and pastes the text straight into whatever app you're using.",
    Visual: DictationVisual,
  },
  {
    id: "toolbar",
    title: "The quick toolbar",
    body: "A small floating bar shows recording state and quick actions. Open the Quick-switch palette to jump between models and styles without leaving your keyboard.",
    Visual: ToolbarVisual,
  },
  {
    id: "models",
    title: "Changing models",
    body: "Switch transcription models any time from the Models page or the Quick-switch palette. The installed model runs fully on-device.",
    Visual: ModelsVisual,
  },
  {
    id: "ai",
    title: "AI features",
    body: "Turn raw speech into clean text. The AI page lets you auto-format, remove filler, and apply custom styles to your dictation.",
    Visual: AiVisual,
  },
  {
    id: "insights",
    title: "Insights",
    body: "See how much time you've saved versus typing, your word counts, and usage trends over time on the Insights page.",
    Visual: InsightsVisual,
  },
  {
    id: "wrap",
    title: "You're all set",
    body: "Everything lives in Settings, and you can replay this tour any time from there. Press your shortcut and start speaking.",
    Visual: WrapVisual,
  },
];

export default function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  const Visual = step.Visual;

  return (
    <div className="wv-tour">
      <button type="button" className="wv-btn wv-btn-ghost wv-tour-skip" onClick={onDone}>
        Skip tour
      </button>

      <div className="wv-tour-stage" key={step.id}>
        {step.imageSrc ? (
          <img className="wv-tour-img" src={step.imageSrc} alt={step.title} />
        ) : (
          <Visual />
        )}
      </div>

      <div className="wv-tour-copy">
        <div className="wv-onboarding-step">Step {i + 1} of {TOUR_STEPS.length}</div>
        <h1>{step.title}</h1>
        <p>{step.body}</p>
      </div>

      <div className="wv-tour-foot">
        <div className="wv-tour-dots">
          {TOUR_STEPS.map((s, n) => (
            <span key={s.id} className="wv-tour-dot" data-on={n === i ? "1" : "0"} />
          ))}
        </div>
        <div className="wv-tour-nav">
          <Button variant="ghost" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={() => (last ? onDone() : setI((n) => Math.min(TOUR_STEPS.length - 1, n + 1)))}
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DictationVisual() {
  return (
    <div className="wv-tv wv-tv-dictation">
      <span className="wv-tv-key">Ctrl</span>
      <div className="wv-tv-wave">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} style={{ animationDelay: `${n * 0.09}s` }} />
        ))}
      </div>
      <div className="wv-tv-line" />
    </div>
  );
}

function ToolbarVisual() {
  return (
    <div className="wv-tv wv-tv-toolbar">
      <div className="wv-tv-pill">
        <span className="wv-tv-rec" />
        <span className="wv-tv-bar" />
        <span className="wv-tv-bar" />
        <span className="wv-tv-dot" />
      </div>
    </div>
  );
}

function ModelsVisual() {
  return (
    <div className="wv-tv wv-tv-models">
      <div className="wv-tv-chip">Parakeet</div>
      <div className="wv-tv-chip is-active">Whisper</div>
      <div className="wv-tv-chip">Custom</div>
    </div>
  );
}

function AiVisual() {
  return (
    <div className="wv-tv wv-tv-ai">
      <div className="wv-tv-raw">um, so like, the report is, uh, done</div>
      <div className="wv-tv-arrow">→</div>
      <div className="wv-tv-clean">The report is done. <span className="wv-tv-spark">✦</span></div>
    </div>
  );
}

function InsightsVisual() {
  return (
    <div className="wv-tv wv-tv-insights">
      {[40, 65, 50, 80, 95].map((h, n) => (
        <span key={n} style={{ height: `${h}%`, animationDelay: `${n * 0.08}s` }} />
      ))}
    </div>
  );
}

function WrapVisual() {
  return (
    <div className="wv-tv wv-tv-wrap">
      <div className="wv-tv-check">✓</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks (import surface only)**

Run: `npx tsc --noEmit`
Expected: PASS. (`Button` is exported from `src/ui/controls` and already used with `variant`/`disabled`/`onClick` in `Onboarding.tsx`.) If `Button` is reported missing, open `src/ui/controls.tsx` and confirm the named export, then fix the import.

- [ ] **Step 3: Commit**

```bash
git add src/windows/Tutorial.tsx
git commit -m "feat: add Tutorial showcase component with per-step visuals"
```

---

## Task 3: Tour styles in `styles.css`

**Files:**
- Modify: `src/styles.css` (append after the onboarding block, near line 567)

- [ ] **Step 1: Append the tour CSS**

Add this block to `src/styles.css` (after the existing `.wv-onboarding-*` rules and their media query). It reuses the same theme tokens as onboarding.

```css
/* ── First-run tutorial (showcase layout) ───────────────── */
.wv-tour-card { grid-template-columns:1fr !important; }
.wv-tour { position:relative; display:flex; flex-direction:column; height:100%; padding:30px 34px 26px; min-width:0; }
.wv-tour-skip { position:absolute; top:18px; right:20px; z-index:2; }
.wv-tour-stage { flex:1; min-height:0; border-radius:16px; border:0.5px solid var(--line); background:linear-gradient(160deg, oklch(97% 0.012 150) 0%, oklch(95% 0.02 168) 100%); display:flex; align-items:center; justify-content:center; overflow:hidden; margin-bottom:18px; animation:wv-tour-fade .32s ease; }
.wv-tour-img { width:100%; height:100%; object-fit:cover; }
.wv-tour-copy { margin-bottom:14px; }
.wv-tour-copy h1 { font-family:'Instrument Serif',serif; font-size:34px; font-weight:400; letter-spacing:0; margin:2px 0 8px; color:var(--ink-1); line-height:1.05; }
.wv-tour-copy p { color:var(--ink-2); line-height:1.5; font-size:14px; margin:0; max-width:560px; }
.wv-tour-foot { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.wv-tour-dots { display:flex; gap:7px; }
.wv-tour-dot { width:7px; height:7px; border-radius:50%; background:var(--line-2); transition:background .18s, transform .18s; }
.wv-tour-dot[data-on="1"] { background:var(--ink-1); transform:scale(1.25); }
.wv-tour-nav { display:flex; gap:8px; }

@keyframes wv-tour-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

/* shared visual frame */
.wv-tv { width:100%; height:100%; display:flex; align-items:center; justify-content:center; gap:16px; }

/* 1. dictation */
.wv-tv-key { font:600 13px 'Geist',sans-serif; color:var(--ink-1); background:var(--bg-card); border:0.5px solid var(--line-2); border-radius:8px; padding:8px 14px; box-shadow:0 1px 0 var(--line); animation:wv-pulse 1.4s ease-in-out infinite; }
.wv-tv-wave { display:flex; align-items:center; gap:4px; height:46px; }
.wv-tv-wave span { width:4px; height:14px; border-radius:2px; background:var(--accent); animation:wv-eq 1s ease-in-out infinite; }
.wv-tv-line { width:120px; height:8px; border-radius:4px; background:color-mix(in oklch, var(--ink-1) 22%, transparent); }
@keyframes wv-pulse { 0%,100% { box-shadow:0 0 0 0 color-mix(in oklch, var(--accent) 40%, transparent); } 50% { box-shadow:0 0 0 7px color-mix(in oklch, var(--accent) 0%, transparent); } }
@keyframes wv-eq { 0%,100% { height:14px; } 50% { height:42px; } }

/* 2. toolbar */
.wv-tv-pill { display:flex; align-items:center; gap:10px; padding:10px 16px; border-radius:999px; background:var(--ink-1); box-shadow:0 8px 22px -10px rgba(0,0,0,0.4); animation:wv-float 2.4s ease-in-out infinite; }
.wv-tv-rec { width:12px; height:12px; border-radius:50%; background:oklch(70% 0.18 30); animation:wv-pulse-rec 1.2s ease-in-out infinite; }
.wv-tv-pill .wv-tv-bar { width:22px; height:8px; border-radius:4px; background:oklch(80% 0.01 85); }
.wv-tv-pill .wv-tv-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); }
@keyframes wv-float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-7px); } }
@keyframes wv-pulse-rec { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

/* 3. models */
.wv-tv-models { gap:12px; }
.wv-tv-chip { font:500 13px 'Geist',sans-serif; color:var(--ink-2); background:var(--bg-card); border:0.5px solid var(--line); border-radius:10px; padding:10px 16px; }
.wv-tv-chip.is-active { color:var(--ink-1); border-color:var(--ink-1); box-shadow:0 0 0 3px color-mix(in oklch, var(--accent) 22%, transparent); animation:wv-swap 2.6s ease-in-out infinite; }
@keyframes wv-swap { 0%,100% { transform:translateY(0) scale(1); } 50% { transform:translateY(-4px) scale(1.04); } }

/* 4. ai */
.wv-tv-ai { flex-direction:column; gap:10px; max-width:80%; }
.wv-tv-raw { font:13px 'Geist',sans-serif; color:var(--ink-3); background:var(--bg-card); border:0.5px solid var(--line); border-radius:10px; padding:8px 14px; }
.wv-tv-arrow { color:var(--ink-3); font-size:16px; }
.wv-tv-clean { font:500 14px 'Geist',sans-serif; color:var(--ink-1); background:var(--bg-card); border:0.5px solid var(--ink-1); border-radius:10px; padding:8px 14px; }
.wv-tv-spark { color:var(--accent); animation:wv-pulse-rec 1.4s ease-in-out infinite; }

/* 5. insights */
.wv-tv-insights { align-items:flex-end; gap:10px; height:60%; }
.wv-tv-insights span { width:26px; border-radius:6px 6px 0 0; background:linear-gradient(180deg, var(--accent), color-mix(in oklch, var(--accent) 55%, transparent)); transform-origin:bottom; animation:wv-grow .6s ease both; }
@keyframes wv-grow { from { transform:scaleY(0); } to { transform:scaleY(1); } }

/* 6. wrap */
.wv-tv-check { width:74px; height:74px; border-radius:50%; background:color-mix(in oklch, var(--ac-green) 22%, transparent); color:oklch(40% 0.14 145); display:flex; align-items:center; justify-content:center; font-size:34px; animation:wv-pop .5s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes wv-pop { from { transform:scale(0); opacity:0; } to { transform:scale(1); opacity:1; } }
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat: add tutorial showcase styles using app theme tokens"
```

---

## Task 4: Wire phase + transition into `Onboarding.tsx`

**Files:**
- Modify: `src/windows/Onboarding.tsx` (imports, state, `finish`, render, effects)

- [ ] **Step 1: Add imports**

At the top of `src/windows/Onboarding.tsx`, add the `LogicalSize` import and the `Tutorial` import. Update the existing import lines:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
```

and (next to the existing `TypingTestModal` import):

```tsx
import Tutorial from "./Tutorial";
```

- [ ] **Step 2: Add phase state + a shared `enterTour` helper**

Inside the `Onboarding` component, near the other `useState` calls (after `const [step, setStep] = useState(0);`), add:

```tsx
  const [phase, setPhase] = useState<"setup" | "tour">(
    () => (new URLSearchParams(window.location.search).get("phase") === "tour" ? "tour" : "setup"),
  );

  const enterTour = async () => {
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(820, 660));
      await win.center();
    } catch (e) {
      console.error(e);
    }
    setPhase("tour");
  };
```

- [ ] **Step 3: Resize on direct-tour mount + listen for `start-tutorial`**

Add this effect alongside the other `useEffect`s in the component:

```tsx
  useEffect(() => {
    if (phase === "tour") void enterTour();
    const un = listen("start-tutorial", () => { void enterTour(); });
    return () => { void un.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Change `finish()` to transition into the tour**

Replace the body of `finish` (currently `complete_onboarding` then `getCurrentWindow().hide()`) with:

```tsx
  const finish = async () => {
    setBusy(true);
    try {
      await invoke("complete_onboarding");
      await enterTour();
    } catch (e) {
      setStatus({ tone: "err", text: `Failed to complete onboarding: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 5: Render the tour when in tour phase**

At the very start of the component's `return` (right after the `if (loading) { ... }` block), add an early return for the tour phase:

```tsx
  if (phase === "tour") {
    return (
      <div className="wv-onboarding-wrap">
        <div className="wv-onboarding-card wv-tour-card">
          <Tutorial onDone={() => void getCurrentWindow().hide()} />
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS. If tsc reports `@tauri-apps/api/dpi` cannot be found, import `LogicalSize` from `@tauri-apps/api/window` instead (some Tauri v2 typings re-export it there) and re-run.

- [ ] **Step 7: Verify in browser — setup → tour transition**

Ensure the Vite preview server is running, then drive the onboarding route:
- Navigate to `http://localhost:1420/?window=onboarding`.
- Type a name, click Next through to step 4, click Finish.
- Expected: the window content switches to the showcase tour (large visual on top, "Step 1 of 6", Back disabled, Next enabled, "Skip tour" top-right). The `setSize`/`hide` Tauri calls no-op harmlessly in-browser.
- Navigate directly to `http://localhost:1420/?window=onboarding&phase=tour`.
- Expected: starts on the tour at step 1. Click Next through all 6 — the visual cross-fades each step, dots advance, and the final button reads "Done".

- [ ] **Step 8: Commit**

```bash
git add src/windows/Onboarding.tsx
git commit -m "feat: transition onboarding into tour on finish, support replay phase"
```

---

## Task 5: Replay button in Settings

**Files:**
- Modify: `src/pages/Settings.tsx` (Startup card, around lines 400-436)

- [ ] **Step 1: Add the Replay row to the Startup card**

In `src/pages/Settings.tsx`, inside the `Startup` card (the `<div className="card card-lg">` that contains the "Open at login" etc. `Setting` rows), add a new divider + row after the "Sounds" `Setting` (after line 435, before the closing `</div>` of that card):

```tsx
            <Divider />
            <Setting label="Getting started tour" desc="Replay the welcome walkthrough." icon={<SparkleIcon style={{ width: 18, height: 18 }} />}>
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => { invoke("start_tutorial").catch((err) => toast.showErr(`Could not open tour: ${errorText(err)}`)); }}
              >
                Replay
              </button>
            </Setting>
```

(`SparkleIcon`, `invoke`, `toast`, and `errorText` are all already imported/defined in this file.)

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Verify in browser — button renders**

- Navigate to `http://localhost:1420/?window=settings`.
- Expected: the Startup card shows a "Getting started tour" row with a "Replay" button. (Clicking calls the Tauri command, which only fully works in the packaged app; in-browser it logs an error toast — that's expected.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: add Replay tutorial button to Settings"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 2: Rust check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 3: Browser smoke of both phases**

With Vite running, confirm:
- `/?window=onboarding` → setup still looks correct (rail + 4 steps), Finish → tour.
- `/?window=onboarding&phase=tour` → all 6 tour steps navigate, visuals animate, Done present on step 6.
- `/?window=settings` → Replay row present.

- [ ] **Step 4: Confirm no regression in setup layout**

The two-column onboarding rail and its 4 steps must be visually unchanged from before (only the Finish behavior and a new early-return for tour phase were added).
```
