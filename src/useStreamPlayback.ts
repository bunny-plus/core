import { useEffect, useRef, useState, type RefObject } from "react";
import type { StreamInfo, StreamPlayback } from "../shared/stream";
import { ApiError, apiFetch, apiJson } from "./api";
import { connectPlayback } from "./webrtc";
import { watchPlayback } from "./playback-watchdog";
import { playbackElapsedSeconds, playbackPresentation } from "./playback";

type PlaybackOptions = {
  volume: number;
  onVolumeChange: (volume: number) => void;
};

export function useStreamPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  { volume, onVolumeChange }: PlaybackOptions,
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
          return;
        }
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
  }, [streamInfoRequest, videoRef]);

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
    const video = videoRef.current;
    liveReadyRef.current = false;
    setLiveReady(false);
    ticketPlaybackRef.current = false;
    if (!video || streamOnline !== true) return;
    setPlayerStatus("loading");
    setIsBuffering(false);
    setAutoplayBlocked(false);
    setSyncLabel("Connecting to the stream");
    setConnectionAccessError(false);
    video.volume = volumeRef.current;
    video.muted = true;
    video.defaultMuted = true;
    let disposed = false;
    let failed = false;
    let connection: ReturnType<typeof connectPlayback> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelFrame: (() => void) | undefined;
    let firstFrameDeadline: ReturnType<typeof setTimeout> | undefined;

    function failPlayback(error?: Error) {
      if (disposed || failed) return;
      failed = true;
      clearTimeout(firstFrameDeadline);
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
      retry = setTimeout(() => setPlaybackAttempt((current) => current + 1), 5_000);
    }

    async function play() {
      if (disposed || failed || !video) return;
      try {
        await video.play();
      } catch (error) {
        if (disposed || failed) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          clearTimeout(firstFrameDeadline);
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
      setSyncLabel("Watching live");
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
        clearTimeout(firstFrameDeadline);
        idleVideoRef.current?.pause();
        if (idleVideoRef.current) idleVideoRef.current.muted = true;
        liveReadyRef.current = true;
        ticketPlaybackRef.current = availableRef.current;
        video.volume = volumeRef.current;
        video.muted = volumeRef.current === 0;
        setLiveReady(true);
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
        firstFrameDeadline = setTimeout(failPlayback, 30_000);
        void connection.ready.then(play).catch(failPlayback);
      } catch (error) {
        failPlayback(error instanceof Error ? error : undefined);
      }
    }

    function leavePage() {
      failed = true;
      clearTimeout(retry);
      clearTimeout(firstFrameDeadline);
      connection?.close();
    }
    function returnToPage(event: PageTransitionEvent) {
      if (event.persisted) setPlaybackAttempt((current) => current + 1);
    }
    window.addEventListener("pagehide", leavePage);
    window.addEventListener("pageshow", returnToPage);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", leavePage);
      window.removeEventListener("pageshow", returnToPage);
      clearTimeout(retry);
      clearTimeout(firstFrameDeadline);
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
  }, [streamOnline, playbackSessionId, playbackAttempt, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !liveReady || autoplayBlocked) return;
    return watchPlayback(
      video,
      () => playbackRef.current?.play(),
      () => playbackRef.current?.fail(),
    );
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
