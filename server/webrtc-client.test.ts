import assert from "node:assert/strict";
import test from "node:test";
import { connectPlayback, setPlaybackBuffer } from "../src/webrtc";

class TestPeer extends EventTarget {
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription = { sdp: "v=0\r\no=offer" };
  ontrack = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: string[] = [];
  receiver = { jitterBufferTarget: 0 };
  rejected = false;
  addTransceiver(kind: string, options: { direction: string }) {
    assert.equal(options.direction, "recvonly");
    this.transceivers.push(kind);
  }
  createOffer() {
    return Promise.resolve(this.localDescription);
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    return this.rejected ? Promise.reject(new Error("Invalid answer")) : Promise.resolve();
  }
  getReceivers() {
    return [this.receiver];
  }
  close() {
    this.connectionState = "closed";
  }
}
class TestStream {
  getTracks() {
    return [];
  }
}
function browser(context: import("node:test").TestContext) {
  for (const [name, value] of [
    ["RTCPeerConnection", TestPeer],
    ["MediaStream", TestStream],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  // SAFETY: This minimal media mock covers the srcObject lifecycle used by connectPlayback.
  return { srcObject: null } as HTMLVideoElement;
}

test("closing during negotiation releases the late server session without attaching it", async (context) => {
  const video = browser(context);
  let resolve!: (result: { sdp: string; session: string }) => void;
  let started!: () => void;
  const negotiating = new Promise<void>((r) => {
    started = r;
  });
  const answer = new Promise<{ sdp: string; session: string }>((r) => {
    resolve = r;
  });
  const released: string[] = [];
  const connection = connectPlayback(
    video,
    () => {
      started();
      return answer;
    },
    async (session) => {
      released.push(session);
    },
    () => {},
  );
  await negotiating;
  connection.close();
  resolve({ sdp: "v=0", session: "late-session" });
  await connection.ready;
  assert.equal(video.srcObject, null);
  assert.equal(connection.peer.connectionState, "closed");
  assert.deepEqual(released, ["late-session"]);
  connection.close();
  assert.equal(released.length, 1);
});

test("a rejected answer closes the peer and releases its resource", async (context) => {
  const video = browser(context);
  const released: string[] = [];
  const connection = connectPlayback(
    video,
    async () => ({ sdp: "bad", session: "session" }),
    async (session) => {
      released.push(session);
    },
    () => {},
  );
  // SAFETY: The constructor above is replaced by this test's peer implementation.
  assert.ok(connection.peer instanceof TestPeer);
  connection.peer.rejected = true;
  await assert.rejects(connection.ready, /Invalid answer/);
  assert.equal(video.srcObject, null);
  assert.equal(connection.peer.connectionState, "closed");
  assert.deepEqual(released, ["session"]);
});

test("receive-only playback applies optional buffering and connection failure triggers recovery", async (context) => {
  const video = browser(context);
  let failures = 0;
  const connection = connectPlayback(
    video,
    async () => ({ sdp: "v=0", session: "session" }),
    async () => {},
    () => {
      failures++;
    },
  );
  context.after(connection.close);
  await connection.ready;
  // SAFETY: The constructor above is replaced by this test's peer implementation.
  const peer = connection.peer;
  assert.ok(peer instanceof TestPeer);
  assert.deepEqual(peer.transceivers, ["video", "audio"]);
  setPlaybackBuffer(connection.peer, true);
  assert.equal(peer.receiver.jitterBufferTarget, 1000);
  setPlaybackBuffer(connection.peer, false);
  assert.equal(peer.receiver.jitterBufferTarget, 100);
  peer.connectionState = "failed";
  peer.onconnectionstatechange?.();
  assert.equal(failures, 1);
  connection.close();
  assert.equal(peer.onconnectionstatechange, null);
});
