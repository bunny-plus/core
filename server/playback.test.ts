import assert from "node:assert/strict";
import test from "node:test";

import { playbackCorrection } from "../src/playback";

test("playback correction keeps native frame cadence and seeks only large drift", () => {
  assert.deepEqual(playbackCorrection(3), { label: "Resyncing to the live room", rate: 1, seek: true });
  assert.deepEqual(playbackCorrection(1), { label: "Following the live room", rate: 1, seek: false });
  assert.deepEqual(playbackCorrection(-1), { label: "Following the live room", rate: 1, seek: false });
  assert.deepEqual(playbackCorrection(0.2), { label: "Synced to the live room", rate: 1, seek: false });
});
