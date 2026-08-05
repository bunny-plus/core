import { randomUUID } from "node:crypto";

import type WebSocket from "ws";

export type RoomMember = {
  admin: boolean;
  avatar: string | null;
  id: string;
  name: string;
};

type RoomSession = {
  lastReaction?: number;
  lastSeen: number;
  member: RoomMember;
};

const presenceTimeout = 2 * 60 * 1_000;
const presenceSweepInterval = 30 * 1_000;

export class WatchRoom {
  private readonly sessions = new Map<WebSocket, RoomSession>();
  private readonly sweep: NodeJS.Timeout;

  constructor() {
    this.sweep = setInterval(() => this.sweepPresence(), presenceSweepInterval);
    this.sweep.unref();
  }

  connect(socket: WebSocket, member: RoomMember) {
    this.sessions.set(socket, { lastSeen: Date.now(), member });
    socket.on("message", (value) => this.message(socket, value.toString()));
    socket.on("close", () => this.disconnect(socket));
    socket.on("error", () => this.disconnect(socket));
    socket.send(JSON.stringify({ members: this.members(), serverTime: Date.now(), type: "welcome" }));
    this.broadcastPresence();
  }

  private message(socket: WebSocket, value: string) {
    try {
      const message = JSON.parse(value) as { clientTime?: number; message?: unknown; type?: string };
      if (message.type === "ping" && typeof message.clientTime === "number") {
        const session = this.sessions.get(socket);
        if (session) session.lastSeen = Date.now();
        socket.send(JSON.stringify({ clientTime: message.clientTime, serverTime: Date.now(), type: "pong" }));
      }
      if (message.type === "reaction") {
        const session = this.sessions.get(socket);
        const now = Date.now();
        if (!session || now - (session.lastReaction ?? 0) < 1_500) return;
        session.lastReaction = now;
        session.lastSeen = now;
        const text = typeof message.message === "string"
          ? message.message.replace(/\s+/g, " ").trim().slice(0, 64)
          : "";
        this.broadcast(JSON.stringify({
          id: randomUUID(),
          member: { id: session.member.id, name: session.member.name },
          message: text || null,
          type: "reaction",
          variant: Math.random() < 0.5 ? "carrot" : "blossom",
          x: 18 + Math.round(Math.random() * 64),
        }));
      }
    } catch {
      // Malformed messages have no effect on room state.
    }
  }

  private disconnect(socket: WebSocket) {
    if (!this.sessions.delete(socket)) return;
    this.broadcastPresence();
  }

  private sweepPresence() {
    const cutoff = Date.now() - presenceTimeout;
    let changed = false;
    for (const [socket, session] of this.sessions) {
      if (session.lastSeen >= cutoff) continue;
      socket.close(4000, "Activity timeout");
      this.sessions.delete(socket);
      changed = true;
    }
    if (changed) this.broadcastPresence();
  }

  private members() {
    return [...new Map([...this.sessions.values()].map(({ member }) => [member.id, member])).values()];
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ members: this.members(), type: "presence" }));
  }

  private broadcast(message: string) {
    for (const socket of this.sessions.keys()) {
      try {
        socket.send(message);
      } catch {
        this.sessions.delete(socket);
      }
    }
  }
}
