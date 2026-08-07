import type Hls from "hls.js";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiWebSocketUrl } from "./api";
import { playbackCorrection } from "./playback";

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
  running: boolean;
  title: string | null;
};

type RoomReaction = {
  id: string;
  member: { id: string; name: string };
  variant: "blossom" | "carrot";
  x: number;
};

type RoomChat = {
  id: string;
  member: { avatar: string | null; id: string; name: string };
  message: string;
  x: number;
};

type ChatDisplayMode = "bubbles" | "scrolling";
type OverlayChat = RoomChat & { lane: number };

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
  const screenRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef(0);
  const [volume, setVolume] = useState(savedVolume);
  const [lightsOut, setLightsOut] = useState(savedLightsOut);
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
      const target = event.target as HTMLElement | null;
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
      const target = event.target as HTMLElement | null;
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
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = new AbortController();

    async function checkRelay() {
      try {
        const response = await apiFetch("/api/stream-info", {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) return;
        const status = (await response.json()) as RelayStatus;
        if (!stopped) setRelayStatus(status);
      } catch {
        if (!stopped && !request.signal.aborted) setRelayStatus(null);
      } finally {
        if (!stopped) timer = setTimeout(checkRelay, 10_000);
      }
    }

    void checkRelay();
    return () => {
      stopped = true;
      request.abort();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let clockPing: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 2_000;
    let stopped = false;

    function connect() {
      socket = new WebSocket(apiWebSocketUrl("/api/room"));
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        retryDelay = 2_000;
        socket?.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        clockPing = setInterval(() => {
          socket?.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
        }, 30_000);
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            clientTime?: number;
            chats?: RoomChat[];
            members?: User[];
            serverTime?: number;
            type: string;
            id?: string;
            member?: { avatar: string | null; id: string; name: string };
            message?: string | null;
            variant?: "blossom" | "carrot";
            x?: number;
          };
          if (message.members) setMembers(message.members);
          if (message.chats) setChatHistory(message.chats);
          if (message.type === "pong" && message.clientTime && message.serverTime) {
            clockOffsetRef.current = message.serverTime - (message.clientTime + Date.now()) / 2;
          }
          if (
            message.type === "reaction" &&
            message.id &&
            message.member &&
            message.variant &&
            typeof message.x === "number"
          ) {
            const reaction = {
              id: message.id,
              member: message.member,
              variant: message.variant,
              x: message.x,
            };
            setReactions((current) => [...current.slice(-7), reaction]);
            setTimeout(
              () => setReactions((current) => current.filter(({ id }) => id !== reaction.id)),
              4_000,
            );
          }
          if (
            message.type === "chat" &&
            message.id &&
            message.member &&
            message.message &&
            typeof message.x === "number"
          ) {
            const chat = {
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
                  lane:
                    previousLane === undefined ? Math.floor(chat.x) % 6 : (previousLane + 1) % 6,
                },
              ];
            });
            setChatHistory((current) => [...current.slice(-49), chat]);
            setTimeout(
              () => setChats((current) => current.filter(({ id }) => id !== chat.id)),
              10_500,
            );
          }
        } catch {
          // Ignore malformed server messages and keep the current room state.
        }
      });
      socket.addEventListener("close", (event) => {
        clearInterval(clockPing);
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        if (event.code === 4001) {
          location.reload();
          return;
        }
        retry = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      });
      socket.addEventListener("error", () => socket?.close());
    }

    connect();
    return () => {
      stopped = true;
      clearInterval(clockPing);
      clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = new AbortController();

    async function checkStream() {
      try {
        const response = await apiFetch("/api/stream-status", {
          cache: "no-store",
          signal: request.signal,
        });
        const status = response.ok
          ? ((await response.json()) as { online: boolean })
          : { online: false };
        if (stopped) return;
        setStreamOnline(status.online);
        if (!status.online) {
          setPlayerStatus("error");
          setIsBuffering(false);
          setSyncLabel("Stream is offline");
        } else {
          setPlayerStatus((current) => (current === "error" ? "loading" : current));
        }
      } catch {
        if (!stopped && !request.signal.aborted) setStreamOnline(false);
      } finally {
        if (!stopped) timer = setTimeout(checkStream, 10_000);
      }
    }

    void checkStream();
    return () => {
      stopped = true;
      request.abort();
      clearTimeout(timer);
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
      const { default: HlsPlayer } = await import("hls.js/light");
      if (disposed) return;
      if (HlsPlayer.isSupported()) {
        const hls = new HlsPlayer({
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
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || playerStatus !== "ready") return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setIsBuffering(true);
        setSyncLabel("Buffering the live stream...");
        return;
      }
      if (video.seeking) return;
      const hlsDate = hlsRef.current?.playingDate;
      let drift: number | null = null;
      if (hlsDate) {
        drift =
          (Date.now() + clockOffsetRef.current - delaySeconds * 1_000 - hlsDate.getTime()) / 1_000;
      } else if (video.seekable.length > 0) {
        drift = video.seekable.end(video.seekable.length - 1) - delaySeconds - video.currentTime;
      }
      if (drift !== null) {
        const correction = playbackCorrection(drift);
        if (correction.seek && video.seekable.length > 0) {
          const minimum = video.seekable.start(0) + 0.1;
          const maximum = video.seekable.end(video.seekable.length - 1) - 0.1;
          if (maximum > minimum)
            video.currentTime = Math.min(maximum, Math.max(minimum, video.currentTime + drift));
        }
        video.playbackRate = correction.rate;
        setSyncLabel(correction.label);
      }
      if (video.paused) void video.play().catch(() => undefined);
    }, 1_000);
    return () => clearInterval(timer);
  }, [delaySeconds, playerStatus]);

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
          <div className="screen-frame" ref={screenRef}>
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
                setIsBuffering(true);
                setSyncLabel("Buffering the live stream...");
              }}
              onWaiting={() => {
                setIsBuffering(true);
                setSyncLabel("Buffering the live stream...");
              }}
              onClick={() => {
                if (videoRef.current?.paused) void videoRef.current.play();
              }}
            />
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
                  style={{ "--reaction-x": `${reaction.x}%` } as CSSProperties}
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
                    style={{ "--chat-y": `${12 + chat.lane * 13}%` } as CSSProperties}
                    key={chat.id}
                  >
                    <strong>{chat.member.name}</strong>
                    <span aria-hidden="true">: </span>
                    <span>{chat.message}</span>
                  </span>
                ) : (
                  <span
                    className="room-chat"
                    style={{ "--chat-x": `${chat.x}%` } as CSSProperties}
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
                      <span>{chat.message}</span>
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
                      <span>{chat.message}</span>
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
                  style={
                    {
                      "--volume": `calc(${volume * 100}% + ${11.5 - volume * 23}px)`,
                    } as CSSProperties
                  }
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
                aria-label="Enter fullscreen"
                onClick={() => screenRef.current?.requestFullscreen()}
              >
                <UiIcon name="fullscreen" />
                <span>Fullscreen</span>
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
                <div
                  className={`viewer-avatar${member.id === currentUser.id ? " current" : ""}`}
                  aria-label={`${member.name}${member.id === currentUser.id ? " (you)" : ""}`}
                >
                  {member.avatar ? (
                    <img src={member.avatar} alt={member.name} />
                  ) : (
                    <span className="avatar-fallback" aria-label={member.name}>
                      {member.name[0]?.toUpperCase()}
                    </span>
                  )}
                  <span className="avatar-particles" aria-hidden="true">
                    <span className="avatar-particle particle-carrot-one">
                      <AssetIcon name="carrot" />
                    </span>
                    <span className="avatar-particle particle-leafy-one">
                      <AssetIcon name="leafy" />
                    </span>
                    <span className="avatar-particle particle-bunny-one">
                      <AssetIcon animate={false} name="bunny-face" />
                    </span>
                    <span className="avatar-particle particle-carrot-two">
                      <AssetIcon name="carrot" />
                    </span>
                    <span className="avatar-particle particle-leafy-two">
                      <AssetIcon name="leafy" />
                    </span>
                    <span className="avatar-particle particle-bunny-two">
                      <AssetIcon animate={false} name="bunny-face" />
                    </span>
                  </span>
                  <span className="avatar-hover-card" aria-hidden="true">
                    <strong>{member.name}</strong>
                  </span>
                </div>
                {index < members.length - 1 && <AssetIcon className="carrot-link" name="carrot" />}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
