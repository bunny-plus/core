import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CinemaProgress, CinemaTicket } from "../shared/cinema";
import {
  chatHistoryLimit,
  type RoomChat,
  type RoomMember,
  type RoomReaction,
  type RoomServerMessage,
  type RoomClientMessage,
} from "../shared/room";
import { apiWebSocketUrl } from "./api";

export type OverlayChat = RoomChat & { lane: number; expiresAt: number };
export type OverlayReaction = RoomReaction & { expiresAt: number };

export function useRoomConnection(
  videoRef: RefObject<HTMLVideoElement | null>,
  currentUser: RoomMember,
  ticketPlaybackRef: RefObject<boolean>,
) {
  const socketRef = useRef<WebSocket | null>(null);
  const screeningIdRef = useRef("");
  const seenTicketIdsRef = useRef(new Set<string>());
  const [cinemaProgress, setCinemaProgress] = useState<CinemaProgress | null>(null);
  const [earnedTicket, setEarnedTicket] = useState<CinemaTicket | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([currentUser]);
  const [reactions, setReactions] = useState<OverlayReaction[]>([]);
  const [chats, setChats] = useState<OverlayChat[]>([]);
  const [chatHistory, setChatHistory] = useState<RoomChat[]>([]);
  const [chatSequence, setChatSequence] = useState(0);

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
          const message = JSON.parse(event.data as string) as RoomServerMessage;
          if (message.type === "welcome" || message.type === "presence")
            setMembers(message.members);
          if (message.type === "welcome") setChatHistory(message.chats.slice(-chatHistoryLimit));
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
          if (
            message.type === "reaction" &&
            message.id &&
            message.member &&
            message.variant &&
            message.x !== undefined &&
            Number.isFinite(message.x)
          ) {
            const reaction: OverlayReaction = {
              type: "reaction",
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
            const chat: RoomChat = {
              type: "chat",
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
            setChatHistory((current) => [...current.slice(-(chatHistoryLimit - 1)), chat]);
          }
        } catch {}
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
  }, [videoRef, ticketPlaybackRef]);

  const send = useCallback((message: RoomClientMessage) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(message));
    return true;
  }, []);
  const react = useCallback(() => {
    send({ type: "reaction" });
  }, [send]);
  function sendChat(message: string) {
    const text = message.trim();
    return !!text && send({ type: "chat", message: text });
  }
  return {
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
  };
}
