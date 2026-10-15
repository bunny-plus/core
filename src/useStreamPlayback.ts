import { useEffect, useRef, useState, type RefObject } from "react";
import type { StreamInfo, StreamPlayback } from "../shared/stream";
import { ApiError, apiFetch, apiJson } from "./api";
import { connectPlayback, setPlaybackBuffer } from "./webrtc";
import { playbackElapsedSeconds, playbackPresentation } from "./playback";

type PlaybackOptions = {
  streamConfigured: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  slowConnection: boolean;
};

export function useStreamPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  { streamConfigured, volume, onVolumeChange, slowConnection }: PlaybackOptions,
) {
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const liveReadyRef = useRef(false);
  const availableRef = useRef(false);
  const [liveReady, setLiveReady] = useState(false);
  const [idleReady, setIdleReady] = useState(false);
  const [startupExpired, setStartupExpired] = useState(false);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const [connectionAccessError, setConnectionAccessError] = useState(false);
  const statusReceivedAt = useRef(performance.now());
  const playbackRef = useRef<{ play: () => void; fail: () => void } | null>(null);
  const slowConnectionRef = useRef(slowConnection);
  const volumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 0.5);
  const ticketPlaybackRef = useRef(false);
  const [syncLabel, setSyncLabel] = useState("Finding the live signal");
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
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
  const playbackDuration = relayStatus?.runtimeSeconds ?? null;
  const elapsedSeconds =
    liveReady && playbackPosition?.sessionId === playbackSessionId
      ? (playbackPosition?.seconds ?? null)
      : null;
  const { idlePlayback, showIdle, startingPlayback, startupFailed, playbackAccessError } =
    playbackPresentation(
      connectionAccessError && relayStatus
        ? { ...relayStatus, playbackError: "access-denied" }
        : relayStatus,
      liveReady,
      startupExpired,
    );
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
          // Keep the last broadcast state during a temporary API outage.
          return;
        }
        // SAFETY: /api/stream-info is produced by the matching StreamInfo server contract.
        const status = (await response.json()) as StreamInfo;
        if (stopped) return;
        statusReceivedAt.current = performance.now();
        availableRef.current = status.running && status.online;
        ticketPlaybackRef.current = availableRef.current && liveReadyRef.current;
        pollDelay = status.running && !status.online ? 3_000 : 10_000;
        setStreamInfo(status);
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
          setSyncLabel(status.playbackError ? "Playback access denied" : "Stream is offline");
        }
      } catch {
        if (!stopped && !request.signal.aborted) {
          availableRef.current = false;
          ticketPlaybackRef.current = false;
          // Keep the last broadcast state during a temporary API outage.
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
    if (!playbackSessionId || !relayStatus?.jellyfin || !relayStatus.serverTime) {
      setPlaybackPosition(null);
      return;
    }
    const sessionId = playbackSessionId;
    const playback = relayStatus.jellyfin;
    const serverTime = relayStatus.serverTime;
    const video = videoRef.current;
    function updatePosition() {
      const seconds =
        video &&
        liveReadyRef.current &&
        !video.paused &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ? playbackElapsedSeconds(
              playback,
              serverTime + performance.now() - statusReceivedAt.current,
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
  }, [playbackSessionId, relayStatus, playbackDuration, videoRef]);

  useEffect(() => {
    slowConnectionRef.current = slowConnection;
    if (peerRef.current) setPlaybackBuffer(peerRef.current, slowConnection);
  }, [slowConnection]);

  useEffect(() => {
    const video = videoRef.current;
    liveReadyRef.current = false;
    setLiveReady(false);
    ticketPlaybackRef.current = false;
    if (!video || !streamConfigured || streamOnline !== true) return;
    setPlayerStatus("loading");
    setIsBuffering(false);
    setAutoplayBlocked(false);
    setSyncLabel("Connecting to the stream");
    setConnectionAccessError(false);
    video.volume = volumeRef.current;
    // Prepare live playback silently under the clip, then hand audio over with the picture.
    video.muted = true;
    video.defaultMuted = true;
    let disposed = false;
    let failed = false;
    let connection: ReturnType<typeof connectPlayback> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelFrame: (() => void) | undefined;

    function failPlayback(error?: Error) {
      if (disposed || failed) return;
      failed = true;
      connection?.close();
      liveReadyRef.current = false;
      setLiveReady(false);
      ticketPlaybackRef.current = false;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403))
        setConnectionAccessError(true);
      setPlayerStatus("error");
      setIsBuffering(false);
      setAutoplayBlocked(false);
      setSyncLabel("Playback failed");
      // A fresh peer/session recovers encoder restarts and network changes.
      retry = setTimeout(() => setPlaybackAttempt((current) => current + 1), 5_000);
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
        slowConnectionRef.current ? "Extra buffering enabled" : "Following the live room",
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

    if (!("RTCPeerConnection" in window)) {
      setPlayerStatus("unsupported");
      setSyncLabel("Live playback is unsupported");
    } else {
      try {
        connection = connectPlayback(
          video,
          (sdp) =>
            apiJson<StreamPlayback>("/api/stream-playback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sdp }),
              signal: AbortSignal.timeout(20_000),
            }),
          async (session) => {
            await apiFetch("/api/stream-playback/stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session }),
              keepalive: true,
              signal: AbortSignal.timeout(8000),
            });
          },
          failPlayback,
        );
        peerRef.current = connection.peer;
        setPlaybackBuffer(connection.peer, slowConnectionRef.current);
        void connection.ready.then(play).catch(failPlayback);
      } catch (error) {
        failPlayback(error instanceof Error ? error : undefined);
      }
    }

    return () => {
      disposed = true;
      clearTimeout(retry);
      cancelFrame?.();
      video.removeEventListener("playing", playing);
      liveReadyRef.current = false;
      ticketPlaybackRef.current = false;
      playbackRef.current = null;
      connection?.close();
      if (peerRef.current === connection?.peer) peerRef.current = null;
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
    };
  }, [streamOnline, streamConfigured, playbackSessionId, playbackAttempt, videoRef]);

  useEffect(() => {
    if (!liveReady) return;
    let lastFrame = -1;
    let lastProgress = performance.now();
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || autoplayBlocked) return;
      if (document.visibilityState === "hidden") {
        lastProgress = performance.now();
        return;
      }
      if (video.paused) playbackRef.current?.play();
      const frame = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;
      if (frame !== lastFrame) {
        lastFrame = frame;
        lastProgress = performance.now();
      } else if (performance.now() - lastProgress > 10_000) playbackRef.current?.fail();
    }, 1000);
    return () => clearInterval(timer);
  }, [autoplayBlocked, liveReady, videoRef]);

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
    peerRef,
    idleVideoRef,
    idleReady,
    showIdle,
    startingPlayback,
    startupFailed,
    idleVideoEvents: {
      onPlaying() {
        if (liveReadyRef.current) {
          idleVideoRef.current?.pause();
          return;
        }
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
