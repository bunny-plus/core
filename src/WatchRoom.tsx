import type Hls from "hls.js";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiWebSocketUrl } from "./api";
import { parseChatEffects } from "./chat-effects";
import { playbackConfig, PlaybackSynchronizer } from "./playback";
import { CinemaTicketCard } from "./CinemaDiary";
import type { CinemaProgress, CinemaTicket } from "../shared/cinema";
import type { StreamPlayback, StreamPlaybackError } from "../shared/stream";
import { useDismissibleDetails } from "./useDismissibleDetails";
import RoomSidebar from "./RoomSidebar";

export type User = {
  admin: boolean;
  avatar: string | null;
  id: string;
  name: string;
  permissions?: string[];
};

type PlayerStats = {
  bandwidth: number | null;
  mediaBitrate: number | null;
  bufferAhead: number;
  bufferTotal: number;
  delay: number | null;
  droppedFrames: number;
  playtime: number;
  rate: number;
  resolution: string;
  seekableWindow: number;
};

type RelayStatus = {
  online: boolean;
  playbackError?: StreamPlaybackError;
  running: boolean;
  title: string | null;
  upstreamStatus: number | null;
};

type RoomReaction = {
  expiresAt: number;
  id: string;
  member: { id: string; name: string };
  variant: "blossom" | "carrot";
  x: number;
};

export type RoomChat = {
  createdAt: string;
  id: string;
  member: { avatar: string | null; id: string; name: string };
  message: string;
  x: number;
};

type ChatDisplayMode = "bubbles" | "scrolling";
type OverlayChat = RoomChat & { lane: number; expiresAt: number };
type RoomStyle = CSSProperties & {
  "--character-index"?: number;
  "--chat-x"?: string;
  "--chat-y"?: string;
  "--reaction-x"?: string;
  "--volume"?: string;
};

function roomStyle(style: RoomStyle): CSSProperties {
  return style;
}

function ChatMessage({ message, scrolling = false }: { message: string; scrolling?: boolean }) {
  const effects = parseChatEffects(message);
  if (!scrolling) return effects.text;
  const classes = [
    "runescape-chat-text",
    effects.color && `runescape-color-${effects.color}`,
    effects.motion && `runescape-motion-${effects.motion}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={effects.text}>
      {[...effects.text].map((character, index) => (
        <span
          className="runescape-chat-character"
          style={roomStyle({ "--character-index": index })}
          aria-hidden="true"
          key={index}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remainder = whole % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function savedVolume() {
  try {
    const value = Number(localStorage.getItem("bunny-plus-volume"));
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  } catch {
    return 0;
  }
}

function savedLightsOut() {
  try {
    return localStorage.getItem("bunny-plus-lights-out") === "true";
  } catch {
    return false;
  }
}

function savedSlowConnection() {
  try {
    return localStorage.getItem("bunny-plus-slow-connection") === "true";
  } catch {
    return false;
  }
}

function savedShortcuts() {
  try {
    return localStorage.getItem("bunny-plus-shortcuts") !== "false";
  } catch {
    return true;
  }
}

function savedChatDisplayMode(): ChatDisplayMode {
  try {
    return localStorage.getItem("bunny-plus-chat-display") === "bubbles" ? "bubbles" : "scrolling";
  } catch {
    return "scrolling";
  }
}

function savedSidebarOpen() {
  try {
    return localStorage.getItem("bunny-plus-sidebar") !== "closed";
  } catch {
    return true;
  }
}

function savedTheatreMode() {
  try {
    return localStorage.getItem("bunny-plus-theatre") === "true";
  } catch {
    return false;
  }
}

export default function WatchRoom({
  currentUser,
  delaySeconds,
  streamUrl,
}: {
  currentUser: User;
  delaySeconds: number;
  streamUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const theatreButtonRef = useRef<HTMLButtonElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const playerMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(playerMenuRef);
  const hlsRef = useRef<Hls | null>(null);
  const playbackRef = useRef<{ play: () => void; fail: () => void } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef(0);
  const screeningIdRef = useRef("");
  const ticketPlaybackRef = useRef(false);
  const seenTicketIdsRef = useRef(new Set<string>());
  const [cinemaProgress, setCinemaProgress] = useState<CinemaProgress | null>(null);
  const [earnedTicket, setEarnedTicket] = useState<CinemaTicket | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  const [lightsOut, setLightsOut] = useState(savedLightsOut);
  const [slowConnection, setSlowConnection] = useState(savedSlowConnection);
  const slowConnectionRef = useRef(slowConnection);
  const [fullscreen, setFullscreen] = useState(false);
  const [theatreMode, setTheatreMode] = useState(savedTheatreMode);
  const theatreActive = theatreMode;
  const expandedPlayer = fullscreen;
  const immersivePlayer = expandedPlayer || theatreActive;
  const volumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 0.5);
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState(streamUrl);
  const signedPlaybackRef = useRef<(StreamPlayback & { source: string }) | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"loading" | "ready" | "error" | "unsupported">(
    "loading",
  );
  const [isBuffering, setIsBuffering] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const idlePlayback = streamOnline === false && relayStatus?.running === false;
  const playbackAccessError = relayStatus?.running
    ? (relayStatus.playbackError ??
      ([401, 403].includes(relayStatus.upstreamStatus ?? 0) ? "access-denied" : undefined))
    : undefined;
  const playbackAccessMessage =
    playbackAccessError === "signing-failed"
      ? "Playback could not be authorized. An administrator needs to check playback access."
      : "Cloudflare denied playback. An administrator needs to check playback access.";
  const [members, setMembers] = useState<User[]>([currentUser]);
  const [syncLabel, setSyncLabel] = useState("Finding the live signal");
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [chats, setChats] = useState<OverlayChat[]>([]);
  const [chatHistory, setChatHistory] = useState<RoomChat[]>([]);
  const [chatSequence, setChatSequence] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(savedSidebarOpen);
  const [composeRequest, setComposeRequest] = useState(0);
  const [chatComposer, setChatComposer] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(savedShortcuts);
  const [chatDisplayMode, setChatDisplayMode] = useState(savedChatDisplayMode);

  useEffect(() => {
    document.body.classList.toggle("lights-out", lightsOut);
    return () => {
      document.body.classList.remove("lights-out");
    };
  }, [lightsOut]);

  useEffect(() => {
    document.body.classList.toggle("theatre-mode", theatreActive);
    return () => document.body.classList.remove("theatre-mode");
  }, [theatreActive]);

  useEffect(() => {
    function theatreShortcut(event: KeyboardEvent) {
      if (
        document.fullscreenElement ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (event.key === "Escape" && theatreActive) {
        event.preventDefault();
        changeTheatreMode(false);
        theatreButtonRef.current?.focus({ preventScroll: true });
      } else if (
        shortcutsEnabled &&
        event.key.toLowerCase() === "t" &&
        !document.activeElement?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        event.preventDefault();
        changeTheatreMode(!theatreMode);
      }
    }

    window.addEventListener("keydown", theatreShortcut);
    return () => window.removeEventListener("keydown", theatreShortcut);
  }, [shortcutsEnabled, theatreActive, theatreMode]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function reactionShortcut(event: KeyboardEvent) {
      const target = document.activeElement;
      if (
        event.key.toLowerCase() !== "f" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      event.preventDefault();
      react();
    }

    window.addEventListener("keydown", reactionShortcut);
    return () => {
      window.removeEventListener("keydown", reactionShortcut);
    };
  }, [shortcutsEnabled]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function chatShortcut(event: KeyboardEvent) {
      const target = document.activeElement;
      if (
        event.key.toLowerCase() !== "c" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      event.preventDefault();
      if (expandedPlayer) setChatComposer(true);
      else {
        changeSidebarOpen(true);
        setComposeRequest((current) => current + 1);
      }
    }

    window.addEventListener("keydown", chatShortcut);
    return () => {
      window.removeEventListener("keydown", chatShortcut);
    };
  }, [shortcutsEnabled, expandedPlayer]);

  useEffect(() => {
    if (showChatHistory && chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory, showChatHistory, expandedPlayer]);

  useEffect(() => {
    const player = playerRef.current;
    let wasFullscreen = false;
    const update = () => {
      const active = document.fullscreenElement === player;
      setFullscreen(active);
      if (active) player?.focus({ preventScroll: true });
      else if (wasFullscreen) fullscreenButtonRef.current?.focus({ preventScroll: true });
      wasFullscreen = active;
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    const screen = playerRef.current;
    if (
      !screen ||
      playerStatus !== "ready" ||
      isBuffering ||
      (expandedPlayer && (chatComposer || showChatHistory))
    )
      return;
    let timer: ReturnType<typeof setTimeout>;
    let keyboardInteraction = document.activeElement?.matches(":focus-visible") ?? false;
    let pointerDown = false;
    let touchInteraction = !window.matchMedia("(hover: hover)").matches;
    let pointerOverControls = !!screen.querySelector(".player-actions:hover, .live-state:hover");
    const quickFade = theatreActive && !expandedPlayer;
    const reveal = (event?: Event) => {
      if (event?.type === "keydown") keyboardInteraction = true;
      else if (event?.type.startsWith("pointer")) keyboardInteraction = false;
      if (event instanceof PointerEvent) {
        touchInteraction = event.pointerType === "touch";
        pointerOverControls =
          event.target instanceof Element &&
          screen.contains(event.target) &&
          !!event.target.closest(".player-actions, .live-state");
      }
      if (event?.type === "pointerdown") pointerDown = true;
      screen.classList.remove("cursor-idle");
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          const focused = document.activeElement;
          if (
            (immersivePlayer || screen.matches(":hover")) &&
            !pointerDown &&
            !(quickFade && !touchInteraction && pointerOverControls) &&
            !screen.querySelector("details[open]") &&
            !(
              keyboardInteraction &&
              focused?.matches(
                "input, textarea, select, summary, button, a, [contenteditable='true']",
              ) &&
              screen.contains(focused)
            )
          )
            screen.classList.add("cursor-idle");
        },
        quickFade && !touchInteraction && !pointerOverControls ? 600 : 3_000,
      );
    };
    const leave = () => {
      pointerOverControls = false;
      if (immersivePlayer) reveal();
      else {
        clearTimeout(timer);
        screen.classList.remove("cursor-idle");
      }
    };
    const release = (event: Event) => {
      if (!pointerDown) return;
      pointerDown = false;
      reveal(event);
    };
    const events = ["pointermove", "pointerdown", "pointerenter", "keydown", "focusin", "focusout"];
    for (const event of events) screen.addEventListener(event, reveal);
    screen.addEventListener("pointerleave", leave);
    screen.addEventListener("toggle", reveal, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("fullscreenchange", reveal);
    reveal();
    return () => {
      clearTimeout(timer);
      screen.classList.remove("cursor-idle");
      for (const event of events) screen.removeEventListener(event, reveal);
      screen.removeEventListener("pointerleave", leave);
      screen.removeEventListener("toggle", reveal, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("fullscreenchange", reveal);
    };
  }, [
    playerStatus,
    isBuffering,
    chatComposer,
    showChatHistory,
    expandedPlayer,
    immersivePlayer,
    theatreActive,
  ]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = new AbortController();

    async function checkStreamInfo() {
      try {
        const response = await apiFetch("/api/stream-info", {
          cache: "no-store",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
        });
        if (!response.ok) {
          ticketPlaybackRef.current = false;
          setRelayStatus(null);
          return;
        }
        // SAFETY: /api/stream-info is produced by the matching RelayStatus server contract.
        const status = (await response.json()) as RelayStatus;
        if (stopped) return;
        if (status.running && status.online) {
          let playback = signedPlaybackRef.current;
          if (
            !playback ||
            playback.source !== streamUrl ||
            (playback.expiresAt !== null && playback.expiresAt - Date.now() < 5 * 60 * 1000)
          ) {
            const signed = await apiFetch("/api/stream-playback", {
              cache: "no-store",
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
            });
            if (!signed.ok) throw new Error("Could not authorize stream playback");
            // SAFETY: The authenticated endpoint returns the matching StreamPlayback contract.
            const result = (await signed.json()) as StreamPlayback;
            playback = { ...result, source: streamUrl };
            signedPlaybackRef.current = playback;
          }
          if (stopped) return;
          setPlaybackUrl(playback.url);
        }
        ticketPlaybackRef.current = status.running && status.online;
        setRelayStatus(status);
        // A failed availability probe must not interrupt media that is still buffered.
        if (
          status.running &&
          !status.online &&
          !videoRef.current?.loop &&
          (videoRef.current?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA
        )
          return;
        setStreamOnline(status.running && status.online);
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
          ticketPlaybackRef.current = false;
          setRelayStatus(null);
        }
      } finally {
        if (!stopped) timer = setTimeout(checkStreamInfo, 10_000);
      }
    }

    void checkStreamInfo();
    return () => {
      stopped = true;
      request.abort();
      clearTimeout(timer);
    };
  }, [streamUrl]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let clockPing: ReturnType<typeof setInterval> | undefined;
    let watchPing: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 2_000;
    let stopped = false;
    let lastPlaybackTime: number | null = null;
    let lastReportedPlaying: boolean | undefined;
    let lastWatchingReportAt = 0;
    const video = videoRef.current;

    function reportWatching(event?: Event) {
      const connection = socketRef.current;
      if (connection?.readyState !== WebSocket.OPEN) return;
      const interrupted =
        event !== undefined &&
        ["waiting", "pause", "seeking", "ended", "emptied"].includes(event.type);
      const playing =
        ticketPlaybackRef.current &&
        Boolean(screeningIdRef.current) &&
        !interrupted &&
        video !== null &&
        !video.paused &&
        !video.ended &&
        !video.seeking &&
        video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
        (event?.type === "playing" ||
          lastPlaybackTime === null ||
          video.currentTime > lastPlaybackTime + 0.1);
      lastPlaybackTime = video?.currentTime ?? null;
      const reportAt = performance.now();
      if (event && !playing && lastReportedPlaying === false) return;
      if (event && playing && reportAt - lastWatchingReportAt < 5_000) return;
      lastReportedPlaying = playing;
      lastWatchingReportAt = reportAt;
      connection.send(
        JSON.stringify({ type: "watching", screeningId: screeningIdRef.current, playing }),
      );
    }

    const playbackEvents = ["playing", "waiting", "pause", "seeking", "ended", "emptied"];
    for (const event of playbackEvents) video?.addEventListener(event, reportWatching);
    // One timer expires the bounded overlays, including while browser timers are throttled.
    const expiry = setInterval(() => {
      const now = performance.now();
      setReactions((current) =>
        current.some((entry) => entry.expiresAt <= now)
          ? current.filter((entry) => entry.expiresAt > now)
          : current,
      );
      setChats((current) =>
        current.some((entry) => entry.expiresAt <= now)
          ? current.filter((entry) => entry.expiresAt > now)
          : current,
      );
    }, 500);

    function connect() {
      let receivedProgress = false;
      const connection = new WebSocket(apiWebSocketUrl("/api/room"));
      socket = connection;
      socketRef.current = socket;
      connection.addEventListener("open", () => {
        if (stopped) {
          connection.close();
          return;
        }
        retryDelay = 2_000;
        lastPlaybackTime = null;
        lastReportedPlaying = undefined;
        connection.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        reportWatching();
        watchPing = setInterval(reportWatching, 10_000);
        clockPing = setInterval(() => {
          if (connection.readyState === WebSocket.OPEN)
            connection.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        }, 30_000);
      });
      connection.addEventListener("message", (event) => {
        if (stopped) return;
        try {
          // SAFETY: This listener receives text frames from the first-party room protocol.
          const message = JSON.parse(event.data as string) as {
            clientTime?: number;
            chats?: RoomChat[];
            createdAt?: string;
            members?: User[];
            serverTime?: number;
            type: string;
            id?: string;
            member?: { avatar: string | null; id: string; name: string };
            message?: string | null;
            variant?: "blossom" | "carrot";
            x?: number;
            progress?: CinemaProgress;
          };
          if (message.members) setMembers(message.members);
          if (message.chats) setChatHistory(message.chats.slice(-200));
          if (message.type === "cinema-progress" && message.progress) {
            const progress = message.progress;
            screeningIdRef.current = progress.screening?.ticketCountingEnabled
              ? progress.screening.id
              : "";
            setCinemaProgress(progress);
            if (progress.ticket && !seenTicketIdsRef.current.has(progress.ticket.id)) {
              seenTicketIdsRef.current.add(progress.ticket.id);
              if (receivedProgress) setEarnedTicket(progress.ticket);
            }
            receivedProgress = true;
          }
          if (message.type === "pong" && message.clientTime && message.serverTime) {
            clockOffsetRef.current = message.serverTime - (message.clientTime + Date.now()) / 2;
          }
          if (
            message.type === "reaction" &&
            message.id &&
            message.member &&
            message.variant &&
            message.x !== undefined &&
            Number.isFinite(message.x)
          ) {
            const reaction = {
              expiresAt: performance.now() + 4_000,
              id: message.id,
              member: message.member,
              variant: message.variant,
              x: message.x,
            };
            setReactions((current) => [...current.slice(-7), reaction]);
          }
          if (
            message.type === "chat" &&
            message.id &&
            message.member &&
            message.message &&
            message.x !== undefined &&
            Number.isFinite(message.x)
          ) {
            const chat = {
              createdAt: message.createdAt ?? new Date().toISOString(),
              id: message.id,
              member: message.member,
              message: message.message,
              x: message.x,
            };
            setChatSequence((current) => current + 1);
            setChats((current) => {
              const previousLane = current.at(-1)?.lane;
              return [
                ...current.slice(-5),
                {
                  ...chat,
                  expiresAt: performance.now() + 10_500,
                  lane:
                    previousLane === undefined ? Math.floor(chat.x) % 6 : (previousLane + 1) % 6,
                },
              ];
            });
            setChatHistory((current) => [...current.slice(-199), chat]);
          }
        } catch {
          // Ignore malformed server messages and keep the current room state.
        }
      });
      connection.addEventListener("close", (event) => {
        clearInterval(clockPing);
        clearInterval(watchPing);
        if (socketRef.current === connection) socketRef.current = null;
        if (stopped) return;
        setCinemaProgress(null);
        screeningIdRef.current = "";
        if (event.code === 4001) {
          location.reload();
          return;
        }
        retry = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      });
      connection.addEventListener("error", () => connection.close());
    }

    connect();
    return () => {
      stopped = true;
      clearInterval(expiry);
      clearInterval(clockPing);
      clearInterval(watchPing);
      clearTimeout(retry);
      for (const event of playbackEvents) video?.removeEventListener(event, reportWatching);
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({ type: "watching", screeningId: screeningIdRef.current, playing: false }),
        );
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    slowConnectionRef.current = slowConnection;
    const hls = hlsRef.current;
    if (hls) Object.assign(hls.config, playbackConfig(delaySeconds, slowConnection, playbackUrl));
    if (videoRef.current) videoRef.current.playbackRate = 1;
  }, [delaySeconds, slowConnection, playbackUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!idlePlayback && (!streamUrl || streamOnline !== true))) return;
    setPlayerStatus("loading");
    setIsBuffering(false);
    setAutoplayBlocked(false);
    setSyncLabel(idlePlayback ? "Between screenings" : "Connecting to the stream");
    video.volume = volumeRef.current;
    video.muted = volumeRef.current === 0;
    video.defaultMuted = volumeRef.current === 0;
    let disposed = false;
    let failed = false;
    let attachedHls: Hls | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

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

    if (idlePlayback) {
      video.loop = true;
      video.src = "/offline.mp4";
      void play();
    } else {
      void attachStream(video).catch(failPlayback);
    }
    return () => {
      disposed = true;
      clearTimeout(retry);
      playbackRef.current = null;
      attachedHls?.destroy();
      if (hlsRef.current === attachedHls) hlsRef.current = null;
      video.pause();
      video.playbackRate = 1;
      video.loop = false;
      video.removeAttribute("src");
      video.load();
    };
  }, [delaySeconds, streamOnline, streamUrl, playbackUrl, playbackAttempt, idlePlayback]);

  useEffect(() => {
    if (idlePlayback) return;
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
  }, [delaySeconds, playerStatus, streamUrl, autoplayBlocked, idlePlayback]);

  useEffect(() => {
    if (!showStats) return;

    function updateStats() {
      const video = videoRef.current;
      if (!video) return;

      let bufferAhead = 0;
      let bufferTotal = 0;
      for (let index = 0; index < video.buffered.length; index++) {
        const start = video.buffered.start(index);
        const end = video.buffered.end(index);
        bufferTotal += end - start;
        if (video.currentTime >= start && video.currentTime <= end)
          bufferAhead = end - video.currentTime;
      }

      const playingDate = hlsRef.current?.playingDate;
      const liveEdge =
        video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
      const delay = video.loop
        ? null
        : playingDate
          ? (Date.now() + clockOffsetRef.current - playingDate.getTime()) / 1_000
          : liveEdge === null
            ? null
            : liveEdge - video.currentTime;
      const quality = video.getVideoPlaybackQuality?.();
      const hls = hlsRef.current;

      setStats({
        bandwidth: hlsRef.current?.bandwidthEstimate ?? null,
        mediaBitrate: hls ? hls.levels[hls.currentLevel]?.realBitrate || null : null,
        bufferAhead,
        bufferTotal,
        delay,
        droppedFrames: quality?.droppedVideoFrames ?? 0,
        playtime: video.currentTime,
        rate: video.playbackRate,
        resolution:
          video.videoWidth && video.videoHeight
            ? `${video.videoWidth} × ${video.videoHeight}`
            : "--",
        seekableWindow:
          video.seekable.length > 0
            ? video.seekable.end(video.seekable.length - 1) - video.seekable.start(0)
            : 0,
      });
    }

    updateStats();
    const timer = setInterval(updateStats, 1_000);
    return () => clearInterval(timer);
  }, [showStats]);

  function changeVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    volumeRef.current = value;
    if (value > 0) lastAudibleVolumeRef.current = value;
    setVolume(value);
    try {
      localStorage.setItem("bunny-plus-volume", String(value));
    } catch {
      // Playback still works when storage is unavailable.
    }
    if (value > 0 && video.paused) {
      playbackRef.current?.play();
    }
  }

  function toggleMute() {
    changeVolume(volume === 0 ? lastAudibleVolumeRef.current : 0);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current?.requestFullscreen();
    } catch {
      setSyncLabel("Fullscreen is unavailable in this browser");
    }
  }

  function toggleLightsOut() {
    const next = !lightsOut;
    setLightsOut(next);
    try {
      localStorage.setItem("bunny-plus-lights-out", String(next));
    } catch {
      // The visual mode still works when storage is unavailable.
    }
  }

  function toggleShortcuts() {
    const next = !shortcutsEnabled;
    setShortcutsEnabled(next);
    try {
      localStorage.setItem("bunny-plus-shortcuts", String(next));
    } catch {
      // The shortcut preference still applies for this visit.
    }
  }

  function toggleSlowConnection() {
    const next = !slowConnection;
    setSlowConnection(next);
    try {
      localStorage.setItem("bunny-plus-slow-connection", String(next));
    } catch {
      // The mode still applies for this visit if storage is unavailable.
    }
  }

  function toggleChatDisplayMode() {
    const next = chatDisplayMode === "bubbles" ? "scrolling" : "bubbles";
    setChatDisplayMode(next);
    try {
      localStorage.setItem("bunny-plus-chat-display", next);
    } catch {
      // The chat display preference still applies for this visit.
    }
  }

  function react() {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "reaction" }));
    }
  }

  function chat(message: string) {
    const text = message.trim();
    if (text && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "chat", message: text }));
      setChatMessage("");
      setChatComposer(false);
      return true;
    }
    return false;
  }

  function changeSidebarOpen(open: boolean) {
    setSidebarOpen(open);
    try {
      localStorage.setItem("bunny-plus-sidebar", open ? "open" : "closed");
    } catch {
      // Keep the selected layout for this visit when storage is unavailable.
    }
  }

  function changeTheatreMode(enabled: boolean) {
    setTheatreMode(enabled);
    if (enabled) changeSidebarOpen(true);
    try {
      localStorage.setItem("bunny-plus-theatre", String(enabled));
    } catch {
      // Keep the layout for this visit when storage is unavailable.
    }
  }

  return (
    <div className={`watch-content${theatreActive ? " watch-content--theatre" : ""}`}>
      <div className={`room-grid room-grid--sidebar${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <section className="screen-column">
          <div
            className={`screen-player${theatreActive ? " screen-player--theatre" : ""}`}
            ref={playerRef}
            tabIndex={-1}
          >
            <div className="screen-frame">
              <video
                ref={videoRef}
                autoPlay
                muted={volume === 0}
                playsInline
                onPlaying={() => {
                  setPlayerStatus("ready");
                  setIsBuffering(false);
                  setAutoplayBlocked(false);
                  setSyncLabel(
                    idlePlayback
                      ? "Between screenings"
                      : slowConnection
                        ? "Slow connection · sync off"
                        : "Following the live room",
                  );
                }}
                onError={() => playbackRef.current?.fail()}
                onStalled={() => {
                  if (
                    playerStatus === "ready" &&
                    !idlePlayback &&
                    !autoplayBlocked &&
                    (videoRef.current?.readyState ?? 0) < HTMLMediaElement.HAVE_FUTURE_DATA
                  ) {
                    setIsBuffering(true);
                    setSyncLabel("Buffering the live stream...");
                  }
                }}
                onWaiting={() => {
                  if (playerStatus !== "ready" || autoplayBlocked || idlePlayback) return;
                  setIsBuffering(true);
                  setSyncLabel("Buffering the live stream...");
                }}
                onClick={() => {
                  if (videoRef.current?.paused) playbackRef.current?.play();
                }}
              />
              {(streamOnline === null || playerStatus === "loading") &&
                !idlePlayback &&
                streamUrl &&
                !autoplayBlocked && (
                  <div className="stream-loading" role="status">
                    <AssetIcon name="carrot" />
                    <strong>Tuning the bunny ears...</strong>
                    <small>Waiting for the live stream</small>
                  </div>
                )}
              {(streamOnline === true || idlePlayback) &&
                autoplayBlocked &&
                playerStatus !== "error" && (
                  <div className="stream-loading">
                    <button
                      className="stream-action"
                      type="button"
                      onClick={() => playbackRef.current?.play()}
                    >
                      Tap to play
                    </button>
                  </div>
                )}
              {playerStatus === "ready" && isBuffering && !autoplayBlocked && (
                <div className="stream-loading buffering-overlay" role="status">
                  <AssetIcon name="carrot" />
                  <strong>Buffering the live stream...</strong>
                  <small>
                    {slowConnection ? "Waiting for more video" : "Catching everybun back up"}
                  </small>
                </div>
              )}
              {playerStatus === "unsupported" && (
                <div className="stream-error" role="status">
                  This browser does not support HLS playback. Open the stream in an HLS-capable
                  browser or player.
                </div>
              )}
              {playerStatus !== "unsupported" &&
                (!streamUrl ||
                  (streamOnline === false && !idlePlayback) ||
                  playerStatus === "error") && (
                  <div className="stream-error" role="status">
                    <span>
                      {!streamUrl
                        ? "Set STREAM_URL to connect the screen."
                        : playbackAccessError
                          ? playbackAccessMessage
                          : streamOnline === false && !idlePlayback
                            ? "The stream is offline. Reconnecting when it returns."
                            : "Couldn't play the video. Reconnecting…"}
                    </span>
                    {streamUrl && (streamOnline === true || idlePlayback) && (
                      <button
                        className="stream-action"
                        type="button"
                        onClick={() => setPlaybackAttempt((current) => current + 1)}
                      >
                        Retry playback
                      </button>
                    )}
                  </div>
                )}
              <div className="reaction-layer" aria-live="polite" aria-relevant="additions">
                {reactions.map((reaction) => (
                  <span
                    className="room-reaction"
                    style={roomStyle({ "--reaction-x": `${reaction.x}%` })}
                    key={reaction.id}
                  >
                    <span className="sr-only">{reaction.member.name} reacted</span>
                    <AssetIcon name={reaction.variant} />
                    <strong aria-hidden="true">{reaction.member.name}</strong>
                  </span>
                ))}
                {chats.map((chat) =>
                  chatDisplayMode === "scrolling" ? (
                    <span
                      className="room-chat-scroll"
                      style={roomStyle({ "--chat-y": `${12 + chat.lane * 13}%` })}
                      key={chat.id}
                    >
                      <strong>{chat.member.name}</strong>
                      <span aria-hidden="true">: </span>
                      <ChatMessage message={chat.message} scrolling />
                    </span>
                  ) : (
                    <span
                      className="room-chat"
                      style={roomStyle({ "--chat-x": `${chat.x}%` })}
                      key={chat.id}
                    >
                      <span className="room-chat-avatar" aria-hidden="true">
                        {chat.member.avatar ? (
                          <img src={chat.member.avatar} alt="" />
                        ) : (
                          <span>{chat.member.name[0]?.toUpperCase()}</span>
                        )}
                      </span>
                      <span className="room-chat-bubble">
                        <strong aria-hidden="true">{chat.member.name}</strong>
                        <span className="sr-only">{chat.member.name} says: </span>
                        <span>
                          <ChatMessage message={chat.message} />
                        </span>
                      </span>
                    </span>
                  ),
                )}
              </div>
              {shortcutsEnabled && (
                <span className="reaction-shortcut-hint" aria-hidden="true">
                  Press <kbd>F</kbd> to react
                </span>
              )}
            </div>
            <div className="screen-footer">
              <div
                className={`live-state ${streamOnline === false || relayStatus?.running === false ? "offline" : ""}`}
              >
                <span className="live-badge">
                  <i aria-hidden="true" />
                  <span>
                    {streamOnline === null || relayStatus === null
                      ? "CHECKING"
                      : idlePlayback
                        ? "IDLE"
                        : playbackAccessError
                          ? "LOCKED"
                          : !streamOnline
                            ? "OFFLINE"
                            : relayStatus.running
                              ? "LIVE"
                              : "IDLE"}
                  </span>
                </span>
                {relayStatus?.running && (
                  <span className="stream-title" title={relayStatus.title ?? "TorBox stream"}>
                    <AssetIcon name="carrot" />
                    <span>{relayStatus.title ?? "TorBox stream"}</span>
                  </span>
                )}
                <span className="sync-copy">{syncLabel}</span>
              </div>
              <div className="player-actions">
                <div className="player-bottom-charms" aria-hidden="true">
                  <span className="player-charm player-charm--bunny">
                    <AssetIcon name="bunny-sleep" />
                  </span>
                  <span className="player-charm player-charm--strawberry">
                    <AssetIcon name="strawberry" />
                  </span>
                  <span className="player-charm player-charm--heart">
                    <AssetIcon name="heart-locket" />
                  </span>
                  <span className="player-charm player-charm--moon">
                    <AssetIcon name="moon-star" />
                  </span>
                  <span className="player-charm player-charm--blossom">
                    <AssetIcon name="blossom" />
                  </span>
                </div>
                <div className="volume-control">
                  <button
                    className="volume-toggle"
                    type="button"
                    aria-label={volume === 0 ? "Unmute" : "Mute"}
                    aria-pressed={volume === 0}
                    onClick={toggleMute}
                  >
                    <UiIcon name={volume === 0 ? "volume-off" : "volume"} />
                  </button>
                  <span
                    className="volume-slider"
                    style={roomStyle({
                      "--volume": `calc(${volume * 100}% + ${11.5 - volume * 23}px)`,
                    })}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      aria-label="Volume"
                      onChange={(event) => changeVolume(Number(event.target.value))}
                    />
                    <AssetIcon name="carrot" />
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="React"
                  data-tooltip={shortcutsEnabled ? "Press F to react" : undefined}
                  onClick={react}
                >
                  <UiIcon name="heart" />
                  <span>React</span>
                </button>
                {expandedPlayer && (
                  <button
                    type="button"
                    aria-label="Chat"
                    aria-expanded={chatComposer}
                    data-tooltip={shortcutsEnabled ? "Press C to chat" : undefined}
                    onClick={() => setChatComposer((open) => !open)}
                  >
                    <UiIcon name="chat" />
                    <span>Chat</span>
                  </button>
                )}
                {expandedPlayer && (
                  <button
                    className={`chat-history-toggle${showChatHistory ? " active" : ""}`}
                    type="button"
                    aria-label={showChatHistory ? "Hide chat" : "Show chat"}
                    aria-expanded={showChatHistory}
                    onClick={() => setShowChatHistory((visible) => !visible)}
                  >
                    <UiIcon name="history" />
                    <span>{showChatHistory ? "Hide chat" : "Show chat"}</span>
                  </button>
                )}
                <button
                  className={lightsOut ? "active" : ""}
                  type="button"
                  aria-label="Toggle lights"
                  aria-pressed={lightsOut}
                  onClick={toggleLightsOut}
                >
                  <UiIcon name="moon" />
                  <span>Lights</span>
                </button>
                {!fullscreen && (
                  <button
                    ref={theatreButtonRef}
                    type="button"
                    className={theatreMode ? "active" : ""}
                    aria-label={theatreMode ? "Exit theatre mode" : "Enter theatre mode"}
                    aria-pressed={theatreMode}
                    data-tooltip={shortcutsEnabled ? "Press T for theatre mode" : undefined}
                    onClick={() => changeTheatreMode(!theatreMode)}
                  >
                    <UiIcon name="theatre" />
                    <span>{theatreMode ? "Exit theatre" : "Theatre"}</span>
                  </button>
                )}
                <button
                  type="button"
                  ref={fullscreenButtonRef}
                  aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  onClick={() => void toggleFullscreen()}
                >
                  <UiIcon name="fullscreen" />
                  <span>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
                </button>
                <details className="player-menu" ref={playerMenuRef} name="bunny-popover">
                  <summary aria-label="More player options" title="More player options">
                    <UiIcon name="gear" />
                  </summary>
                  <div className="player-menu-popover">
                    <button
                      type="button"
                      aria-pressed={slowConnection}
                      onClick={toggleSlowConnection}
                    >
                      Slow connection: {slowConnection ? "on" : "off"}
                      <small>More buffer, no live catch-up. Same video quality.</small>
                    </button>
                    <button
                      type="button"
                      aria-expanded={showStats}
                      onClick={(event) => {
                        setShowStats((visible) => !visible);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      {showStats ? "Hide stats" : "Show stats"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={chatDisplayMode === "scrolling"}
                      onClick={toggleChatDisplayMode}
                    >
                      Chat overlay: {chatDisplayMode === "scrolling" ? "scrolling" : "bubbles"}
                    </button>
                    <button type="button" aria-pressed={shortcutsEnabled} onClick={toggleShortcuts}>
                      Single-key shortcuts: {shortcutsEnabled ? "on" : "off"}
                    </button>
                    {streamUrl && (
                      <a href={playbackUrl} target="_blank" rel="noreferrer">
                        Open in own player ↗<small>May not stay in sync</small>
                      </a>
                    )}
                  </div>
                </details>
              </div>
            </div>
            {expandedPlayer && (showChatHistory || chatComposer) && (
              <div className="chat-panels">
                {showChatHistory && (
                  <aside className="chat-history-panel" aria-label="Chat">
                    <button
                      className="chat-history-close"
                      type="button"
                      aria-label="Hide chat"
                      onClick={() => setShowChatHistory(false)}
                    >
                      ×
                    </button>
                    <div ref={chatHistoryRef}>
                      {chatHistory.map((chat) => (
                        <p className="chat-history-entry" key={chat.id}>
                          <strong>{chat.member.name}</strong>
                          <span aria-hidden="true">: </span>
                          <span>
                            <ChatMessage message={chat.message} />
                          </span>
                        </p>
                      ))}
                    </div>
                  </aside>
                )}
                {chatComposer && (
                  <form
                    className="chat-composer"
                    autoComplete="off"
                    onSubmit={(event) => {
                      event.preventDefault();
                      chat(chatMessage);
                    }}
                  >
                    <button
                      className="chat-composer-close"
                      type="button"
                      aria-label="Close chat"
                      onClick={() => {
                        setChatMessage("");
                        setChatComposer(false);
                      }}
                    >
                      ×
                    </button>
                    <label htmlFor="chat-message">Say something cute</label>
                    <div>
                      <input
                        id="chat-message"
                        autoFocus
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        maxLength={64}
                        placeholder="omg..."
                        value={chatMessage}
                        onChange={(event) => setChatMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setChatMessage("");
                            setChatComposer(false);
                          }
                        }}
                      />
                      <button type="submit">Send</button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
          {relayStatus?.running &&
            relayStatus.online &&
            cinemaProgress?.screening?.ticketCountingEnabled &&
            (cinemaProgress.screening.ticketDesign || cinemaProgress.ticket) && (
              <div className="cinema-ticket-progress">
                <div className="cinema-ticket-stub">
                  <span className="cinema-ticket-stamp">
                    <UiIcon name="ticket" />
                  </span>
                  <div className="cinema-ticket-copy">
                    <strong className="cinema-ticket-progress-title">
                      {cinemaProgress.screening.ticketDesign?.title || cinemaProgress.ticket?.title}
                    </strong>
                    <span>
                      {cinemaProgress.ticket
                        ? "Ticket collected"
                        : `${formatTime(cinemaProgress.watchedSeconds)} / ${formatTime(cinemaProgress.requiredSeconds)} watched`}
                    </span>
                    {!cinemaProgress.ticket && (
                      <progress
                        aria-label="Watch time toward your cinema ticket"
                        max={cinemaProgress.requiredSeconds}
                        value={cinemaProgress.watchedSeconds}
                      />
                    )}
                  </div>
                </div>
                <Link to="/diary">My tickets ↗</Link>
              </div>
            )}
          {earnedTicket && (
            <aside className="cinema-ticket-award" aria-label="New cinema ticket">
              <div className="cinema-ticket-award-heading">
                <p className="sr-only" role="status">
                  Added to your tickets
                </p>
                <button
                  type="button"
                  aria-label="Dismiss ticket"
                  onClick={() => setEarnedTicket(null)}
                >
                  ×
                </button>
              </div>
              <CinemaTicketCard ticket={earnedTicket} compact />
              <Link to="/diary">My tickets ↗</Link>
            </aside>
          )}
          {showStats && stats && (
            <div className="player-stats" role="group" aria-label="Playback statistics">
              <div>
                <span>Delay</span>
                <strong>{stats.delay === null ? "--" : `${stats.delay.toFixed(1)}s`}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{slowConnection ? "Sync off" : `${delaySeconds}s`}</strong>
              </div>
              <div>
                <span>Buffered ahead</span>
                <strong>{stats.bufferAhead.toFixed(1)}s</strong>
              </div>
              <div>
                <span>Total buffered</span>
                <strong>{stats.bufferTotal.toFixed(1)}s</strong>
              </div>
              <div>
                <span>Live window</span>
                <strong>{stats.seekableWindow.toFixed(1)}s</strong>
              </div>
              <div>
                <span>Playtime</span>
                <strong>{formatTime(stats.playtime)}</strong>
              </div>
              <div>
                <span>Playback rate</span>
                <strong>{stats.rate.toFixed(3)}×</strong>
              </div>
              <div>
                <span>Resolution</span>
                <strong>{stats.resolution}</strong>
              </div>
              <div>
                <span title="Estimated speed while downloading segments, not the video bitrate">
                  Download speed (est.)
                </span>
                <strong>
                  {stats.bandwidth === null
                    ? "--"
                    : `${(stats.bandwidth / 1_000_000).toFixed(2)} Mbps`}
                </strong>
              </div>
              <div>
                <span title="Average bitrate of the downloaded media segments">Media bitrate</span>
                <strong>
                  {stats.mediaBitrate === null
                    ? "--"
                    : `${(stats.mediaBitrate / 1_000_000).toFixed(2)} Mbps`}
                </strong>
              </div>
              <div>
                <span>Dropped frames</span>
                <strong>{stats.droppedFrames}</strong>
              </div>
            </div>
          )}
        </section>
        <RoomSidebar
          currentUser={currentUser}
          members={members}
          messages={chatHistory}
          messageSequence={chatSequence}
          open={sidebarOpen}
          fullscreen={fullscreen}
          theatre={theatreActive}
          composeRequest={composeRequest}
          draft={chatMessage}
          onDraftChange={setChatMessage}
          onOpenChange={changeSidebarOpen}
          onSend={chat}
        />
      </div>
    </div>
  );
}
