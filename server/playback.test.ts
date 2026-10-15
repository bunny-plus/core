import assert from "node:assert/strict";
import test from "node:test";
import { playbackElapsedSeconds, playbackPresentation } from "../src/playback";

test("elapsed runtime follows encoder samples, clamps to the film duration and stops advancing on stale data", () => {
  const sample = { positionSeconds: 125.4, updatedAt: 100000 };
  assert.equal(playbackElapsedSeconds(sample, 101000), 126);
  assert.equal(playbackElapsedSeconds(sample, 101000, 126), 126);
  assert.equal(playbackElapsedSeconds(sample, 99000), 125);
  assert.equal(playbackElapsedSeconds(sample, 200000), 140);
  assert.equal(playbackElapsedSeconds(undefined, 101000), null);
  assert.equal(playbackElapsedSeconds({ positionSeconds: NaN }, 101000), null);
});

test("the idle clip covers startup until a live frame is ready, even after the playlist is online", () => {
  const idle = { running: false, online: false, title: null };
  const starting = { ...idle, running: true, title: "Next screening" };
  const online = { ...starting, online: true };
  assert.equal(playbackPresentation(idle, false, false).idlePlayback, true);
  for (const status of [starting, online]) {
    const view = playbackPresentation(status, false, false);
    assert.equal(view.showIdle, true);
    assert.equal(view.startingPlayback, true);
    assert.equal(view.playbackAccessError, undefined);
  }
  const playing = playbackPresentation(online, true, false);
  assert.equal(playing.showIdle, false);
  assert.equal(playing.startingPlayback, false);
});

test("authorization errors and a startup timeout are not hidden as normal warmup", () => {
  const status = { running: true, online: false, title: "Screening" };
  const denied = playbackPresentation({ ...status, playbackError: "access-denied" }, false, false);
  assert.equal(denied.startingPlayback, false);
  assert.equal(denied.playbackAccessError, "access-denied");
  const signing = playbackPresentation(
    { ...status, playbackError: "signing-failed" },
    false,
    false,
  );
  assert.equal(signing.startingPlayback, false);
  assert.equal(signing.playbackAccessError, "signing-failed");
  const timeout = playbackPresentation(status, false, true);
  assert.equal(timeout.showIdle, true);
  assert.equal(timeout.startingPlayback, false);
  assert.equal(timeout.startupFailed, true);
  assert.equal(playbackPresentation(status, true, true).startupFailed, false);
});

test("temporary probes do not replace playing video, and a stopped screening restores the clip immediately", () => {
  const offlineProbe = { running: true, online: false, title: "Screening" };
  assert.equal(playbackPresentation(offlineProbe, true, false).showIdle, false);
  assert.equal(playbackPresentation(null, true, false).showIdle, false);
  const stopped = playbackPresentation({ ...offlineProbe, running: false }, true, false);
  assert.equal(stopped.showIdle, true);
  assert.equal(stopped.idlePlayback, true);
  assert.equal(stopped.startingPlayback, false);
});
