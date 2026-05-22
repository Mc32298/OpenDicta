import { normalizeShortcutFromEvent } from "./shortcutUtils.ts";

export type ShortcutCapture = {
  keyDown: (e: KeyboardEvent) => string | null;
  keyUp: (e: KeyboardEvent) => string | null;
  reset: () => void;
};

export function createShortcutCapture(): ShortcutCapture {
  const activeKeys = new Set<string>();
  let lastCaptured: string | null = null;

  const eventKey = (e: KeyboardEvent) => e.code || e.key;

  return {
    keyDown(e) {
      activeKeys.add(eventKey(e));
      const normalized = normalizeShortcutFromEvent(e);
      if (!normalized) return null;
      lastCaptured = normalized;
      return normalized;
    },
    keyUp(e) {
      activeKeys.delete(eventKey(e));
      if (activeKeys.size !== 0 || !lastCaptured) return null;
      const captured = lastCaptured;
      lastCaptured = null;
      return captured;
    },
    reset() {
      activeKeys.clear();
      lastCaptured = null;
    },
  };
}
