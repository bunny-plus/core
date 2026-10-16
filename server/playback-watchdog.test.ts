import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { watchPlayback } from "../src/webrtc";

function playback(context: TestContext, frameCallbacks = true) {
  let now = 0;
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const video = Object.assign({} as HTMLVideoElement, {
    ownerDocument: document,
    paused: false,
    currentTime: 0,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0 }),
    requestVideoFrameCallback: frameCallbacks
      ? (callback: () => void) => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        }
      : undefined,
    cancelVideoFrameCallback: (id: number) => frames.delete(id),
  });
  context.mock.timers.enable({ apis: ["setInterval"] });
  context.mock.method(performance, "now", () => now);
  const stalled = context.mock.fn();
  const resume = context.mock.fn();
  const stop = watchPlayback(video, resume, stalled);
  context.after(stop);
  return {
    video,
    frames,
    stalled,
    resume,
    stop,
    advance(seconds: number, render = false) {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        video.currentTime++;
        if (render) {
          const callbacks = [...frames.values()];
          frames.clear();
          for (const callback of callbacks) callback();
        }
        context.mock.timers.tick(1000);
      }
    },
  };
}

test("WebRTC keeps playing when Firefox's quality counter stays at zero", (context) => {
  const player = playback(context);
  player.advance(60, true);
  assert.equal(player.video.getVideoPlaybackQuality().totalVideoFrames, 0);
  assert.equal(player.stalled.mock.callCount(), 0);
  assert.equal(player.frames.size, 1);
});

test("missing video frames trigger recovery even while the media clock advances", (context) => {
  const player = playback(context);
  player.advance(5, true);
  player.advance(10);
  assert.equal(player.stalled.mock.callCount(), 0);
  player.advance(1);
  assert.equal(player.stalled.mock.callCount(), 1);
  assert.equal(player.frames.size, 0);
  player.advance(30);
  assert.equal(player.stalled.mock.callCount(), 1);
});

test("background playback gets a fresh grace period when the tab becomes visible", (context) => {
  const player = playback(context);
  player.advance(5, true);
  player.video.ownerDocument.visibilityState = "hidden";
  player.advance(60);
  assert.equal(player.stalled.mock.callCount(), 0);
  player.video.ownerDocument.visibilityState = "visible";
  player.video.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  player.advance(9);
  assert.equal(player.stalled.mock.callCount(), 0);
  player.advance(30, true);
  assert.equal(player.stalled.mock.callCount(), 0);
});

test("older browsers use playback time when frame callbacks are unavailable", (context) => {
  const player = playback(context, false);
  player.advance(60);
  assert.equal(player.stalled.mock.callCount(), 0);
});

test("stopping playback monitoring cancels its callbacks and resume attempts", (context) => {
  const player = playback(context);
  player.video.paused = true;
  player.advance(1);
  assert.equal(player.resume.mock.callCount(), 1);
  player.stop();
  assert.equal(player.frames.size, 0);
  player.advance(30);
  assert.equal(player.resume.mock.callCount(), 1);
  assert.equal(player.stalled.mock.callCount(), 0);
});
