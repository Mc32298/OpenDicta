import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialUpdateState,
  nextUpdateState,
  shouldAutoCheck,
} from "../src/lib/updater.ts";

describe("updater state", () => {
  it("tracks available -> downloading -> ready to restart", () => {
    let state = createInitialUpdateState();

    state = nextUpdateState(state, { type: "checked", version: "0.2.0", body: "Bug fixes" });
    assert.equal(state.phase, "available");
    assert.equal(state.availableVersion, "0.2.0");
    assert.equal(state.needsRestart, false);

    state = nextUpdateState(state, { type: "download-started", contentLength: 200 });
    state = nextUpdateState(state, { type: "download-progress", chunkLength: 50 });
    assert.equal(state.phase, "downloading");
    assert.equal(state.downloadedBytes, 50);
    assert.equal(state.contentLength, 200);

    state = nextUpdateState(state, { type: "installed" });
    assert.equal(state.phase, "ready");
    assert.equal(state.needsRestart, true);
  });

  it("rate limits automatic checks by timestamp", () => {
    const now = Date.UTC(2026, 4, 22, 10, 0, 0);

    assert.equal(shouldAutoCheck(null, now), true);
    assert.equal(shouldAutoCheck(now - 1_000, now), false);
    assert.equal(shouldAutoCheck(now - 7 * 60 * 60 * 1_000, now), true);
  });
});
