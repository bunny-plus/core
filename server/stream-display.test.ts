import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStreamInfo, streamDisplay } from "../src/stream-display";

test("stream info remains compatible with an API that predates the online field", () => {
  assert.deepEqual(normalizeStreamInfo({ running: false, title: null }), {
    online: true,
    running: false,
    title: null,
    upstreamStatus: null,
  });
});

test("online HLS is shown as the live 24/7 stream when the relay is idle", () => {
  assert.deepEqual(streamDisplay({ online: true, running: false, title: null }), {
    label: "LIVE",
    title: "24/7 stream",
  });
});

test("an active relay replaces the 24/7 stream title", () => {
  assert.deepEqual(streamDisplay({ online: true, running: true, title: "Movie night" }), {
    label: "LIVE",
    title: "Movie night",
  });
});

test("offline and unresolved streams do not show a title", () => {
  assert.deepEqual(streamDisplay({ online: false, running: false, title: null }), {
    label: "OFFLINE",
    title: null,
  });
  assert.deepEqual(streamDisplay(null), { label: "CHECKING", title: null });
});
