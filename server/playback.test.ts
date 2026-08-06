import assert from "node:assert/strict";
import test from "node:test";

import { playbackCorrection } from "../src/playback";

test("playback correction seeks large drift and gently adjusts small drift", () => {
  assert.deepEqual(playbackCorrection(3), { label: "Catching up to the live room", rate: 1, seek: true });
  assert.equal(playbackCorrection(1).rate, 1.03);
  assert.equal(playbackCorrection(-1).rate, 0.97);
  assert.deepEqual(playbackCorrection(0.2), { label: "Synced to the live room", rate: 1, seek: false });
});
