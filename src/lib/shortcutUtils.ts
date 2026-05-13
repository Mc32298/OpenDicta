export const DEFAULT_SHORTCUT = "ControlRight";

export function normalizeShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  const key = e.key;
  if (!code) return null;
  if (
    code === "ControlRight" || code === "ControlLeft" ||
    code === "ShiftLeft" || code === "ShiftRight" ||
    code === "AltLeft" || code === "AltRight" ||
    code === "MetaLeft" || code === "MetaRight"
  ) {
    return code;
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Super");

  let base: string | null = null;
  if (/^Key[A-Z]$/.test(code)) base = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) base = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) base = code;
  else if (code === "Space") base = "Space";
  else if (code === "Enter") base = "Enter";
  else if (code === "Escape") base = "Esc";
  else if (code === "Backspace") base = "Backspace";
  else if (code === "Tab") base = "Tab";
  else if (code === "ArrowUp") base = "Up";
  else if (code === "ArrowDown") base = "Down";
  else if (code === "ArrowLeft") base = "Left";
  else if (code === "ArrowRight") base = "Right";
  else if (code === "Insert") base = "Insert";
  else if (code === "Delete") base = "Delete";
  else if (code === "Home") base = "Home";
  else if (code === "End") base = "End";
  else if (code === "PageUp") base = "PageUp";
  else if (code === "PageDown") base = "PageDown";
  else if (code === "Minus") base = "-";
  else if (code === "Equal") base = "=";
  else if (code === "BracketLeft") base = "[";
  else if (code === "BracketRight") base = "]";
  else if (code === "Backslash") base = "\\";
  else if (code === "Semicolon") base = ";";
  else if (code === "Quote") base = "'";
  else if (code === "Comma") base = ",";
  else if (code === "Period") base = ".";
  else if (code === "Slash") base = "/";
  else if (code === "Backquote") base = "`";
  else if (code === "NumpadAdd") base = "NumpadAdd";
  else if (code === "NumpadSubtract") base = "NumpadSubtract";
  else if (code === "NumpadMultiply") base = "NumpadMultiply";
  else if (code === "NumpadDivide") base = "NumpadDivide";
  else if (code === "NumpadDecimal") base = "NumpadDecimal";
  else if (/^Numpad[0-9]$/.test(code)) base = code;
  else if (key && key.length === 1) base = key.toUpperCase();
  if (!base) return null;
  parts.push(base);
  return parts.join("+");
}
