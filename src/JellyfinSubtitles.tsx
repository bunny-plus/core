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
  overlayRef: RefObject<HTMLDivElement | null>;
};

export function JellyfinSubtitles({ playback, videoRef, hlsRef, overlayRef }: Props) {
  const timingRef = useRef({ startedAt: playback.startedAt, delay: 0 });
  const [options, setOptions] = useState<SubtitleOptions | null>(null);
  const [enabled, setEnabled] = useState(() => {
    try {
      return sessionStorage.getItem("bunny-subtitles-disabled-session") !== playback.sessionId;
    } catch {
      return true;
    }
  });
  const [delay, setDelay] = useState(0);
  const [status, setStatus] = useState("Loading subtitles…");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const base = `/api/jellyfin/subtitles/${playback.sessionId}`;
  const selected = options?.tracks[0];
  const track = enabled ? (selected?.index ?? null) : null;

  function toggleSubtitles(next: boolean) {
    setEnabled(next);
    setError("");
    setStatus(next ? "Loading subtitles…" : "Subtitles are off");
    try {
      if (next) sessionStorage.removeItem("bunny-subtitles-disabled-session");
      else sessionStorage.setItem("bunny-subtitles-disabled-session", playback.sessionId);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }

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
        if (!result.tracks.length) setStatus("No subtitles were selected for this stream");
      })
      .catch((reason: Error) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => abort.abort();
  }, [base, retry]);

  useEffect(() => {
    const video = videoRef.current;
    const root = overlayRef.current;
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
  }, [base, track, options, videoRef, hlsRef, overlayRef, retry]);

  return (
    <details className={`subtitle-menu${track !== null ? " subtitle-menu--enabled" : ""}`}>
      <summary aria-label="Subtitles" title={track !== null ? "Subtitles on" : "Subtitles off"}>
        CC
      </summary>
      <div className="subtitle-panel">
        <label className="subtitle-toggle">
          <span>Enable subtitles</span>
          <input
            type="checkbox"
            checked={enabled && Boolean(selected)}
            disabled={!selected}
            onChange={(event) => toggleSubtitles(event.target.checked)}
          />
        </label>
        {selected && <p>{selected.label}</p>}
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
        <p role="status">{error || (!enabled && selected ? "Subtitles are off" : status)}</p>
        {error && (
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Reload subtitles
          </button>
        )}
      </div>
    </details>
  );
}
