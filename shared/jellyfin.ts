export type JellyfinItem = {
  id: string;
  name: string;
  title: string;
  kind: "Movie" | "Series" | "Season" | "Episode";
  year: number | null;
  minutes: number | null;
};

export type JellyfinLibrary = {
  items: JellyfinItem[];
  total: number;
  startIndex: number;
  limit: number;
};

export type JellyfinAudio = {
  index: number;
  label: string;
  default: boolean;
};

export type JellyfinSource = {
  id: string;
  name: string;
  audio: JellyfinAudio[];
  subtitles: JellyfinSubtitle[];
  fonts: number[];
  defaultAudioIndex: number | null;
  defaultSubtitleIndex: number | null;
  height: number | null;
  hdrTransfer: "smpte2084" | "arib-std-b67" | null;
};

export type JellyfinSubtitle = {
  index: number;
  label: string;
  language: string | null;
  supported: boolean;
};

export type JellyfinPlayback = {
  sessionId: string;
  itemId: string;
  mediaSourceId: string;
  // Older relay sessions have no admin-selected subtitle track.
  subtitleIndex?: number | null;
  // Estimated program date of episode time zero, measured from FFmpeg output.
  // This is independent of a viewer's HLS buffer and local computer clock.
  startedAt: number | null;
};

export type JellyfinSubtitles = {
  tracks: JellyfinSubtitle[];
  fonts: number[];
};

export type JellyfinOptions = {
  item: JellyfinItem;
  sources: JellyfinSource[];
};
