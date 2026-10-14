import type Hls from "hls.js";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { StreamInfo, StreamPlayback } from "../shared/stream";
import { apiFetch } from "./api";
import {
  mediaProgramDate,
  playbackConfig,
  playbackElapsedSeconds,
  PlaybackSynchronizer,
  playbackPresentation,
} from "./playback";

type PlaybackOptions = {
  delaySeconds: number;
  streamConfigured: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  slowConnection: boolean;
};

export function useStreamPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  { delaySeconds, streamConfigured, volume, onVolumeChange, slowConnection }: PlaybackOptions,
) {
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const liveReadyRef = useRef(false);
  const availableRef = useRef(false);
  const [liveReady, setLiveReady] = useState(false);
  const [idleReady, setIdleReady] = useState(false);
  const [startupExpired, setStartupExpired] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const playbackRef = useRef<{ play: () => void; fail: () => void } | null>(null);
  const slowConnectionRef = useRef(slowConnection);
  const volumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 0.5);
  const ticketPlaybackRef = useRef(false);
  const [syncLabel, setSyncLabel] = useState("Finding the live signal");
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const signedPlaybackRef = useRef<StreamPlayback | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"loading" | "ready" | "error" | "unsupported">(
    "loading",
  );
  const [isBuffering, setIsBuffering] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [relayStatus, setStreamInfo] = useState<StreamInfo | null>(null);
  const [streamInfoRequest, setStreamInfoRequest] = useState(0);
  const [playbackPosition, setPlaybackPosition] = useState<{
    sessionId: string;
    seconds: number;
  } | null>(null);
  const playbackSessionId = relayStatus?.running ? relayStatus.jellyfin?.sessionId : undefined;
  const playbackStartedAt = relayStatus?.jellyfin?.startedAt ?? null;
  const playbackDuration = relayStatus?.runtimeSeconds ?? null;
  const elapsedSeconds =
    liveReady && playbackPosition?.sessionId === playbackSessionId
      ? (playbackPosition?.seconds ?? null)
      : null;
  const { idlePlayback, showIdle, startingPlayback, startupFailed, playbackAccessError } =
    playbackPresentation(relayStatus, liveReady, startupExpired);
  const running = relayStatus?.running;

  useEffect(() => {
    setStartupExpired(false);
    if (!running || liveReady) return;
    const timer = setTimeout(() => setStartupExpired(true), 90_000);
    return () => clearTimeout(timer);
  }, [running, liveReady]);

  useEffect(() => {
    const idle = idleVideoRef.current;
    if (!idle || !showIdle) return;
    let disposed = false;
    idle.volume = volumeRef.current;
    idle.muted = volumeRef.current === 0;
    void idle.play().catch((error: Error) => {
      if (!disposed && error.name === "NotAllowedError") setAutoplayBlocked(true);
    });
    return () => {
      disposed = true;
      idle.muted = true;
      idle.pause();
    };
  }, [showIdle]);

  const playbackAccessMessage =
    playbackAccessError === "signing-failed"
      ? "Playback could not be authorized. An administrator needs to check playback access."
      : "Playback access was denied. An administrator needs to check playback access.";
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = new AbortController();
    let pollDelay = 10_000;

    async function checkStreamInfo() {
      try {
        const response = await apiFetch("/api/stream-info", {
          cache: "no-store",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) {
          availableRef.current = false;
          ticketPlaybackRef.current = false;
          setStreamInfo(null);
          return;
        }
        // SAFETY: /api/stream-info is produced by the matching StreamInfo server contract.
        const status = (await response.json()) as StreamInfo;
        if (stopped) return;
        if (status.running && status.online) {
          let playback = signedPlaybackRef.current;
          if (
            !playback ||
            (playback.expiresAt !== null && playback.expiresAt - Date.now() < 5 * 60 * 1000)
          ) {
            const signed = await apiFetch("/api/stream-playback", {
              cache: "no-store",
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
            });
            if (!signed.ok) throw new Error("Could not authorize stream playback");
            // SAFETY: The authenticated endpoint returns the matching StreamPlayback contract.
            const result = (await signed.json()) as StreamPlayback;
            playback = result;
            signedPlaybackRef.current = playback;
          }
          if (stopped) return;
          setPlaybackUrl(playback.url);
        }
        availableRef.current = status.running && status.online;
        ticketPlaybackRef.current = availableRef.current && liveReadyRef.current;
        pollDelay = status.running && !status.online ? 3_000 : 10_000;
        setStreamInfo(status);
        // A failed availability probe must not interrupt media that is still buffered.
        if (
          status.running &&
          !status.online &&
          liveReadyRef.current &&
          (videoRef.current?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA
        )
          return;
        setStreamOnline(status.running && status.online);
        if (!status.running) {
          setPlayerStatus("ready");
          setIsBuffering(false);
          setAutoplayBlocked(false);
        }
        if (status.running && !status.online) {
          setPlayerStatus("error");
          setIsBuffering(false);
          setAutoplayBlocked(false);
          setSyncLabel(
            status.playbackError || [401, 403].includes(status.upstreamStatus ?? 0)
              ? "Playback access denied"
              : "Stream is offline",
          );
        }
      } catch {
        if (!stopped && !request.signal.aborted) {
          availableRef.current = false;
          ticketPlaybackRef.current = false;
          setStreamInfo(null);
        }
      } finally {
        if (!stopped) timer = setTimeout(checkStreamInfo, pollDelay);
      }
    }

    void checkStreamInfo();
    return () => {
      stopped = true;
      request.abort();
      clearTimeout(timer);
    };
  }, [streamConfigured, streamInfoRequest, videoRef]);

  useEffect(() => {
    if (!playbackSessionId || playbackStartedAt === null) {
      setPlaybackPosition(null);
      return;
    }
    const sessionId = playbackSessionId;
    const video = videoRef.current;
    function updatePosition() {
      const seconds =
        video && !video.loop && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ? playbackElapsedSeconds(
              playbackStartedAt,
              mediaProgramDate(video, hlsRef.current?.playingDate ?? null),
              playbackDuration,
            )
          : null;
      setPlaybackPosition((current) => {
        if (seconds === null) return null;
        if (current && current.sessionId === sessionId && current.seconds === seconds)
          return current;
        return { sessionId, seconds };
      });
    }
    updatePosition();
    const timer = window.setInterval(updatePosition, 1_000);
    video?.addEventListener("timeupdate", updatePosition);
    video?.addEventListener("loadeddata", updatePosition);
    return () => {
      window.clearInterval(timer);
      video?.removeEventListener("timeupdate", updatePosition);
      video?.removeEventListener("loadeddata", updatePosition);
    };
  }, [playbackSessionId, playbackStartedAt, playbackDuration, videoRef]);

  useEffect(() => {
    slowConnectionRef.current = slowConnection;
    const hls = hlsRef.current;
    if (hls) Object.assign(hls.config, playbackConfig(delaySeconds, slowConnection, playbackUrl));
    if (videoRef.current) videoRef.current.playbackRate = 1;
  }, [delaySeconds, slowConnection, playbackUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    liveReadyRef.current = false;
    setLiveReady(false);
    ticketPlaybackRef.current = false;
    if (!video || !streamConfigured || !playbackUrl || streamOnline !== true) return;
    setPlayerStatus("loading");
    setIsBuffering(false);
    setAutoplayBlocked(false);
    setSyncLabel("Connecting to the stream");
    video.volume = volumeRef.current;
    // Prepare live playback silently under the clip, then hand audio over with the picture.
    video.muted = true;
    video.defaultMuted = true;
    let disposed = false;
    let failed = false;
    let attachedHls: Hls | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelFrame: (() => void) | undefined;

    function failPlayback() {
      if (disposed || failed) return;
      failed = true;
      attachedHls?.stopLoad();
      setPlayerStatus("error");
      setIsBuffering(false);
      setAutoplayBlocked(false);
      setSyncLabel("Playback failed");
      // Refresh the playlist/session after a fatal error, even while the server stays online.
      retry = setTimeout(() => setPlaybackAttempt((current) => current + 1), 10_000);
    }

    async function play() {
      if (disposed || failed || !video) return;
      try {
        await video.play();
      } catch (error) {
        if (disposed || failed) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setAutoplayBlocked(true);
          setIsBuffering(false);
          setSyncLabel("Tap to play");
        } else if (video.error) {
          failPlayback();
        }
      }
    }

    function playing() {
      if (disposed || failed) return;
      setPlayerStatus("ready");
      setIsBuffering(false);
      setAutoplayBlocked(false);
      setSyncLabel(
        slowConnectionRef.current ? "Slow connection · sync off" : "Following the live room",
      );
      if (liveReadyRef.current || cancelFrame) return;
      const reveal = () => {
        cancelFrame = undefined;
        if (
          disposed ||
          failed ||
          !video ||
          video.paused ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        )
          return;
        idleVideoRef.current?.pause();
        if (idleVideoRef.current) idleVideoRef.current.muted = true;
        liveReadyRef.current = true;
        ticketPlaybackRef.current = availableRef.current;
        video.volume = volumeRef.current;
        video.muted = volumeRef.current === 0;
        setLiveReady(true);
        // Unmuting may need a gesture on mobile; retain the usual tap-to-play fallback.
        void play();
      };
      if (video?.requestVideoFrameCallback) {
        const frame = video.requestVideoFrameCallback(reveal);
        cancelFrame = () => video.cancelVideoFrameCallback(frame);
      } else {
        const frame = requestAnimationFrame(reveal);
        cancelFrame = () => cancelAnimationFrame(frame);
      }
    }
    video.addEventListener("playing", playing);
    playbackRef.current = { play, fail: failPlayback };

    async function attachStream(media: HTMLVideoElement) {
      const { default: HlsPlayer } = await import("hls.js");
      if (disposed) return;
      // Prefer HLS.js even when native HLS is available: Android's native player
      // does not expose the timing needed for live synchronization.
      if (HlsPlayer.isSupported()) {
        const hls = new HlsPlayer(
          playbackConfig(delaySeconds, slowConnectionRef.current, playbackUrl),
        );
        attachedHls = hls;
        hlsRef.current = hls;
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) failPlayback();
        });
        hls.loadSource(playbackUrl);
        hls.attachMedia(media);
        play();
      } else if (media.canPlayType("application/vnd.apple.mpegurl")) {
        // Keep native playback for browsers without MediaSource support.
        media.src = playbackUrl;
        play();
      } else {
        setPlayerStatus("unsupported");
        setIsBuffering(false);
        setSyncLabel("HLS playback is unsupported");
      }
    }

    void attachStream(video).catch(failPlayback);
    return () => {
      disposed = true;
      clearTimeout(retry);
      cancelFrame?.();
      video.removeEventListener("playing", playing);
      liveReadyRef.current = false;
      ticketPlaybackRef.current = false;
      playbackRef.current = null;
      attachedHls?.destroy();
      if (hlsRef.current === attachedHls) hlsRef.current = null;
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
    };
  }, [delaySeconds, streamOnline, streamConfigured, playbackUrl, playbackAttempt, videoRef]);

  useEffect(() => {
    if (!liveReady) return;
    const synchronizer = new PlaybackSynchronizer();
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || playerStatus !== "ready" || autoplayBlocked) return;
      if (video.paused) {
        playbackRef.current?.play();
        return;
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        synchronizer.update(video, null, performance.now());
        setIsBuffering(true);
        setSyncLabel("Buffering the live stream...");
        return;
      }
      // Use the same media timeline as HLS. Program dates can lag the encoder's
      // wall clock and previously caused a second synchronization loop to keep seeking.
      const target = hlsRef.current
        ? hlsRef.current.liveSyncPosition
        : video.seekable.length > 0
          ? video.seekable.end(video.seekable.length - 1) - delaySeconds
          : null;
      const correction = synchronizer.update(
        video,
        target,
        performance.now(),
        !slowConnectionRef.current,
      );
      if (correction.position !== null) video.currentTime = correction.position;
      video.playbackRate = correction.rate;
      if (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
        setSyncLabel(correction.label);
    }, 1_000);
    return () => clearInterval(timer);
  }, [delaySeconds, playerStatus, streamConfigured, autoplayBlocked, liveReady, videoRef]);

  function playVisible() {
    if (streamOnline === true) playbackRef.current?.play();
    if (!liveReadyRef.current) {
      void idleVideoRef.current?.play().catch(() => setAutoplayBlocked(true));
    }
  }

  function changeVolume(value: number) {
    volumeRef.current = value;
    if (value > 0) lastAudibleVolumeRef.current = value;
    onVolumeChange(value);
    const live = videoRef.current;
    const idle = idleVideoRef.current;
    if (live) {
      live.volume = value;
      live.muted = value === 0 || !liveReadyRef.current;
    }
    if (idle) {
      idle.volume = value;
      idle.muted = value === 0 || liveReadyRef.current;
    }
    if (value > 0) playVisible();
  }

  function toggleMute() {
    changeVolume(volume === 0 ? lastAudibleVolumeRef.current : 0);
  }

  const videoEvents = {
    onCanPlay() {
      if (!liveReadyRef.current) playbackRef.current?.play();
    },
    onError() {
      playbackRef.current?.fail();
    },
    onStalled() {
      if (
        playerStatus === "ready" &&
        liveReady &&
        !autoplayBlocked &&
        (videoRef.current?.readyState ?? 0) < HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        setIsBuffering(true);
        setSyncLabel("Buffering the live stream...");
      }
    },
    onWaiting() {
      if (playerStatus !== "ready" || autoplayBlocked || !liveReady) return;
      setIsBuffering(true);
      setSyncLabel("Buffering the live stream...");
    },
    onClick() {
      if (videoRef.current?.paused) playbackRef.current?.play();
    },
  };

  return {
    hlsRef,
    idleVideoRef,
    idleReady,
    showIdle,
    startingPlayback,
    startupFailed,
    idleVideoEvents: {
      onPlaying() {
        setIdleReady(true);
        if (streamOnline !== true) setAutoplayBlocked(false);
      },
      onError() {
        setIdleReady(false);
        setPlayerStatus("error");
      },
      onClick: playVisible,
    },
    ticketPlaybackRef,
    relayStatus,
    streamOnline,
    playbackUrl,
    playerStatus,
    isBuffering,
    autoplayBlocked,
    elapsedSeconds,
    idlePlayback,
    playbackAccessError,
    playbackAccessMessage,
    syncLabel: startingPlayback
      ? "The screening is starting…"
      : idlePlayback
        ? "Between screenings"
        : syncLabel,
    setSyncLabel,
    changeVolume,
    toggleMute,
    videoEvents,
    play: playVisible,
    retryPlayback: () => setPlaybackAttempt((current) => current + 1),
    refreshStream: () => setStreamInfoRequest((current) => current + 1),
  };
}
