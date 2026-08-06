export function playbackCorrection(drift: number) {
  const absoluteDrift = Math.abs(drift);
  return {
    label: absoluteDrift < 0.75 ? "Synced to the live room" : drift > 0 ? "Catching up to the live room" : "Holding the live delay",
    rate: absoluteDrift > 2.5 ? 1 : drift > 0.4 ? 1.03 : drift < -0.4 ? 0.97 : 1,
    seek: absoluteDrift > 2.5,
  };
}
