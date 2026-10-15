import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { chatMessageMaxLength } from "../shared/room";
import type { User } from "../shared/user";
import { AssetIcon, UiIcon } from "./Icons";
import { formatTime } from "./playback";
import RoomTickets from "./RoomTickets";
import PlaybackStats from "./PlaybackStats";
import { useDismissibleDetails } from "./useDismissibleDetails";
import { usePlayerPreferences } from "./usePlayerPreferences";
import { useStreamPlayback } from "./useStreamPlayback";
import { useRoomConnection } from "./useRoomConnection";
import { usePlaybackStats } from "./usePlaybackStats";
import { usePlayerAutoHide } from "./usePlayerAutoHide";
import RoomOverlay, { ChatMessage } from "./RoomOverlay";
import RoomSidebar from "./RoomSidebar";
import StreamBackstage from "./StreamBackstage";

function volumeStyle(volume: number): CSSProperties & { "--volume": string } {
  return { "--volume": `calc(${volume * 100}% + ${11.5 - volume * 23}px)` };
}

export default function WatchRoom({
  currentUser,
  streamConfigured,
}: {
  currentUser: User;
  streamConfigured: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const theatreButtonRef = useRef<HTMLButtonElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const playerMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(playerMenuRef);
  const {
    volume,
    setVolume,
    lightsOut,
    setLightsOut,
    slowConnection,
    setSlowConnection,
    shortcutsEnabled,
    setShortcutsEnabled,
    chatDisplayMode,
    setChatDisplayMode,
    sidebarOpen,
    setSidebarOpen,
    theatreMode,
    setTheatreMode,
  } = usePlayerPreferences();
  const [fullscreen, setFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [composeRequest, setComposeRequest] = useState(0);
  const [chatComposer, setChatComposer] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [showChatHistory, setShowChatHistory] = useState(false);
  const {
    peerRef,
    idleVideoRef,
    idleVideoEvents,
    idleReady,
    showIdle,
    startingPlayback,
    startupFailed,
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
    syncLabel,
    setSyncLabel,
    changeVolume,
    toggleMute,
    videoEvents,
    play,
    retryPlayback,
    refreshStream,
  } = useStreamPlayback(videoRef, {
    streamConfigured,
    volume,
    onVolumeChange: setVolume,
    slowConnection,
  });
  const {
    cinemaProgress,
    earnedTicket,
    setEarnedTicket,
    members,
    reactions,
    chats,
    chatHistory,
    chatSequence,
    react,
    sendChat,
  } = useRoomConnection(videoRef, currentUser, ticketPlaybackRef);
  const stats = usePlaybackStats(showIdle ? idleVideoRef : videoRef, peerRef, showStats);
  usePlayerAutoHide(playerRef, {
    playerStatus: showIdle && idleReady ? "ready" : playerStatus,
    isBuffering: !showIdle && isBuffering,
    chatComposer,
    showChatHistory,
    fullscreen,
    theatreMode,
  });

  const changeTheatreMode = useCallback(
    (enabled: boolean) => {
      setTheatreMode(enabled);
      if (enabled) setSidebarOpen(true);
    },
    [setTheatreMode, setSidebarOpen],
  );

  useEffect(() => {
    document.body.classList.toggle("lights-out", lightsOut);
    return () => {
      document.body.classList.remove("lights-out");
    };
  }, [lightsOut]);

  useEffect(() => {
    document.body.classList.toggle("theatre-mode", theatreMode);
    return () => document.body.classList.remove("theatre-mode");
  }, [theatreMode]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return;
      if (event.key === "Escape" && theatreMode && !document.fullscreenElement) {
        event.preventDefault();
        changeTheatreMode(false);
        theatreButtonRef.current?.focus({ preventScroll: true });
        return;
      }
      if (
        !shortcutsEnabled ||
        document.activeElement?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      switch (event.key.toLowerCase()) {
        case "t":
          if (document.fullscreenElement) return;
          changeTheatreMode(!theatreMode);
          break;
        case "f":
          react();
          break;
        case "c":
          if (fullscreen) setChatComposer(true);
          else {
            setSidebarOpen(true);
            setComposeRequest((current) => current + 1);
          }
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [shortcutsEnabled, theatreMode, fullscreen, changeTheatreMode, setSidebarOpen, react]);

  useEffect(() => {
    if (showChatHistory && chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory, showChatHistory, fullscreen]);

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

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else await playerRef.current?.requestFullscreen();
    } catch {
      setSyncLabel("Fullscreen is unavailable in this browser");
    }
  }

  function chat(message: string) {
    if (!sendChat(message)) return false;
    setChatMessage("");
    setChatComposer(false);
    return true;
  }

  return (
    <div className={`watch-content${theatreMode ? " watch-content--theatre" : ""}`}>
      <div className={`room-grid room-grid--sidebar${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <section className="screen-column">
          <div
            className={`screen-player${theatreMode ? " screen-player--theatre" : ""}`}
            ref={playerRef}
            tabIndex={-1}
          >
            <div className="screen-frame">
              <video
                ref={videoRef}
                autoPlay
                muted={volume === 0 || showIdle}
                playsInline
                {...videoEvents}
              />
              <video
                className={`idle-clip${showIdle ? "" : " idle-clip--hidden"}`}
                ref={idleVideoRef}
                src="/offline.mp4"
                autoPlay
                loop
                muted={volume === 0 || !showIdle}
                playsInline
                aria-hidden={!showIdle}
                {...idleVideoEvents}
              />
              {(streamOnline === null || playerStatus === "loading") &&
                !(showIdle && idleReady) &&
                streamConfigured &&
                !autoplayBlocked && (
                  <div className="stream-loading" role="status">
                    <AssetIcon name="carrot" />
                    <strong>Tuning the bunny ears...</strong>
                    <small>Waiting for the live stream</small>
                  </div>
                )}
              {(streamOnline === true || showIdle) &&
                autoplayBlocked &&
                playerStatus !== "error" && (
                  <div className="stream-loading">
                    <button className="stream-action" type="button" onClick={play}>
                      Tap to play
                    </button>
                  </div>
                )}
              {!showIdle && playerStatus === "ready" && isBuffering && !autoplayBlocked && (
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
                  This browser does not support live playback. Please try a current browser.
                </div>
              )}
              {playerStatus !== "unsupported" &&
                !startingPlayback &&
                (!streamConfigured ||
                  startupFailed ||
                  (streamOnline === false && !idlePlayback) ||
                  playerStatus === "error") && (
                  <div className="stream-error" role="status">
                    <span>
                      {!streamConfigured
                        ? "Playback is not connected yet."
                        : playbackAccessError
                          ? playbackAccessMessage
                          : streamOnline === false && !idlePlayback
                            ? "The stream is offline. Reconnecting when it returns."
                            : "Couldn't play the video. Reconnecting…"}
                    </span>
                    {streamConfigured && (streamOnline === true || showIdle) && (
                      <button className="stream-action" type="button" onClick={retryPlayback}>
                        Retry playback
                      </button>
                    )}
                  </div>
                )}
              <RoomOverlay reactions={reactions} chats={chats} chatDisplayMode={chatDisplayMode} />
              {shortcutsEnabled && (
                <span className="reaction-shortcut-hint" aria-hidden="true">
                  Press <kbd>F</kbd> to react
                </span>
              )}
            </div>
            <div className="screen-footer">
              <div
                className={`live-state ${(streamOnline === false && !startingPlayback) || idlePlayback ? "offline" : ""}`}
              >
                <span className="live-badge">
                  <i aria-hidden="true" />
                  <span>
                    {streamOnline === null || relayStatus === null
                      ? "CHECKING"
                      : startingPlayback
                        ? "STARTING"
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
                    {elapsedSeconds !== null && (
                      <span className="stream-runtime" title="Current playback time">
                        <UiIcon name="clock" />
                        <span>
                          {formatTime(elapsedSeconds)}
                          <span className="sr-only"> into the screening</span>
                        </span>
                      </span>
                    )}
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
                  <span className="volume-slider" style={volumeStyle(volume)}>
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
                {fullscreen && (
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
                {fullscreen && (
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
                  onClick={() => setLightsOut(!lightsOut)}
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
                {currentUser.admin && (
                  <StreamBackstage status={relayStatus} onStreamChange={refreshStream} />
                )}
                <details className="player-menu" ref={playerMenuRef} name="bunny-popover">
                  <summary aria-label="More player options" title="More player options">
                    <UiIcon name="gear" />
                  </summary>
                  <div className="player-menu-popover">
                    <button
                      type="button"
                      aria-pressed={slowConnection}
                      onClick={() => setSlowConnection(!slowConnection)}
                    >
                      Slow connection: {slowConnection ? "on" : "off"}
                      <small>Extra buffering where supported for uneven connections.</small>
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
                      onClick={() =>
                        setChatDisplayMode(chatDisplayMode === "bubbles" ? "scrolling" : "bubbles")
                      }
                    >
                      Chat overlay: {chatDisplayMode === "scrolling" ? "scrolling" : "bubbles"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={shortcutsEnabled}
                      onClick={() => setShortcutsEnabled(!shortcutsEnabled)}
                    >
                      Single-key shortcuts: {shortcutsEnabled ? "on" : "off"}
                    </button>
                  </div>
                </details>
              </div>
            </div>
            {fullscreen && (showChatHistory || chatComposer) && (
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
                        maxLength={chatMessageMaxLength}
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
          <RoomTickets
            showProgress={!showIdle && !!relayStatus?.running && relayStatus.online}
            progress={cinemaProgress}
            earnedTicket={earnedTicket}
            onDismiss={() => setEarnedTicket(null)}
          />
          {showStats && stats && (
            <PlaybackStats stats={stats} target={slowConnection ? "Extra buffer" : "Live"} />
          )}
        </section>
        <RoomSidebar
          currentUser={currentUser}
          members={members}
          messages={chatHistory}
          messageSequence={chatSequence}
          open={sidebarOpen}
          fullscreen={fullscreen}
          theatre={theatreMode}
          composeRequest={composeRequest}
          draft={chatMessage}
          onDraftChange={setChatMessage}
          onOpenChange={setSidebarOpen}
          onSend={chat}
        />
      </div>
    </div>
  );
}
