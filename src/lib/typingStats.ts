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
