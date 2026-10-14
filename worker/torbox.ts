import type { Env } from "./env";
import { fetchJson } from "../server/upstream";

export type TorBoxFile = {
  id: number;
  infected: boolean;
  mimetype: string;
  name: string;
  short_name: string;
  size: number;
  zipped: boolean;
};

export type TorBoxTorrent = {
  download_finished: boolean;
  download_present: boolean;
  files: TorBoxFile[];
  id: number;
  name: string;
  progress: number;
  size: number;
};

export type TorBoxResponse<T> = {
  data: T;
  detail: string;
  error: string | null;
  success: boolean;
};

export async function torBox<T>(path: string, env: Env) {
  const { data: result } = await fetchJson<TorBoxResponse<T>>(`https://api.torbox.app${path}`, {
    headers: { Authorization: `Bearer ${env.TORBOX_API_KEY}` },
    maxBytes: 4000000,
    name: "TorBox",
    timeoutMs: 10000,
  });
  if (result.success !== true) {
    throw new Error("TorBox request failed");
  }
  return result.data;
}

export async function temporaryDownload(env: Env, torrentId: number, fileId: number) {
  const query = new URLSearchParams({
    file_id: String(fileId),
    token: env.TORBOX_API_KEY,
    torrent_id: String(torrentId),
    zip_link: "false",
  });
  const { data: result } = await fetchJson<TorBoxResponse<string>>(
    `https://api.torbox.app/v1/api/torrents/requestdl?${query}`,
    {
      name: "TorBox download",
      timeoutMs: 10000,
    },
  );
  if (result.success !== true) throw new Error("Could not create TorBox download URL");
  if (!result.data?.startsWith("https://"))
    throw new Error("TorBox returned an invalid download URL");
  return result.data;
}
