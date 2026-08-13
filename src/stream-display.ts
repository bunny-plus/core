export type StreamInfo = {
  online: boolean;
  running: boolean;
  title: string | null;
  upstreamStatus: number | null;
};

type StreamInfoResponse = {
  online?: unknown;
  running?: unknown;
  title?: unknown;
  upstreamStatus?: unknown;
};

export function normalizeStreamInfo(status: StreamInfoResponse): StreamInfo {
  return {
    online: typeof status.online === "boolean" ? status.online : true,
    running: status.running === true,
    title: typeof status.title === "string" ? status.title : null,
    upstreamStatus: typeof status.upstreamStatus === "number" ? status.upstreamStatus : null,
  };
}

export function streamDisplay(status: Pick<StreamInfo, "online" | "running" | "title"> | null) {
  if (!status) return { label: "CHECKING", title: null };
  if (!status.online) return { label: "OFFLINE", title: null };
  return {
    label: "LIVE",
    title: status.running && status.title ? status.title : "24/7 stream",
  };
}
