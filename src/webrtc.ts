import type { StreamPlayback } from "../shared/stream";

export function watchPlayback(video: HTMLVideoElement, resume: () => void, onStall: () => void) {
  let lastProgress = performance.now();
  let lastTime = video.currentTime;
  let frame: number | undefined;
  const progress = () => {
    lastProgress = performance.now();
  };
  const onFrame = () => {
    progress();
    frame = video.requestVideoFrameCallback(onFrame);
  };
  if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(onFrame);
  video.ownerDocument.addEventListener("visibilitychange", progress);
  const timer = setInterval(() => {
    if (video.ownerDocument.visibilityState === "hidden") {
      progress();
      return;
    }
    if (video.paused) resume();
    if (frame === undefined && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      progress();
    }
    if (performance.now() - lastProgress > 10_000) {
      stop();
      onStall();
    }
  }, 1000);
  function stop() {
    clearInterval(timer);
    if (frame !== undefined) video.cancelVideoFrameCallback(frame);
    video.ownerDocument.removeEventListener("visibilitychange", progress);
  }
  return stop;
}

export function connectPlayback(
  video: HTMLVideoElement,
  negotiate: (sdp: string) => Promise<StreamPlayback>,
  release: (session: string) => Promise<void>,
  onDisconnect: () => void,
) {
  const peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  const media = new MediaStream();
  let closed = false;
  let session: string | undefined;
  let disconnected: ReturnType<typeof setTimeout> | undefined;
  let cancelGather: (() => void) | undefined;
  const deadline = setTimeout(onDisconnect, 25_000);
  video.srcObject = media;
  peer.addTransceiver("video", { direction: "recvonly" });
  peer.addTransceiver("audio", { direction: "recvonly" });
  peer.ontrack = ({ track }) => {
    media.addTrack(track);
    track.onended = onDisconnect;
  };
  peer.onconnectionstatechange = () => {
    clearTimeout(disconnected);
    if (peer.connectionState === "connected") clearTimeout(deadline);
    if (peer.connectionState === "failed") onDisconnect();
    if (peer.connectionState === "disconnected") disconnected = setTimeout(onDisconnect, 5000);
  };

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(deadline);
    clearTimeout(disconnected);
    cancelGather?.();
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    for (const track of media.getTracks()) {
      track.onended = null;
      track.stop();
    }
    peer.close();
    if (video.srcObject === media) video.srcObject = null;
    if (session) void release(session).catch(() => {});
  }

  const ready = (async () => {
    try {
      await peer.setLocalDescription(await peer.createOffer());
      if (closed) return;
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            peer.removeEventListener("icegatheringstatechange", changed);
            cancelGather = undefined;
            resolve();
          };
          const changed = () => {
            if (peer.iceGatheringState === "complete") finish();
          };
          const timer = setTimeout(finish, 3000);
          cancelGather = finish;
          peer.addEventListener("icegatheringstatechange", changed);
          changed();
        });
      if (closed) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Could not prepare playback");
      const result = await negotiate(sdp);
      if (closed) {
        await release(result.session).catch(() => {});
        return;
      }
      session = result.session;
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) {
      close();
      throw error;
    }
  })();
  return { peer, ready, close };
}
