import type { CinemaProgress } from "./cinema";
import type { User } from "./user";

export const chatHistoryLimit = 200;
export const chatMessageMaxLength = 64;

export type RoomMember = Pick<User, "admin" | "avatar" | "id" | "name">;

export type RoomChat = {
  createdAt: string;
  id: string;
  member: RoomMember;
  message: string;
  type: "chat";
  x: number;
};

export type RoomReaction = {
  id: string;
  member: RoomMember;
  type: "reaction";
  variant: "blossom" | "carrot";
  x: number;
};

export type RoomClientMessage =
  | { clientTime: number; type: "ping" }
  | { type: "reaction" }
  | { type: "watching"; screeningId: string; playing: boolean }
  | { message: string; type: "chat" };

export type RoomServerMessage =
  | { type: "welcome"; chats: RoomChat[]; members: RoomMember[]; serverTime: number }
  | { type: "presence"; members: RoomMember[] }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "cinema-progress"; progress: CinemaProgress }
  | RoomChat
  | RoomReaction;
