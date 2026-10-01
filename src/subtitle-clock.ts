export function subtitleTime(
  programDateMs: number | null,
  startedAt: number | null,
  delay: number,
) {
  if (programDateMs === null || startedAt === null || !Number.isFinite(programDateMs)) return null;
  return (programDateMs - startedAt) / 1_000 - delay;
}
