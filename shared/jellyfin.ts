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
  defaultAudioIndex: number | null;
  height: number | null;
};

export type JellyfinOptions = {
  item: JellyfinItem;
  sources: JellyfinSource[];
};
