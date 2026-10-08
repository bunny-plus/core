import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket, { WebSocketServer } from "ws";

import { ChatHistory } from "./chat-history";
import { WatchRoom, type RoomMember } from "./room";

const day = 24 * 60 * 60 * 1_000;
const member: RoomMember = { admin: true, avatar: null, id: "bunny", name: "Bunny" };

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}

async function connection(
  context: TestContext,
  expires: number,
  reauthorize?: () => Promise<{ member: RoomMember; expires: number } | null>,
) {
  const directory = await mkdtemp(join(tmpdir(), "bunny-room-auth-"));
  const history = new ChatHistory(join(directory, "chat.sqlite"), 200);
  const room = new WatchRoom(history);
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  context.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    history.close();
    await rm(directory, { recursive: true, force: true });
  });
  server.on("connection", (socket) => room.connect(socket, member, expires, reauthorize));
  await once(server, "listening");
  const address = server.address();
  assert.ok(isTcpAddress(address));
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  context.after(() => client.terminate());
  let initialMessages = 0;
  const ready = new Promise<void>((resolve) => {
    client.on("message", () => {
      initialMessages += 1;
      if (initialMessages === 2) resolve();
    });
  });
  await ready;
  return client;
}

test("a thirty-day session does not overflow Node's timer and disconnect immediately", async (context) => {
  const client = await connection(context, Date.now() + 30 * day);
  await delay(25);
  assert.equal(client.readyState, WebSocket.OPEN);
});

test("room authorization follows renewed sessions and removes revoked connections", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: 1_800_000_000_000,
  });
  let revoked = false;
  let checks = 0;
  const client = await connection(context, Date.now() + 30 * day, async () => {
    checks += 1;
    return revoked ? null : { member: { ...member, admin: false }, expires: Date.now() + 30 * day };
  });
  const updatedPresence = once(client, "message");
  context.mock.timers.tick(60_000);
  const [data] = await updatedPresence;
  assert.equal(JSON.parse(data.toString()).members[0].admin, false);
  assert.equal(client.readyState, WebSocket.OPEN);
  revoked = true;
  const closed = once(client, "close");
  context.mock.timers.tick(60_000);
  const [code] = await closed;
  assert.equal(code, 4001);
  assert.equal(checks, 2);
});

test("temporary authorization failures reconnect chat without the logout close code", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: 1_800_000_000_000,
  });
  const client = await connection(context, Date.now() + 30 * day, async () => {
    throw new Error("Discord is temporarily unavailable");
  });
  const closed = once(client, "close");
  context.mock.timers.tick(60_000);
  const [code] = await closed;
  assert.equal(code, 4002);
});
