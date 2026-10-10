import type { Fragment } from "hls.js";

type SubtitleFragment = Pick<Fragment, "start" | "end" | "programDateTime" | "level" | "cc" | "sn">;

export class SubtitleClock {
  private fragments = new Map<string, SubtitleFragment>();

  programDate(mediaTime: number, fragments: readonly SubtitleFragment[], buffered: TimeRanges) {
    function overlapsBuffer(fragment: SubtitleFragment) {
      for (let index = 0; index < buffered.length; index++) {
        if (fragment.start < buffered.end(index) && fragment.end > buffered.start(index))
          return true;
      }
      return false;
    }

    // Keep timing for buffered segments even after they leave the live playlist.
    for (const [key, fragment] of this.fragments) {
      if (!overlapsBuffer(fragment)) this.fragments.delete(key);
    }
    for (const fragment of fragments) {
      if (overlapsBuffer(fragment))
        this.fragments.set(`${fragment.level}:${fragment.cc}:${fragment.sn}`, fragment);
    }

    let matched: SubtitleFragment | null = null;
    for (const fragment of this.fragments.values()) {
      if (
        mediaTime >= fragment.start &&
        mediaTime < fragment.end &&
        (matched === null || fragment.start >= matched.start)
      )
        matched = fragment;
    }
    // Never extrapolate a previous segment's date across a seek or discontinuity.
    if (matched?.programDateTime == null || !Number.isFinite(matched.programDateTime)) return null;
    return matched.programDateTime + (mediaTime - matched.start) * 1_000;
  }
}

export function subtitleTime(
  programDateMs: number | null,
  startedAt: number | null,
  delay: number,
) {
  if (programDateMs === null || startedAt === null || !Number.isFinite(programDateMs)) return null;
  return (programDateMs - startedAt) / 1_000 - delay;
}
