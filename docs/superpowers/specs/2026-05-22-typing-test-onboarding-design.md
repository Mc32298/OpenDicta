# Typing-test modal in onboarding — design

Date: 2026-05-22

## Goal

In onboarding step 2 ("Your Typing Speed"), let the user measure their WPM with
an interactive typing test instead of guessing. A "Test my typing speed" button
opens an in-app modal; finishing the test auto-fills the WPM input.

## Approach

In-app modal overlay (not a native Tauri window). No new Rust commands, no CDN
dependencies. The test UI is rebuilt with the app's existing CSS token system so
it feels native to OpenDicta.

## Component: `src/windows/TypingTestModal.tsx`

Self-contained React component.

Props:
- `open: boolean` — whether the modal is shown
- `onClose(): void` — close without applying
- `onComplete(wpm: number): void` — fired once when the test finishes

Internal state:
- `lang: "en" | "da"`, `length: "short" | "medium" | "long"`
- `currentText`, per-character status, hidden-input value
- `timeElapsed`, `mistakes`, `totalTyped`, `hasStarted`, `finished`
- live `wpm`, `accuracy`, `errors`

Behavior (ported from the provided HTML, rewritten idiomatically in React):
- Module-level `SAMPLE_TEXTS` dictionary: short/medium/long for English and Danish.
- A hidden `<input>` captures keystrokes; the visible display renders each char
  in a `<span>` with `correct` / `incorrect` / `current` classes.
- Timer starts on first keystroke, ticks each second.
- Net WPM = `((totalTyped − mistakes) / 5) / (timeElapsed / 60)`, rounded, floored
  at 0. Accuracy = `round((totalTyped − mistakes) / totalTyped * 100)`.
- On reaching text length → mark finished and **immediately** call
  `onComplete(measuredWpm)` (auto-fill, no confirmation step). The modal then shows
  a result panel with the measured WPM + accuracy and two actions: "Try again"
  (re-rolls text; the next finish re-applies the new value) and "Close".
- Controls inside the modal: length selector (short/medium/long) and an En/Da
  language toggle. Changing either re-initialises the test.
- Reset whenever `open` transitions false→true.

Out of scope (YAGNI): dark-mode toggle (app theme drives appearance), test
history/persistence, separate native window.

## Integration: `src/windows/Onboarding.tsx` (step 2)

- New state `const [testOpen, setTestOpen] = useState(false)`.
- Add a "Test my typing speed" button near the WPM input (`step === 2` block).
- Render `<TypingTestModal open={testOpen} onClose={...} onComplete={...} />`.
- `onComplete(measured)` → `setWpm(clamp(measured, 10, 300))`, `setTestOpen(false)`,
  and a status notice ("Measured N wpm from the test."). User may still adjust the
  number manually before clicking Next; existing save-on-Next logic is unchanged.

## Styling: `src/styles.css`

New `wv-tt-*` classes appended to the file:
- `.wv-tt-backdrop` — `position: fixed; inset: 0`, dimmed/blurred overlay, centered.
- `.wv-tt-modal` — card using `--bg-card`, `--line`, rounded, shadow.
- `.wv-tt-stats` — WPM / accuracy / time / errors row.
- `.wv-tt-display` — monospace text area (`Geist Mono`), with
  `.wv-tt-char.correct/.incorrect/.current` states using `--accent`, `--ac-green`,
  `--ac-red`.
- `.wv-tt-controls`, `.wv-tt-result` — control row and end-of-test panel.

Reuses existing `.wv-btn`, `.wv-btn--primary`, `.wv-btn--ghost`.

## Testing

Manual verification in the running app: open onboarding, reach step 2, launch the
test, type a passage, confirm live stats update and that finishing fills the WPM
field with the measured value. Verify length + language toggles re-roll text, and
that Esc / close returns without changing WPM.
