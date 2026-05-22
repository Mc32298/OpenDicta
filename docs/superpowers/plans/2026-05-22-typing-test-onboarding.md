# Typing-Test Modal in Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive typing-speed test, opened from a button in onboarding step 2, that auto-fills the WPM field with the measured result.

**Architecture:** A self-contained React modal component (`TypingTestModal.tsx`) ported from the user's standalone HTML, styled with the app's existing `wv-*`/CSS-token system (no CDN, no native window). Onboarding step 2 renders the modal and applies its result via an `onComplete(wpm)` callback. The WPM calculation is a pure helper so the math is isolated from the DOM.

**Tech Stack:** React 19, TypeScript, Vite, Tauri. CSS in `src/styles.css` using existing tokens (`--ink-*`, `--accent`, `--ac-green`, `--ac-red`, `--bg-card`, `--line`, `Geist Mono`).

**Testing note:** This repo has no test runner and no existing `*.test.*` files; adding one is out of scope. Verification gates are `npm run build` (runs `tsc` typecheck + `vite build`) and a manual run of the onboarding window. Calculation logic is extracted into pure functions to keep it simple and inspectable.

---

### Task 1: WPM calculation helpers (pure functions)

**Files:**
- Create: `src/lib/typingStats.ts`

- [ ] **Step 1: Create the helper module**

```ts
// src/lib/typingStats.ts

/** Net words-per-minute. A "word" is 5 characters. Correct chars only. */
export function netWpm(totalTyped: number, mistakes: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const correct = Math.max(0, totalTyped - mistakes);
  const wpm = Math.round((correct / 5) / (seconds / 60));
  return Number.isFinite(wpm) && wpm > 0 ? wpm : 0;
}

/** Accuracy percentage (0-100). */
export function accuracyPct(totalTyped: number, mistakes: number): number {
  if (totalTyped <= 0) return 100;
  const pct = Math.round(((totalTyped - mistakes) / totalTyped) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** Clamp a measured WPM into the onboarding-accepted range. */
export function clampWpm(value: number): number {
  return Math.max(10, Math.min(300, Math.round(value)));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS (no TS errors). This compiles the new module; it is unused so far, which is fine.

- [ ] **Step 3: Commit**

```bash
git add src/lib/typingStats.ts
git commit -m "Add pure typing-stats helpers (net WPM, accuracy, clamp)"
```

---

### Task 2: Sample-text dictionary

**Files:**
- Create: `src/lib/typingSamples.ts`

- [ ] **Step 1: Create the sample-text module**

Port the dictionary from the source HTML verbatim (English + Danish, short/medium/long).

```ts
// src/lib/typingSamples.ts

export type SampleLang = "en" | "da";
export type SampleLength = "short" | "medium" | "long";

type SampleDict = Record<SampleLang, Record<SampleLength, string[]>>;

export const SAMPLE_TEXTS: SampleDict = {
  en: {
    short: [
      "The quick brown fox jumps over the lazy dog.",
      "To be or not to be, that is the question.",
      "All that glitters is not gold.",
      "A journey of a thousand miles begins with a single step.",
      "Practice makes perfect, so keep on typing every day.",
    ],
    medium: [
      "Design is not just what it looks like and feels like. Design is how it works. Innovation distinguishes between a leader and a follower.",
      "The only way to do great work is to love what you do. If you haven't found it yet, keep looking. Don't settle.",
      "Success is not final, failure is not fatal: it is the courage to continue that counts. Believe you can and you're halfway there.",
      "In three words I can sum up everything I've learned about life: it goes on. Life is what happens when you're busy making other plans.",
      "Typing speed tests are a fun way to improve your keyboard skills. Try to focus on accuracy first, and the speed will naturally follow over time.",
    ],
    long: [
      "Here's to the crazy ones, the misfits, the rebels, the troublemakers, the round pegs in the square holes. The ones who see things differently. They're not fond of rules. You can quote them, disagree with them, glorify or vilify them, but the only thing you can't do is ignore them because they change things. They push the human race forward, and while some may see them as the crazy ones, we see genius.",
      "We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness. That to secure these rights, Governments are instituted among Men, deriving their just powers from the consent of the governed.",
      "Software engineering is a creative and demanding profession. It requires logical thinking, problem-solving skills, and a deep understanding of computer systems. Good code is like poetry; it is elegant, concise, and easy to read. As you write code, always consider the future maintainer, who might be you six months from now.",
    ],
  },
  da: {
    short: [
      "Den hurtige brune ræv hopper over den dovne hund.",
      "At være eller ikke at være, det er spørgsmålet.",
      "Alt er ikke guld, som skinner.",
      "En rejse på tusind mil begynder med et enkelt skridt.",
      "Øvelse gør mester, så bliv ved med at skrive hver dag.",
    ],
    medium: [
      "Design er ikke kun, hvordan det ser ud og føles. Design er, hvordan det virker. Innovation skelner mellem en leder og en følger.",
      "Den eneste måde at gøre et godt stykke arbejde på, er at elske det, du laver. Hvis du ikke har fundet det endnu, så bliv ved med at lede.",
      "Succes er ikke endelig, fiasko er ikke fatal: det er modet til at fortsætte, der tæller. Tro på, at du kan, og du er halvvejs der.",
      "Med tre ord kan jeg opsummere alt, hvad jeg har lært om livet: det går videre. Livet er, hvad der sker, når du har travlt med at lægge andre planer.",
      "Skrivehastighedstests er en sjov måde at forbedre dine tastaturfærdigheder på. Prøv at fokusere på nøjagtighed først, så følger hastigheden efter.",
    ],
    long: [
      "Her er til de skøre, de utilpassede, oprørerne, ballademagerne, de runde pinde i de firkantede huller. Dem, der ser tingene anderledes. De er ikke glade for regler. Du kan citere dem, være uenige med dem, glorificere eller bagvaske dem, men det eneste, du ikke kan gøre, er at ignorere dem, fordi de ændrer tingene.",
      "Vi anser disse sandheder for at være selvindlysende, at alle mennesker er skabt lige, at de af deres Skaber er udstyret med visse ufortabelige rettigheder, at blandt disse er liv, frihed og stræben efter lykke. At for at sikre disse rettigheder er regeringer oprettet blandt mennesker.",
      "Softwareudvikling er et kreativt og krævende erhverv. Det kræver logisk tænkning, problemløsningsevner og en dyb forståelse af computersystemer. God kode er som poesi; det er elegant, kortfattet og let at læse. Når du skriver kode, skal du altid overveje den fremtidige vedligeholder.",
    ],
  },
};

export function pickSample(lang: SampleLang, length: SampleLength): string {
  const pool = SAMPLE_TEXTS[lang][length];
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/typingSamples.ts
git commit -m "Add typing-test sample text dictionary (en/da)"
```

---

### Task 3: TypingTestModal component

**Files:**
- Create: `src/windows/TypingTestModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/windows/TypingTestModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { netWpm, accuracyPct, clampWpm } from "../lib/typingStats";
import { pickSample, type SampleLang, type SampleLength } from "../lib/typingSamples";

type CharState = "pending" | "correct" | "incorrect" | "current";

export default function TypingTestModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: (wpm: number) => void;
}) {
  const [lang, setLang] = useState<SampleLang>("en");
  const [length, setLength] = useState<SampleLength>("medium");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);

  const chars = useMemo(() => text.split(""), [text]);

  const mistakes = useMemo(() => {
    let m = 0;
    for (let i = 0; i < typed.length && i < chars.length; i++) {
      if (typed[i] !== chars[i]) m++;
    }
    return m;
  }, [typed, chars]);

  const wpm = netWpm(typed.length, mistakes, seconds);
  const accuracy = accuracyPct(typed.length, mistakes);

  function reset(nextLang = lang, nextLength = length) {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setText(pickSample(nextLang, nextLength));
    setTyped("");
    setSeconds(0);
    setStarted(false);
    setFinished(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Initialise / reset whenever the modal opens.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cleanup the timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  function startTimer() {
    setStarted(true);
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }

  function handleInput(value: string) {
    if (finished) return;
    const next = value.slice(0, chars.length);
    if (!started && next.length > 0) startTimer();
    setTyped(next);

    if (next.length === chars.length && chars.length > 0) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setFinished(true);
      let m = 0;
      for (let i = 0; i < next.length; i++) if (next[i] !== chars[i]) m++;
      const finalWpm = netWpm(next.length, m, seconds || 1);
      onComplete(clampWpm(finalWpm));
    }
  }

  function charStateAt(i: number): CharState {
    if (i < typed.length) return typed[i] === chars[i] ? "correct" : "incorrect";
    if (i === typed.length) return "current";
    return "pending";
  }

  if (!open) return null;

  return (
    <div className="wv-tt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wv-tt-modal" role="dialog" aria-modal="true" onMouseDown={() => inputRef.current?.focus()}>
        <div className="wv-tt-head">
          <div className="wv-tt-title">Typing speed test</div>
          <button type="button" className="wv-btn wv-btn--ghost" onClick={onClose}>Close</button>
        </div>

        <div className="wv-tt-controls">
          <div className="wv-tt-seg">
            {(["short", "medium", "long"] as SampleLength[]).map((l) => (
              <button
                key={l}
                type="button"
                className={"wv-btn wv-btn--ghost" + (length === l ? " wv-btn-active" : "")}
                onClick={() => { setLength(l); reset(lang, l); }}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="wv-tt-seg">
            {(["en", "da"] as SampleLang[]).map((l) => (
              <button
                key={l}
                type="button"
                className={"wv-btn wv-btn--ghost" + (lang === l ? " wv-btn-active" : "")}
                onClick={() => { setLang(l); reset(l, length); }}
              >
                {l === "en" ? "English" : "Dansk"}
              </button>
            ))}
          </div>
        </div>

        <div className="wv-tt-stats">
          <div className="wv-tt-stat"><span>{wpm}</span><label>WPM</label></div>
          <div className="wv-tt-stat"><span>{accuracy}%</span><label>Accuracy</label></div>
          <div className="wv-tt-stat"><span>{seconds}s</span><label>Time</label></div>
          <div className="wv-tt-stat"><span className="wv-tt-err">{mistakes}</span><label>Errors</label></div>
        </div>

        <div className="wv-tt-display" onMouseDown={() => inputRef.current?.focus()}>
          {chars.map((c, i) => (
            <span key={i} className={"wv-tt-char wv-tt-char--" + charStateAt(i)}>{c}</span>
          ))}
        </div>

        <textarea
          ref={inputRef}
          className="wv-tt-input"
          value={typed}
          disabled={finished}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => handleInput(e.target.value)}
        />

        {finished ? (
          <div className="wv-tt-result">
            <div className="wv-tt-result-line">Measured <strong>{wpm} WPM</strong> at {accuracy}% accuracy — applied.</div>
            <div className="wv-tt-result-actions">
              <button type="button" className="wv-btn" onClick={() => reset()}>Try again</button>
              <button type="button" className="wv-btn wv-btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="wv-tt-hint">Start typing the text above. The timer begins on your first keystroke.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS. (Component is not yet imported anywhere; that is fine — it compiles standalone.)

- [ ] **Step 3: Commit**

```bash
git add src/windows/TypingTestModal.tsx
git commit -m "Add TypingTestModal component"
```

---

### Task 4: Styles for the modal

**Files:**
- Modify: `src/styles.css` (append a new block at end of file)

- [ ] **Step 1: Append the `wv-tt-*` styles**

Add at the end of `src/styles.css`:

```css
/* ── Typing-test modal (onboarding) ───────────────────── */
.wv-tt-backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: oklch(20% 0.01 85 / 0.32);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  padding: 24px;
}
.wv-tt-modal {
  width: min(720px, 100%); max-height: 90vh; overflow: auto;
  background: var(--bg-card); border: 0.5px solid var(--line);
  border-radius: 18px; box-shadow: var(--shadow-pop);
  padding: 22px; display: flex; flex-direction: column; gap: 16px;
}
.wv-tt-head { display: flex; align-items: center; justify-content: space-between; }
.wv-tt-title { font-family: 'Instrument Serif', serif; font-size: 24px; color: var(--ink-1); }
.wv-tt-controls { display: flex; gap: 16px; flex-wrap: wrap; }
.wv-tt-seg { display: flex; gap: 6px; }
.wv-tt-seg .wv-btn { height: 30px; padding: 0 12px; font-size: 12px; text-transform: capitalize; }
.wv-tt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.wv-tt-stat {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: var(--bg-sunken); border: 0.5px solid var(--line);
  border-radius: 12px; padding: 10px 6px;
}
.wv-tt-stat span { font-size: 24px; font-weight: 650; color: var(--ink-1); font-variant-numeric: tabular-nums; }
.wv-tt-stat span.wv-tt-err { color: var(--ac-red); }
.wv-tt-stat label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.wv-tt-display {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 18px; line-height: 1.8; letter-spacing: 0.03em;
  color: var(--ink-3); background: var(--bg-sunken);
  border: 0.5px solid var(--line); border-radius: 12px;
  padding: 16px; cursor: text; user-select: none; word-break: break-word;
  min-height: 120px;
}
.wv-tt-char { border-radius: 3px; padding: 0 1px; }
.wv-tt-char--correct { color: var(--ac-green); }
.wv-tt-char--incorrect { color: var(--ac-red); background: color-mix(in oklch, var(--ac-red) 16%, transparent); }
.wv-tt-char--current { background: color-mix(in oklch, var(--accent) 22%, transparent); border-bottom: 2px solid var(--accent); }
.wv-tt-input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.wv-tt-hint { font-size: 12px; color: var(--ink-3); }
.wv-tt-result { display: flex; flex-direction: column; gap: 12px; }
.wv-tt-result-line { font-size: 14px; color: var(--ink-1); }
.wv-tt-result-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

Note: `.wv-tt-input` is visually hidden but kept in-flow inside the modal so the
hidden `<textarea>` still receives focus/keystrokes. The `--shadow-pop` token is
already used by `.lock-banner`.

- [ ] **Step 2: Typecheck/build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Add styles for typing-test modal"
```

---

### Task 5: Wire the modal into onboarding step 2

**Files:**
- Modify: `src/windows/Onboarding.tsx`

- [ ] **Step 1: Import the modal**

At the top of `src/windows/Onboarding.tsx`, after the existing `prefs` import (around line 7), add:

```tsx
import TypingTestModal from "./TypingTestModal";
```

- [ ] **Step 2: Add modal open-state**

Immediately after the `const [downloadProgress, setDownloadProgress] = useState(0);` line (around line 54), add:

```tsx
  const [testOpen, setTestOpen] = useState(false);
```

- [ ] **Step 3: Add the "Test my typing speed" button in step 2**

In the `step === 2` block, inside the preset-buttons `<div>` group, add a button after the closing of the presets row. Replace this existing fragment:

```tsx
              <span className="wv-note">Not sure? The average is around 40 wpm. You can always change it later in Settings.</span>
```

with:

```tsx
              <button
                type="button"
                className="wv-btn"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setTestOpen(true)}
              >
                Test my typing speed
              </button>
              <span className="wv-note">Not sure? The average is around 40 wpm. You can always change it later in Settings.</span>
```

- [ ] **Step 4: Render the modal**

Just before the closing `</div>` of `wv-onboarding-body` — i.e. immediately after the `<div className="wv-onboarding-actions"> ... </div>` block (around line 328) and before its parent closes — add:

```tsx
          <TypingTestModal
            open={testOpen}
            onClose={() => setTestOpen(false)}
            onComplete={(measured) => {
              setWpm(measured);
              setTestOpen(false);
              setStatus({ tone: "ok", text: `Measured ${measured} wpm from the test.` });
            }}
          />
```

- [ ] **Step 5: Typecheck/build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/windows/Onboarding.tsx
git commit -m "Wire typing-test modal into onboarding step 2"
```

---

### Task 6: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Launch the app in dev**

Run: `npm run tauri:dev`
(If the Rust worker is already built, this opens the app. Otherwise it builds first.)

- [ ] **Step 2: Reach onboarding step 2**

If onboarding is already completed on this machine and does not auto-open, trigger
the onboarding window via the app's normal entry point (tray/menu). Advance to
step 2 ("Your Typing Speed").

- [ ] **Step 3: Verify the test**

Confirm each:
- Clicking "Test my typing speed" opens the modal over the onboarding window.
- Typing the displayed text: characters turn green (correct) / red (incorrect); the current character is highlighted.
- WPM / Accuracy / Time / Errors update live; the timer starts on the first keystroke.
- Length (short/medium/long) and English/Dansk toggles re-roll the text and reset stats.
- Finishing the passage closes nothing but shows the result panel, and the WPM field on step 2 now shows the measured value; the status notice reads "Measured N wpm from the test."
- "Try again" re-rolls; "Done" and "Close" / clicking the backdrop close the modal.
- Closing without finishing leaves the WPM field unchanged.

- [ ] **Step 4: Confirm production build**

Run: `npm run build`
Expected: PASS (tsc + vite build clean).

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "Fix issues found during typing-test manual verification"
```
(Skip if nothing changed.)
