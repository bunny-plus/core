import type Hls from "hls.js";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiWebSocketUrl } from "./api";
import { parseChatEffects } from "./chat-effects";
import { PlaybackSynchronizer } from "./playback";
import { JellyfinSubtitles } from "./JellyfinSubtitles";
import type { JellyfinPlayback } from "../shared/jellyfin";
import { CinemaTicketCard } from "./CinemaDiary";
import type { CinemaProgress, CinemaTicket } from "../shared/cinema";

export type User = {
  admin: boolean;
  avatar: string | null;
  id: string;
  name: string;
  permissions?: string[];
};

type PlayerStats = {
  bandwidth: number | null;
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
  running: boolean;
  title: string | null;
  upstreamStatus: number | null;
  jellyfin?: JellyfinPlayback;
};

type RoomReaction = {
  expiresAt: number;
  id: string;
  member: { id: string; name: string };
  variant: "blossom" | "carrot";
  x: number;
};

type RoomChat = {
  createdAt: string;
  id: string;
  member: { avatar: string | null; id: string; name: string };
  message: string;
  x: number;
};

type ChatDisplayMode = "bubbles" | "scrolling";
type OverlayChat = RoomChat & { lane: number; expiresAt: number };
type ParticleVariant = "blossom" | "bunny-face" | "carrot" | "leafy";
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

type ViewerParticle = {
  age: number;
  bounces: number;
  id: number;
  lifetime: number;
  rotation: number;
  size: number;
  spin: number;
  variant: ParticleVariant;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

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

const viewerConnectorCharms = ["blossom", "leafy", "bunny-face"] as const;
const particleThemes: ParticleVariant[][] = [
  ["carrot", "leafy"],
  ["blossom", "bunny-face"],
  ["carrot", "blossom", "leafy"],
  ["bunny-face", "leafy", "blossom"],
];

function newViewerParticle(id: number, theme: ParticleVariant[]): ViewerParticle {
  return {
    age: 0,
    bounces: 0,
    id,
    lifetime: 1.05 + Math.random() * 0.65,
    rotation: Math.random() * 90 - 45,
    size: 17 + Math.random() * 12,
    spin: Math.random() * 260 - 130,
    variant: theme[Math.floor(Math.random() * theme.length)] ?? "blossom",
    vx: Math.random() * 190 - 95,
    vy: -(75 + Math.random() * 105),
    x: Math.random() * 10 - 5,
    y: Math.random() * 8 - 2,
  };
}

function ViewerParticleEmitter({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<ViewerParticle[]>([]);
  const activeRef = useRef(active);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const nextIdRef = useRef(0);
  const particlesRef = useRef<ViewerParticle[]>([]);
  const spawnTimeRef = useRef(0);
  const themeRef = useRef<ParticleVariant[]>(particleThemes[0]!);
  const tickRef = useRef<(time: number) => void>(() => undefined);

  tickRef.current = (time: number) => {
    const delta = Math.min((time - lastFrameRef.current) / 1_000, 0.034);
    lastFrameRef.current = time;
    spawnTimeRef.current += delta;

    const next = particlesRef.current
      .map((particle) => {
        const drag = Math.pow(0.982, delta * 60);
        let vx = particle.vx * drag;
        let vy = particle.vy + 270 * delta;
        let x = particle.x + vx * delta;
        let y = particle.y + vy * delta;
        let bounces = particle.bounces;
        if (y > 40 && vy > 0 && bounces === 0) {
          y = 40;
          vy *= -0.36;
          vx *= 0.72;
          bounces += 1;
        }
        return {
          ...particle,
          age: particle.age + delta,
          bounces,
          rotation: particle.rotation + particle.spin * delta,
          vx,
          vy,
          x,
          y,
        };
      })
      .filter((particle) => particle.age < particle.lifetime);

    if (activeRef.current) {
      while (spawnTimeRef.current >= 0.085 && next.length < 16) {
        spawnTimeRef.current -= 0.085;
        next.push(newViewerParticle(nextIdRef.current++, themeRef.current));
      }
    }

    particlesRef.current = next;
    setParticles(next);
    if (activeRef.current || next.length > 0) {
      frameRef.current = requestAnimationFrame((nextTime) => tickRef.current(nextTime));
    } else {
      frameRef.current = null;
    }
  };

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      themeRef.current = particleThemes[Math.floor(Math.random() * particleThemes.length)]!;
      spawnTimeRef.current = 0.085;
      if (frameRef.current === null && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        lastFrameRef.current = performance.now();
        frameRef.current = requestAnimationFrame((time) => tickRef.current(time));
      }
    }
  }, [active]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  return (
    <span className="avatar-particle-field" aria-hidden="true">
      {particles.map((particle) => {
        const opacity = Math.min(1, particle.age / 0.1, (particle.lifetime - particle.age) / 0.28);
        const scale = 0.45 + Math.min(1, particle.age / 0.16) * 0.55;
        return (
          <span
            className="physics-particle"
            style={{
              height: particle.size,
              opacity,
              transform: `translate(-50%, -50%) translate3d(${particle.x}px, ${particle.y}px, 0) rotate(${particle.rotation}deg) scale(${scale})`,
              width: particle.size,
            }}
            key={particle.id}
          >
            <AssetIcon animate={false} name={particle.variant} />
          </span>
        );
      })}
    </span>
  );
}

function ViewerAvatar({ current, member }: { current: boolean; member: User }) {
  const [spraying, setSpraying] = useState(false);
  return (
    <div
      className={`viewer-avatar${current ? " current" : ""}`}
      aria-label={`${member.name}${current ? " (you)" : ""}`}
      onPointerEnter={() => setSpraying(true)}
      onPointerLeave={() => setSpraying(false)}
    >
      {member.avatar ? (
        <img src={member.avatar} alt={member.name} />
      ) : (
        <span className="avatar-fallback" aria-label={member.name}>
          {member.name[0]?.toUpperCase()}
        </span>
      )}
      <ViewerParticleEmitter active={spraying} />
      <span className="avatar-hover-card" aria-hidden="true">
        <strong>{member.name}</strong>
      </span>
    </div>
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
  const subtitleOverlayRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef(0);
  const screeningIdRef = useRef("");
  const ticketPlaybackRef = useRef(false);
  const seenTicketIdsRef = useRef(new Set<string>());
  const [cinemaProgress, setCinemaProgress] = useState<CinemaProgress | null>(null);
  const [earnedTicket, setEarnedTicket] = useState<CinemaTicket | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  const [lightsOut, setLightsOut] = useState(savedLightsOut);
  const [fullscreen, setFullscreen] = useState(false);
  const initialVolumeRef = useRef(volume);
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 0.5);
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"loading" | "ready" | "error" | "unsupported">(
    "loading",
  );
  const [isBuffering, setIsBuffering] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [members, setMembers] = useState<User[]>([currentUser]);
  const [syncLabel, setSyncLabel] = useState("Finding the live signal");
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [chats, setChats] = useState<OverlayChat[]>([]);
  const [chatHistory, setChatHistory] = useState<RoomChat[]>([]);
  const [chatComposer, setChatComposer] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(savedShortcuts);
  const [chatDisplayMode, setChatDisplayMode] = useState(savedChatDisplayMode);

  useEffect(() => {
    document.body.classList.toggle("lights-out", lightsOut);
    return () => document.body.classList.remove("lights-out");
  }, [lightsOut]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function reactionShortcut(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
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
    return () => window.removeEventListener("keydown", reactionShortcut);
  }, [shortcutsEnabled]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function chatShortcut(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
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
      setChatComposer(true);
    }

    window.addEventListener("keydown", chatShortcut);
    return () => window.removeEventListener("keydown", chatShortcut);
  }, [shortcutsEnabled]);

  useEffect(() => {
    if (showChatHistory && chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory, showChatHistory]);

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
    if (!screen || playerStatus !== "ready" || isBuffering || chatComposer || showChatHistory)
      return;
    let timer: ReturnType<typeof setTimeout>;
    let keyboardInteraction = false;
    let pointerDown = false;
    const reveal = (event?: Event) => {
      if (event?.type === "keydown") keyboardInteraction = true;
      else if (event?.type.startsWith("pointer")) keyboardInteraction = false;
      if (event?.type === "pointerdown") pointerDown = true;
      screen.classList.remove("cursor-idle");
      clearTimeout(timer);
      timer = setTimeout(() => {
        const focused = document.activeElement;
        if (
          (document.fullscreenElement === screen || screen.matches(":hover")) &&
          !pointerDown &&
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
      }, 3_000);
    };
    const leave = () => {
      if (document.fullscreenElement === screen) reveal();
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
  }, [playerStatus, isBuffering, chatComposer, showChatHistory]);

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
        ticketPlaybackRef.current = status.running && status.online;
        setRelayStatus(status);
        // A failed availability probe must not interrupt media that is still buffered.
        if (
          !status.online &&
          (videoRef.current?.readyState ?? 0) >= HTMLMediaElement.HAVE_FUTURE_DATA
        )
          return;
        setStreamOnline(status.online);
        if (!status.online) {
          setPlayerStatus("error");
          setIsBuffering(false);
          setSyncLabel("Stream is offline");
        } else {
          setPlayerStatus((current) => (current === "error" ? "loading" : current));
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
  }, []);

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
    const video = videoRef.current;
    if (!video || !streamUrl || streamOnline !== true) return;
    setPlayerStatus("loading");
    video.volume = initialVolumeRef.current;
    video.muted = initialVolumeRef.current === 0;
    video.defaultMuted = initialVolumeRef.current === 0;
    let disposed = false;
    let attachedHls: Hls | null = null;

    async function attachStream(media: HTMLVideoElement) {
      const { default: HlsPlayer } = await import("hls.js");
      if (disposed) return;
      if (HlsPlayer.isSupported()) {
        const hls = new HlsPlayer({
          lowLatencyMode: false,
          maxLiveSyncPlaybackRate: 1,
          backBufferLength: 10,
          liveSyncDuration: delaySeconds,
          liveMaxLatencyDuration: Math.max(delaySeconds + 15, delaySeconds * 2),
          maxBufferLength: 12,
          maxMaxBufferLength: 20,
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(media);
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
        });
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (disposed) return;
          if (data.fatal) {
            setPlayerStatus("error");
            setStreamOnline(false);
          }
        });
        attachedHls = hls;
        hlsRef.current = hls;
        void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
      } else if (media.canPlayType("application/vnd.apple.mpegurl")) {
        media.src = streamUrl;
        void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
      } else {
        setPlayerStatus("unsupported");
        setIsBuffering(false);
        setSyncLabel("HLS playback is unsupported");
      }
    }

    void attachStream(video);
    return () => {
      disposed = true;
      attachedHls?.destroy();
      if (hlsRef.current === attachedHls) hlsRef.current = null;
      video.pause();
      video.playbackRate = 1;
      video.removeAttribute("src");
      video.load();
    };
  }, [delaySeconds, streamOnline, streamUrl]);

  useEffect(() => {
    const synchronizer = new PlaybackSynchronizer();
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || playerStatus !== "ready") return;
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
      const correction = synchronizer.update(video, target, performance.now());
      if (correction.position !== null) video.currentTime = correction.position;
      video.playbackRate = correction.rate;
      if (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
        setSyncLabel(correction.label);
      if (video.paused) void video.play().catch(() => undefined);
    }, 1_000);
    return () => clearInterval(timer);
  }, [delaySeconds, playerStatus, streamUrl]);

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
      const delay = playingDate
        ? (Date.now() + clockOffsetRef.current - playingDate.getTime()) / 1_000
        : liveEdge === null
          ? null
          : liveEdge - video.currentTime;
      const quality = video.getVideoPlaybackQuality?.();

      setStats({
        bandwidth: hlsRef.current?.bandwidthEstimate ?? null,
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
    if (value > 0) lastAudibleVolumeRef.current = value;
    setVolume(value);
    try {
      localStorage.setItem("bunny-plus-volume", String(value));
    } catch {
      // Playback still works when storage is unavailable.
    }
    if (value > 0 && video.paused) {
      void video.play().catch(() => setSyncLabel("Tap the video to resume audio"));
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
    }
  }

  return (
    <div className="watch-content">
      <div className="room-grid">
        <section className="screen-column">
          <div className="screen-player" ref={playerRef} tabIndex={-1}>
            <div className="screen-frame">
              <video
                ref={videoRef}
                autoPlay
                muted={volume === 0}
                playsInline
                onCanPlay={() => {
                  setPlayerStatus("ready");
                  setIsBuffering(false);
                  void videoRef.current
                    ?.play()
                    .catch(() => setSyncLabel("Tap the video to resume audio"));
                }}
                onError={() => setPlayerStatus("error")}
                onLoadedData={() => setPlayerStatus("ready")}
                onPlaying={() => setIsBuffering(false)}
                onStalled={() => {
                  if ((videoRef.current?.readyState ?? 0) < HTMLMediaElement.HAVE_FUTURE_DATA) {
                    setIsBuffering(true);
                    setSyncLabel("Buffering the live stream...");
                  }
                }}
                onWaiting={() => {
                  setIsBuffering(true);
                  setSyncLabel("Buffering the live stream...");
                }}
                onClick={() => {
                  if (videoRef.current?.paused) void videoRef.current.play();
                }}
              />
              <div className="jellyfin-subtitles" ref={subtitleOverlayRef} />
              {(streamOnline === null || playerStatus === "loading") && streamUrl && (
                <div className="stream-loading" role="status">
                  <AssetIcon name="carrot" />
                  <strong>Tuning the bunny ears...</strong>
                  <small>Waiting for the live stream</small>
                </div>
              )}
              {playerStatus === "ready" && isBuffering && (
                <div className="stream-loading buffering-overlay" role="status">
                  <AssetIcon name="carrot" />
                  <strong>Buffering the live stream...</strong>
                  <small>Catching everybun back up</small>
                </div>
              )}
              {playerStatus === "unsupported" && (
                <div className="stream-error" role="status">
                  This browser does not support HLS playback. Open the stream in an HLS-capable
                  browser or player.
                </div>
              )}
              {playerStatus !== "unsupported" &&
                (!streamUrl || streamOnline === false || playerStatus === "error") && (
                  <div className="stream-error">
                    {streamUrl
                      ? "The stream is offline right now. This screen will reconnect when broadcasting resumes."
                      : "Set STREAM_URL to connect the screen."}
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
            </div>
            <div className="screen-footer">
              <div
                className={`live-state ${streamOnline === false || relayStatus?.running === false ? "offline" : ""}`}
              >
                <i aria-hidden="true" />
                <span>
                  {streamOnline === null || relayStatus === null
                    ? "CHECKING"
                    : !streamOnline
                      ? "OFFLINE"
                      : relayStatus.running
                        ? "LIVE"
                        : "IDLE"}
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
                {relayStatus?.running && relayStatus.jellyfin && (
                  <JellyfinSubtitles
                    key={relayStatus.jellyfin.sessionId}
                    playback={relayStatus.jellyfin}
                    videoRef={videoRef}
                    hlsRef={hlsRef}
                    overlayRef={subtitleOverlayRef}
                  />
                )}
                <button
                  type="button"
                  aria-label="React"
                  data-tooltip={shortcutsEnabled ? "Press F to react" : undefined}
                  onClick={react}
                >
                  <UiIcon name="sparkle" />
                  <span>React</span>
                </button>
                <button
                  type="button"
                  aria-label="Chat"
                  aria-expanded={chatComposer}
                  data-tooltip={shortcutsEnabled ? "Press C to chat" : undefined}
                  onClick={() =>
                    setChatComposer((open) => {
                      if (open) setChatMessage("");
                      return !open;
                    })
                  }
                >
                  <UiIcon name="chat" />
                  <span>Chat</span>
                </button>
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
                <button
                  type="button"
                  ref={fullscreenButtonRef}
                  aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  onClick={() => void toggleFullscreen()}
                >
                  <UiIcon name="fullscreen" />
                  <span>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
                </button>
                <details className="player-menu">
                  <summary aria-label="More player options" title="More player options">
                    <UiIcon name="gear" />
                  </summary>
                  <div className="player-menu-popover">
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
                      <a href={streamUrl} target="_blank" rel="noreferrer">
                        Open in own player ↗<small>May not stay in sync</small>
                      </a>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </div>
          {relayStatus?.running &&
            relayStatus.online &&
            cinemaProgress?.screening?.ticketCountingEnabled &&
            (cinemaProgress.screening.ticketDesign || cinemaProgress.ticket) && (
              <div className="cinema-ticket-progress">
                <UiIcon name="ticket" />
                <div>
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
                <Link to="/diary">My tickets ↗</Link>
              </div>
            )}
          {earnedTicket && (
            <aside className="cinema-ticket-award" aria-label="New cinema ticket">
              <div className="cinema-ticket-award-heading">
                <p role="status">Ticket collected</p>
                <button
                  type="button"
                  aria-label="Dismiss ticket"
                  onClick={() => setEarnedTicket(null)}
                >
                  ×
                </button>
              </div>
              <CinemaTicketCard ticket={earnedTicket} compact />
              <Link to="/diary">See your collection ↗</Link>
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
                <strong>{delaySeconds}s</strong>
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
                <span>Bandwidth</span>
                <strong>
                  {stats.bandwidth === null
                    ? "--"
                    : `${(stats.bandwidth / 1_000_000).toFixed(2)} Mbps`}
                </strong>
              </div>
              <div>
                <span>Dropped frames</span>
                <strong>{stats.droppedFrames}</strong>
              </div>
            </div>
          )}
        </section>
        <aside className="audience-panel">
          <div className="member-list">
            {members.map((member, index) => (
              <div className="viewer-entry" key={member.id}>
                <ViewerAvatar current={member.id === currentUser.id} member={member} />
                {index < members.length - 1 && (
                  <span className="viewer-link" aria-hidden="true">
                    <span className="viewer-link-track">
                      <svg className="viewer-link-trail" viewBox="0 0 52 44" focusable="false">
                        <path className="viewer-link-ribbon" d="M26 0C8 10 45 29 26 44" />
                        <path className="viewer-link-stitches" d="M26 0C8 10 45 29 26 44" />
                      </svg>
                      <AssetIcon
                        animate={false}
                        className="viewer-link-charm"
                        name={viewerConnectorCharms[index % viewerConnectorCharms.length]}
                      />
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
