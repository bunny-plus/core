import { randomUUID } from "node:crypto";

import WebSocket from "ws";

import { ChatHistory, type RoomChat } from "./chat-history";
import type { CinemaDiary } from "./cinema";
import type { JsonValue } from "./upstream";

export type RoomMember = {
  admin: boolean;
  avatar: string | null;
  id: string;
  name: string;
};

type RoomSession = {
  authorizationExpires: number;
  reauthorize?: () => Promise<{ member: RoomMember; expires: number } | null>;
  connectionId: string;
  expiry: NodeJS.Timeout;
  lastSeen: number;
  messageCount: number;
  messageWindowStarted: number;
  member: RoomMember;
};

type MemberActivity = {
  lastChat?: number;
  lastReaction?: number;
};

type RoomClientMessage =
  | { clientTime: number; type: "ping" }
  | { type: "reaction" }
  | { type: "watching"; screeningId: string; playing: boolean }
  | { message: string; type: "chat" };

function isRoomClientMessage(value: JsonValue): value is RoomClientMessage {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  if (value.type === "reaction") return true;
  if (value.type === "watching")
    return (
      typeof value.screeningId === "string" &&
      value.screeningId.length <= 100 &&
      typeof value.playing === "boolean"
    );
  if (value.type === "ping") {
    return typeof value.clientTime === "number" && Number.isFinite(value.clientTime);
  }
  return value.type === "chat" && typeof value.message === "string";
}

const presenceTimeout = 2 * 60 * 1_000;
const presenceSweepInterval = 30 * 1_000;
const messageWindow = 10_000;
const maxMessagesPerWindow = 20;
const maxConnections = 200;
const maxConnectionsPerMember = 5;
const maxBufferedAmount = 64 * 1_024;
const authorizationCheckInterval = 60_000;

export class WatchRoom {
  private readonly memberActivity = new Map<string, MemberActivity>();
  private readonly sessions = new Map<WebSocket, RoomSession>();
  private readonly sweep: NodeJS.Timeout;

  constructor(
    private readonly chatHistory: ChatHistory,
    private readonly cinema?: CinemaDiary,
  ) {
    this.sweep = setInterval(() => this.sweepPresence(), presenceSweepInterval);
    this.sweep.unref();
  }

  connect(
    socket: WebSocket,
    member: RoomMember,
    authorizationExpires: number,
    reauthorize?: RoomSession["reauthorize"],
  ) {
    const memberConnections = [...this.sessions.values()].filter(
      (session) => session.member.id === member.id,
    ).length;
    if (this.sessions.size >= maxConnections || memberConnections >= maxConnectionsPerMember) {
      socket.close(4008, "Too many room connections");
      return;
    }

    const now = Date.now();
    if (authorizationExpires <= now) {
      socket.close(4001, "Session expired");
      return;
    }
    const expiry = setTimeout(
      () => void this.checkAuthorization(socket),
      Math.min(authorizationExpires - now, authorizationCheckInterval),
    );
    expiry.unref();
    this.sessions.set(socket, {
      authorizationExpires,
      reauthorize,
      connectionId: randomUUID(),
      expiry,
      lastSeen: now,
      member,
      messageCount: 0,
      messageWindowStarted: now,
    });
    socket.on("message", (value, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text messages only");
        return;
      }
      this.message(socket, value.toString());
    });
    socket.on("close", () => this.disconnect(socket));
    socket.on("error", () => this.disconnect(socket));
    this.send(
      socket,
      JSON.stringify({
        chats: this.chatHistory.all(),
        members: this.members(),
        serverTime: Date.now(),
        type: "welcome",
      }),
    );
    this.sendCinemaProgress(socket, member.id);
    this.broadcastPresence();
  }

  private async checkAuthorization(socket: WebSocket) {
    const session = this.sessions.get(socket);
    if (!session) return;
    try {
      if (session.reauthorize) {
        const authorization = await session.reauthorize();
        if (this.sessions.get(socket) !== session) return;
        if (!authorization || authorization.member.id !== session.member.id) {
          socket.close(4001, "Session expired");
          return;
        }
        const changed = JSON.stringify(session.member) !== JSON.stringify(authorization.member);
        session.member = authorization.member;
        session.authorizationExpires = authorization.expires;
        if (changed) this.broadcastPresence();
      }
      const remaining = session.authorizationExpires - Date.now();
      if (remaining <= 0) {
        socket.close(4001, "Session expired");
        return;
      }
      session.expiry = setTimeout(
        () => void this.checkAuthorization(socket),
        Math.min(remaining, authorizationCheckInterval),
      );
      session.expiry.unref();
    } catch {
      // A temporary Discord outage should reconnect the room without logging the viewer out.
      socket.close(4002, "Session check unavailable");
    }
  }

  private message(socket: WebSocket, value: string) {
    try {
      const session = this.sessions.get(socket);
      if (!session) return;
      const now = Date.now();
      if (now - session.messageWindowStarted >= messageWindow) {
        session.messageCount = 0;
        session.messageWindowStarted = now;
      }
      session.messageCount += 1;
      if (session.messageCount > maxMessagesPerWindow) {
        socket.close(4008, "Room message limit exceeded");
        return;
      }

      const message: JsonValue = JSON.parse(value);
      if (!isRoomClientMessage(message)) return;
      if (message.type === "ping") {
        session.lastSeen = now;
        this.send(
          socket,
          JSON.stringify({ clientTime: message.clientTime, serverTime: now, type: "pong" }),
        );
      }
      if (message.type === "watching") {
        session.lastSeen = now;
        try {
          const progress = this.cinema?.watching(
            session.member.id,
            session.connectionId,
            message.screeningId,
            message.playing,
            now,
          );
          if (progress) this.send(socket, JSON.stringify({ type: "cinema-progress", progress }));
        } catch (error) {
          console.error("Could not save cinema watch progress", error);
        }
      }
      if (message.type === "reaction") {
        const activity = this.memberActivity.get(session.member.id) ?? {};
        if (now - (activity.lastReaction ?? 0) < 1_500) return;
        activity.lastReaction = now;
        this.memberActivity.set(session.member.id, activity);
        session.lastSeen = now;
        this.broadcast(
          JSON.stringify({
            id: randomUUID(),
            member: session.member,
            type: "reaction",
            variant: Math.random() < 0.5 ? "carrot" : "blossom",
            x: 18 + Math.round(Math.random() * 64),
          }),
        );
      }
      if (message.type === "chat") {
        const activity = this.memberActivity.get(session.member.id) ?? {};
        if (now - (activity.lastChat ?? 0) < 1_500) return;
        const text = message.message.replace(/\s+/g, " ").trim().slice(0, 64);
        if (!text) return;
        activity.lastChat = now;
        this.memberActivity.set(session.member.id, activity);
        session.lastSeen = now;
        const chat: RoomChat = {
          createdAt: new Date(now).toISOString(),
          id: randomUUID(),
          member: session.member,
          message: text,
          type: "chat",
          x: 18 + Math.round(Math.random() * 64),
        };
        try {
          this.chatHistory.append(chat);
        } catch (error) {
          console.error("Could not persist room chat", error);
          return;
        }
        this.broadcast(JSON.stringify(chat));
      }
    } catch {
      // Malformed messages have no effect on room state.
    }
  }

  private disconnect(socket: WebSocket) {
    const session = this.sessions.get(socket);
    if (!session) return;
    clearTimeout(session.expiry);
    this.cinema?.disconnect(session.connectionId);
    this.sessions.delete(socket);
    this.broadcastPresence();
  }

  private sweepPresence() {
    const cutoff = Date.now() - presenceTimeout;
    let changed = false;
    for (const [socket, session] of this.sessions) {
      if (session.lastSeen >= cutoff) continue;
      socket.close(4000, "Activity timeout");
      clearTimeout(session.expiry);
      this.cinema?.disconnect(session.connectionId);
      this.sessions.delete(socket);
      changed = true;
    }
    const activeMembers = new Set([...this.sessions.values()].map(({ member }) => member.id));
    for (const [memberId, activity] of this.memberActivity) {
      const lastActivity = Math.max(activity.lastChat ?? 0, activity.lastReaction ?? 0);
      if (!activeMembers.has(memberId) && lastActivity < cutoff)
        this.memberActivity.delete(memberId);
    }
    if (changed) this.broadcastPresence();
  }

  private members() {
    return [
      ...new Map([...this.sessions.values()].map(({ member }) => [member.id, member])).values(),
    ];
  }

  private sendCinemaProgress(socket: WebSocket, memberId: string) {
    try {
      const progress = this.cinema?.progress(memberId);
      if (progress) this.send(socket, JSON.stringify({ type: "cinema-progress", progress }));
    } catch (error) {
      console.error("Could not read cinema watch progress", error);
    }
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ members: this.members(), type: "presence" }));
  }

  private broadcast(message: string) {
    for (const socket of this.sessions.keys()) {
      this.send(socket, message);
    }
  }

  private send(socket: WebSocket, message: string) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedAmount) {
      socket.terminate();
      return;
    }
    socket.send(message, (error) => {
      if (error) socket.terminate();
    });
  }
}
