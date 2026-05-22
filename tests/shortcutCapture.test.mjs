import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createShortcutCapture } from "../src/lib/shortcutCapture.ts";

function keyEvent(init) {
  return init;
}

describe("shortcut capture", () => {
  it("waits for the full key chord instead of finishing on the first modifier", () => {
    const capture = createShortcutCapture();

    assert.equal(
      capture.keyDown(keyEvent({ code: "ControlLeft", key: "Control", ctrlKey: true })),
      "ControlLeft",
    );
    assert.equal(
      capture.keyDown(keyEvent({ code: "ShiftLeft", key: "Shift", ctrlKey: true, shiftKey: true })),
      "ShiftLeft",
    );
    assert.equal(capture.keyDown(keyEvent({
      code: "Space",
      key: " ",
      ctrlKey: true,
      shiftKey: true,
    })), "Ctrl+Shift+Space");

    assert.equal(capture.keyUp(keyEvent({ code: "Space", key: " ", ctrlKey: true, shiftKey: true })), null);
    assert.equal(capture.keyUp(keyEvent({ code: "ControlLeft", key: "Control", shiftKey: true })), null);
    assert.equal(capture.keyUp(keyEvent({ code: "ShiftLeft", key: "Shift" })), "Ctrl+Shift+Space");
  });
});
