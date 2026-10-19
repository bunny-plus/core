export type VideoSample = {
  id: string;
  timestamp: number;
  bytesReceived?: number;
  framesDecoded?: number;
  framesDropped?: number;
  packetsLost?: number;
  freezeCount?: number;
  jitter?: number;
  jitterBufferDelay?: number;
  jitterBufferTargetDelay?: number;
  jitterBufferEmittedCount?: number;
};

export function videoMetrics(current: VideoSample, previous?: VideoSample) {
  const elapsed =
    previous && current.id === previous.id ? current.timestamp - previous.timestamp : 0;
  function rate(key: "bytesReceived" | "framesDecoded", scale: number) {
    const now = current[key];
    const before = previous?.[key];
    return elapsed > 0 && now !== undefined && before !== undefined && now >= before
      ? ((now - before) * scale) / elapsed
      : null;
  }
  function delay(key: "jitterBufferDelay" | "jitterBufferTargetDelay") {
    const now = current[key];
    const before = previous?.[key];
    const count = current.jitterBufferEmittedCount;
    const priorCount = previous?.jitterBufferEmittedCount;
    return elapsed > 0 &&
      now !== undefined &&
      before !== undefined &&
      now >= before &&
      count !== undefined &&
      priorCount !== undefined &&
      count > priorCount
      ? ((now - before) * 1000) / (count - priorCount)
      : null;
  }
  return {
    bitrate: rate("bytesReceived", 8000),
    fps: rate("framesDecoded", 1000),
    buffer: delay("jitterBufferDelay"),
    targetBuffer: delay("jitterBufferTargetDelay"),
    jitter: current.jitter === undefined ? null : current.jitter * 1000,
    packetsLost: current.packetsLost ?? null,
    freezes: current.freezeCount ?? null,
    droppedFrames: current.framesDropped ?? null,
  };
}
