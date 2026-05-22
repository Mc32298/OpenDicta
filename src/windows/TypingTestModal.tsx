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
