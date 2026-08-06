import type Hls from "hls.js";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiWebSocketUrl } from "./api";

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
  variant: "blossom" | "carrot";
  x: number;
};

type RoomChat = {
  id: string;
  member: { avatar: string | null; id: string; name: string };
  message: string;
  x: number;
};

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
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isBuffering, setIsBuffering] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [members, setMembers] = useState<User[]>([currentUser]);
  const [syncLabel, setSyncLabel] = useState("Finding the live signal");
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [chats, setChats] = useState<RoomChat[]>([]);
  const [chatHistory, setChatHistory] = useState<RoomChat[]>([]);
  const [chatComposer, setChatComposer] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [showChatHistory, setShowChatHistory] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("lights-out", lightsOut);
    return () => document.body.classList.remove("lights-out");
  }, [lightsOut]);

  useEffect(() => {
    function reactionShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "f" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      react();
    }

    window.addEventListener("keydown", reactionShortcut);
    return () => window.removeEventListener("keydown", reactionShortcut);
  }, []);

  useEffect(() => {
    function chatShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== "c" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setChatComposer(true);
    }

    window.addEventListener("keydown", chatShortcut);
    return () => window.removeEventListener("keydown", chatShortcut);
  }, []);

  useEffect(() => {
    if (showChatHistory && chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory, showChatHistory]);

  useEffect(() => {
    let stopped = false;

    async function checkRelay() {
      try {
        const response = await apiFetch("/api/stream-info", { cache: "no-store" });
        if (!response.ok) return;
        const status = await response.json() as RelayStatus;
        if (!stopped) setRelayStatus(status);
      } catch {
        if (!stopped) setRelayStatus(null);
      }
    }

    void checkRelay();
    const timer = setInterval(checkRelay, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let clockPing: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function connect() {
      socket = new WebSocket(apiWebSocketUrl("/api/room"));
      socketRef.current = socket;
      socket.addEventListener("open", () => {
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
          if (message.type === "reaction" && message.id && message.variant && typeof message.x === "number") {
            const reaction = { id: message.id, variant: message.variant, x: message.x };
            setReactions((current) => [...current.slice(-7), reaction]);
            setTimeout(() => setReactions((current) => current.filter(({ id }) => id !== reaction.id)), 4_000);
          }
          if (message.type === "chat" && message.id && message.member && message.message && typeof message.x === "number") {
            const chat = { id: message.id, member: message.member, message: message.message, x: message.x };
            setChats((current) => [...current.slice(-5), chat]);
            setChatHistory((current) => [...current.slice(-49), chat]);
            setTimeout(() => setChats((current) => current.filter(({ id }) => id !== chat.id)), 6_000);
          }
        } catch {
          // Ignore malformed server messages and keep the current room state.
        }
      });
      socket.addEventListener("close", () => {
        clearInterval(clockPing);
        if (socketRef.current === socket) socketRef.current = null;
        if (!stopped) retry = setTimeout(connect, 2_000);
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

    async function checkStream() {
      try {
        const response = await apiFetch("/api/stream-status", { cache: "no-store" });
        const status = response.ok ? await response.json() as { online: boolean } : { online: false };
        if (stopped) return;
        setStreamOnline(status.online);
        if (!status.online) {
          setPlayerStatus("error");
          setIsBuffering(false);
          setSyncLabel("Stream is offline");
        } else {
          setPlayerStatus((current) => current === "error" ? "loading" : current);
        }
      } catch {
        if (!stopped) setStreamOnline(false);
      }
    }

    void checkStream();
    const timer = setInterval(checkStream, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
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

    async function attachStream(media: HTMLVideoElement) {
      const { default: HlsPlayer } = await import("hls.js");
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
          void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
        });
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setPlayerStatus("error");
            setStreamOnline(false);
          }
        });
        hlsRef.current = hls;
        void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
      } else if (media.canPlayType("application/vnd.apple.mpegurl")) {
        media.src = streamUrl;
        void media.play().catch(() => setSyncLabel("Tap the video to resume audio"));
      }
    }

    void attachStream(video);
    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [delaySeconds, streamOnline, streamUrl]);

  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setIsBuffering(true);
        setSyncLabel("Buffering the live stream...");
        return;
      }
      if (video.seeking) return;
      const hlsDate = hlsRef.current?.playingDate;
      let drift: number | null = null;
      if (hlsDate) {
        drift = (Date.now() + clockOffsetRef.current - delaySeconds * 1_000 - hlsDate.getTime()) / 1_000;
      } else if (video.seekable.length > 0) {
        drift = video.seekable.end(video.seekable.length - 1) - delaySeconds - video.currentTime;
      }
      if (drift !== null) setSyncLabel(Math.abs(drift) < 1 ? "Everyone is together" : "Following the live room");
      if (video.paused) void video.play().catch(() => undefined);
    }, 1_000);
    return () => clearInterval(timer);
  }, [delaySeconds]);

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
        if (video.currentTime >= start && video.currentTime <= end) bufferAhead = end - video.currentTime;
      }

      const playingDate = hlsRef.current?.playingDate;
      const liveEdge = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : null;
      const delay = playingDate
        ? (Date.now() + clockOffsetRef.current - playingDate.getTime()) / 1_000
        : liveEdge === null ? null : liveEdge - video.currentTime;
      const quality = video.getVideoPlaybackQuality?.();

      setStats({
        bandwidth: hlsRef.current?.bandwidthEstimate ?? null,
        bufferAhead,
        bufferTotal,
        delay,
        droppedFrames: quality?.droppedVideoFrames ?? 0,
        playtime: video.currentTime,
        rate: video.playbackRate,
        resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight}` : "--",
        seekableWindow: video.seekable.length > 0
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

  function toggleLightsOut() {
    const next = !lightsOut;
    setLightsOut(next);
    try {
      localStorage.setItem("bunny-plus-lights-out", String(next));
    } catch {
      // The visual mode still works when storage is unavailable.
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
              void videoRef.current?.play().catch(() => setSyncLabel("Tap the video to resume audio"));
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
          {(!streamUrl || streamOnline === false || playerStatus === "error") && (
            <div className="stream-error">
              {streamUrl ? "The stream is offline right now. This screen will reconnect when broadcasting resumes." : "Set STREAM_URL to connect the screen."}
            </div>
          )}
          <div className="reaction-layer" aria-live="polite">
            {reactions.map((reaction) => (
              <span className="room-reaction" style={{ "--reaction-x": `${reaction.x}%` } as CSSProperties} key={reaction.id}>
                <AssetIcon name={reaction.variant} />
              </span>
            ))}
            {chats.map((chat) => (
              <span className="room-chat" style={{ "--chat-x": `${chat.x}%` } as CSSProperties} key={chat.id}>
                <span className="room-chat-avatar">
                  {chat.member.avatar
                    ? <img src={chat.member.avatar} alt="" />
                    : <span>{chat.member.name[0]?.toUpperCase()}</span>}
                </span>
                <span className="room-chat-bubble"><strong>{chat.member.id === currentUser.id ? "you" : chat.member.name}</strong>{chat.message}</span>
              </span>
            ))}
          </div>
          <span className="reaction-shortcut-hint" aria-hidden="true">Press <kbd>F</kbd> to react</span>
          {chatComposer && (
            <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); chat(chatMessage); }}>
              <label htmlFor="chat-message">Say something cute</label>
              <div>
                <input
                  id="chat-message"
                  autoFocus
                  maxLength={64}
                  placeholder="omg..."
                  value={chatMessage}
                  onChange={(event) => setChatMessage(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape") setChatComposer(false); }}
                />
                <button type="submit">Send</button>
              </div>
            </form>
          )}
          {showChatHistory && (
            <aside className="chat-history-panel" aria-label="Chat history">
              <header><span>Chat history</span><button type="button" aria-label="Close chat history" onClick={() => setShowChatHistory(false)}>×</button></header>
              <div ref={chatHistoryRef}>
                {chatHistory.length === 0 && <p className="chat-history-empty">Quiet in here...</p>}
                {chatHistory.map((chat) => (
                  <div className="chat-history-entry" key={chat.id}>
                    <span className="chat-history-avatar">
                      {chat.member.avatar ? <img src={chat.member.avatar} alt="" /> : <span>{chat.member.name[0]?.toUpperCase()}</span>}
                    </span>
                    <p><strong>{chat.member.id === currentUser.id ? "you" : chat.member.name}</strong>{chat.message}</p>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
        <div className="screen-footer">
          <div className={`live-state ${streamOnline === false || relayStatus?.running === false ? "offline" : ""}`}>
            <i />
            <span>{streamOnline === null || relayStatus === null ? "CHECKING" : !streamOnline ? "OFFLINE" : relayStatus.running ? "LIVE" : "IDLE"}</span>
            {relayStatus?.running && (
              <span className="stream-title" title={relayStatus.title ?? "TorBox stream"}><AssetIcon name="carrot" /><span>{relayStatus.title ?? "TorBox stream"}</span></span>
            )}
            <span className="sync-copy">{syncLabel}</span>
          </div>
          <div className="player-actions">
            <label className="volume-control">
              <span aria-hidden="true"><UiIcon name={volume === 0 ? "volume-off" : "volume"} /></span>
              <span className="volume-slider" style={{ "--volume": `${volume * 100}%` } as CSSProperties}>
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
            </label>
            <button type="button" onClick={react}><UiIcon name="sparkle" /><span>React</span></button>
            <button type="button" aria-expanded={chatComposer} title="Chat (C)" onClick={() => setChatComposer((open) => !open)}><UiIcon name="chat" /><span>Chat</span></button>
            <button className={lightsOut ? "active" : ""} type="button" aria-pressed={lightsOut} onClick={toggleLightsOut}><UiIcon name="moon" /><span>Lights</span></button>
            <button type="button" onClick={() => screenRef.current?.requestFullscreen()}><UiIcon name="fullscreen" /><span>Expand</span></button>
            <details className="player-menu">
              <summary aria-label="More player options" title="More player options"><UiIcon name="gear" /></summary>
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
                  aria-expanded={showChatHistory}
                  onClick={(event) => {
                    setShowChatHistory((visible) => !visible);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  {showChatHistory ? "Hide chat history" : "Chat history"}
                </button>
                {streamUrl && (
                  <a href={streamUrl} target="_blank" rel="noreferrer">
                    Open in own player ↗
                    <small>May not stay in sync</small>
                  </a>
                )}
              </div>
            </details>
          </div>
        </div>
        {showStats && stats && (
          <div className="player-stats">
            <div><span>Delay</span><strong>{stats.delay === null ? "--" : `${stats.delay.toFixed(1)}s`}</strong></div>
            <div><span>Target</span><strong>{delaySeconds}s</strong></div>
            <div><span>Buffered ahead</span><strong>{stats.bufferAhead.toFixed(1)}s</strong></div>
            <div><span>Total buffered</span><strong>{stats.bufferTotal.toFixed(1)}s</strong></div>
            <div><span>Live window</span><strong>{stats.seekableWindow.toFixed(1)}s</strong></div>
            <div><span>Playtime</span><strong>{formatTime(stats.playtime)}</strong></div>
            <div><span>Playback rate</span><strong>{stats.rate.toFixed(3)}×</strong></div>
            <div><span>Resolution</span><strong>{stats.resolution}</strong></div>
            <div><span>Bandwidth</span><strong>{stats.bandwidth === null ? "--" : `${(stats.bandwidth / 1_000_000).toFixed(2)} Mbps`}</strong></div>
            <div><span>Dropped frames</span><strong>{stats.droppedFrames}</strong></div>
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
                {member.avatar
                  ? <img src={member.avatar} alt={member.name} />
                  : <span className="avatar-fallback" aria-label={member.name}>{member.name[0]?.toUpperCase()}</span>}
                <span className="avatar-hover-card" aria-hidden="true"><strong>{member.name}</strong></span>
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
