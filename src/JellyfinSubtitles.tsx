import type Hls from "hls.js";
import type JASSUB from "jassub";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { JellyfinPlayback, JellyfinSubtitles as SubtitleOptions } from "../shared/jellyfin";
import { apiFetch, apiJson } from "./api";
import { subtitleTime } from "./subtitle-clock";

type Props = {
  playback: JellyfinPlayback;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
};

export function JellyfinSubtitles({ playback, videoRef, hlsRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timingRef = useRef({ startedAt: playback.startedAt, delay: 0 });
  const [options, setOptions] = useState<SubtitleOptions | null>(null);
  const [track, setTrack] = useState<number | null>(null);
  const [delay, setDelay] = useState(0);
  const [status, setStatus] = useState("Loading subtitle tracks…");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const base = `/api/jellyfin/subtitles/${playback.sessionId}`;

  useEffect(() => {
    timingRef.current = { startedAt: playback.startedAt, delay };
  }, [playback.startedAt, delay]);

  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void apiJson<SubtitleOptions>(base, {
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
    })
      .then((result) => {
        if (abort.signal.aborted) return;
        setOptions(result);
        setStatus(result.tracks.length ? "Subtitles are off" : "No subtitle tracks in this file");
      })
      .catch((reason: Error) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => abort.abort();
  }, [base, retry]);

  useEffect(() => {
    const video = videoRef.current;
    const root = rootRef.current;
    if (track === null || !video || !root || !options) return;
    const abort = new AbortController();
    const canvas = document.createElement("canvas");
    canvas.className = "subtitle-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.visibility = "hidden";
    root.append(canvas);
    let renderer: JASSUB | null = null;
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let previousStatus = "";
    const observer = new ResizeObserver(resize);
    observer.observe(video);
    video.addEventListener("loadedmetadata", resize);

    function resize() {
      const ratio = video!.videoWidth / video!.videoHeight;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const width = Math.min(video!.clientWidth, video!.clientHeight * ratio);
      const height = width / ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.left = `${video!.offsetLeft + (video!.clientWidth - width) / 2}px`;
      canvas.style.top = `${video!.offsetTop + (video!.clientHeight - height) / 2}px`;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearTimeout(timeout);
      video!.cancelVideoFrameCallback?.(frame);
      video!.removeEventListener("loadedmetadata", resize);
      observer.disconnect();
      canvas.remove();
      if (renderer) {
        void renderer.destroy().catch(() => {});
        // JASSUB 2.5 destroy waits for readiness. Terminate even if worker/WASM loading failed.
        renderer._worker.terminate();
      }
    }

    function fail(message: string) {
      if (disposed) return;
      setError(message);
      dispose();
    }

    function render(now: number, metadata: VideoFrameCallbackMetadata) {
      if (disposed || !renderer) return;
      const hls = hlsRef.current;
      // playingDate describes currentTime; adjust to the frame being presented.
      let programDate = hls?.playingDate?.getTime() ?? null;
      if (programDate !== null) programDate += (metadata.mediaTime - video!.currentTime) * 1_000;
      if (!hls) {
        // Safari's native HLS exposes the playlist's wall-clock origin here.
        // SAFETY: getStartDate is an optional native WebKit media API.
        const native = video as HTMLVideoElement & { getStartDate?: () => Date };
        const origin = native.getStartDate?.().getTime();
        if (origin !== undefined && Number.isFinite(origin))
          programDate = origin + metadata.mediaTime * 1_000;
      }
      const time = subtitleTime(programDate, timingRef.current.startedAt, timingRef.current.delay);
      canvas.style.visibility = time !== null && time >= 0 ? "visible" : "hidden";
      const nextStatus =
        time === null ? "Waiting for stream timing…" : "Subtitles on · only for you";
      if (nextStatus !== previousStatus) {
        previousStatus = nextStatus;
        setStatus(nextStatus);
      }
      if (time !== null && time >= 0) {
        void renderer
          .manualRender({ ...metadata, mediaTime: time, expectedDisplayTime: now })
          .catch(() => fail("Subtitle rendering failed. Try reloading subtitles."));
      }
      frame = video!.requestVideoFrameCallback(render);
    }

    async function load() {
      setError("");
      setStatus("Loading subtitles…");
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]);
      const [module, response] = await Promise.all([
        import("jassub"),
        apiFetch(`${base}/track/${track}`, { signal }),
      ]);
      if (!response.ok)
        throw new Error("Could not load this subtitle track. Try reloading subtitles.");
      const content = await response.text();
      const fonts: Uint8Array[] = [];
      let bytes = 0;
      let missingFont = false;
      for (const index of options!.fonts) {
        try {
          const font = await apiFetch(`${base}/font/${index}`, { signal });
          if (!font.ok) throw new Error("Font unavailable");
          const data = new Uint8Array(await font.arrayBuffer());
          bytes += data.byteLength;
          if (bytes > 32_000_000) {
            missingFont = true;
            break;
          }
          fonts.push(data);
        } catch {
          missingFont = true;
          if (signal.aborted)
            throw new Error("Subtitle loading timed out. Try reloading subtitles.");
        }
      }
      if (disposed) return;
      resize();
      renderer = new module.default({
        canvas,
        subContent: content,
        fonts,
        queryFonts: false,
        maxRenderHeight: 1080,
        libassMemoryLimit: 64,
        libassGlyphLimit: 1_000,
      });
      renderer._worker.addEventListener(
        "error",
        () => fail("Your browser could not start the subtitle renderer."),
        { once: true },
      );
      timeout = setTimeout(
        () => fail("The subtitle renderer could not load. Try reloading subtitles."),
        20_000,
      );
      await renderer.ready;
      clearTimeout(timeout);
      if (disposed) return;
      if (missingFont) setError("Some fonts were unavailable; using a fallback font.");
      frame = video!.requestVideoFrameCallback(render);
    }
    void load().catch((reason: Error) => fail(reason.message));
    return dispose;
  }, [base, track, options, videoRef, hlsRef, retry]);

  return (
    <div className="jellyfin-subtitles" ref={rootRef}>
      <details className="subtitle-menu">
        <summary aria-label="Subtitles" title="Subtitles">
          CC
        </summary>
        <div className="subtitle-panel">
          <label htmlFor="subtitle-track">Subtitles</label>
          <select
            id="subtitle-track"
            value={track ?? "off"}
            onChange={(event) => {
              setTrack(event.target.value === "off" ? null : Number(event.target.value));
              setError("");
              setStatus(event.target.value === "off" ? "Subtitles are off" : "Loading subtitles…");
            }}
          >
            <option value="off">Off</option>
            {options?.tracks.map((entry) => (
              <option key={entry.index} value={entry.index} disabled={!entry.supported}>
                {entry.label}
                {entry.supported ? "" : " (unsupported format)"}
              </option>
            ))}
          </select>
          {track !== null && (
            <div className="subtitle-delay">
              <span>
                Delay: {delay > 0 ? "+" : ""}
                {delay.toFixed(1)}s
              </span>
              <button
                type="button"
                aria-label="Show subtitles 0.5 seconds earlier"
                onClick={() => setDelay((value) => Math.max(-30, value - 0.5))}
              >
                −
              </button>
              <button
                type="button"
                aria-label="Show subtitles 0.5 seconds later"
                onClick={() => setDelay((value) => Math.min(30, value + 0.5))}
              >
                +
              </button>
              <button type="button" onClick={() => setDelay(0)}>
                Reset
              </button>
            </div>
          )}
          <p role="status">{error || status}</p>
          {error && (
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              Reload subtitles
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
