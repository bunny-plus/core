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
    if (video.paused && !video.ended) resume();
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
