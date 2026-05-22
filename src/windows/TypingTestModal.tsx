// src/windows/TypingTestModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

  const modalRef = useRef<HTMLDivElement>(null);
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
    window.requestAnimationFrame(() => modalRef.current?.focus());
  }

  // Initialise whenever the modal opens.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  // Re-focus the modal div on any keypress so typing always works even if a
  // button stole focus momentarily.
  useEffect(() => {
    if (!open || finished) return;
    const refocus = (e: KeyboardEvent) => {
      if (document.activeElement !== modalRef.current && (e.key.length === 1 || e.key === "Backspace")) {
        modalRef.current?.focus();
      }
    };
    window.addEventListener("keydown", refocus, true);
    return () => window.removeEventListener("keydown", refocus, true);
  }, [open, finished]);

  // Detect test completion via effect so it works with keystroke-based input.
  useEffect(() => {
    if (finished || !text || typed.length === 0 || typed.length !== chars.length) return;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    let m = 0;
    for (let i = 0; i < typed.length; i++) if (typed[i] !== chars[i]) m++;
    const finalWpm = netWpm(typed.length, m, seconds || 1);
    setFinished(true);
    onComplete(clampWpm(finalWpm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  function startTimer() {
    setStarted(true);
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (finished) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      setTyped((prev) => prev.slice(0, -1));
      return;
    }

    // Ignore non-printable keys and modifier combos.
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();

    if (!started) startTimer();
    setTyped((prev) => (prev.length < chars.length ? prev + e.key : prev));
  }

  function charStateAt(i: number): CharState {
    if (i < typed.length) return typed[i] === chars[i] ? "correct" : "incorrect";
    if (i === typed.length) return "current";
    return "pending";
  }

  if (!open) return null;

  return createPortal((
    <div className="wv-tt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={modalRef}
        className="wv-tt-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={0}
        onKeyDown={handleKey}
        onMouseDown={() => modalRef.current?.focus()}
      >
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

        <div className="wv-tt-display">
          {chars.map((c, i) => (
            <span key={i} className={"wv-tt-char wv-tt-char--" + charStateAt(i)}>{c}</span>
          ))}
        </div>

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
  ), document.body);
}
