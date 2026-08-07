export function playbackCorrection(drift: number) {
  const absoluteDrift = Math.abs(drift);
  const seek = absoluteDrift > 2.5;
  return {
    label:
      absoluteDrift < 0.75
        ? "Synced to the live room"
        : seek
          ? "Resyncing to the live room"
          : "Following the live room",
    rate: 1,
    seek,
  };
}
