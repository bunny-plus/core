import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { TLSSocket } from "node:tls";
import { dirname, join } from "node:path";

import { WebSocketServer } from "ws";

import { authenticateRoomMember, handleRequest, type Env } from "../worker/index";
import { ChatHistory } from "./chat-history";
import { CinemaDiary } from "./cinema";
import { loadEnvironment } from "./env";
import { WatchRoom } from "./room";

const env: Env = loadEnvironment(process.env);
const port = Number(process.env.PORT || 8787);
const appOrigin = new URL(env.APP_URL || "http://localhost:5173").origin;
const chatDatabasePath = env.CHAT_DB_PATH || "data/chat.sqlite";
try {
  env.CINEMA_DIARY = new CinemaDiary(join(dirname(chatDatabasePath), "cinema.sqlite"));
} catch (error) {
  console.error("Cinema diary is unavailable", error);
}
const room = new WatchRoom(new ChatHistory(chatDatabasePath, 200), env.CINEMA_DIARY);
const webSockets = new WebSocketServer({
  maxPayload: 16 * 1_024,
  noServer: true,
  perMessageDeflate: false,
});

class RequestBodyError extends Error {}

function requestUrl(request: IncomingMessage) {
  const forwardedProtocol = request.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim();
  const protocol =
    forwardedProtocol ||
    (request.socket instanceof TLSSocket && request.socket.encrypted ? "https" : "http");
  const host =
    request.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() ||
    request.headers.host ||
    `localhost:${port}`;
  return new URL(request.url || "/", `${protocol}://${host}`).toString();
}

function webRequest(request: IncomingMessage, body?: ArrayBuffer) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(requestUrl(request), {
    body: body && body.byteLength > 0 ? body : undefined,
    headers,
    method: request.method,
  });
}

function requestMetadata(request: IncomingMessage) {
  return { peerAddress: request.socket.remoteAddress };
}

async function readBody(request: IncomingMessage) {
  const limit =
    request.method === "POST" &&
    new URL(requestUrl(request)).pathname === "/api/cinema/screening/ticket"
      ? 3 * 1024 * 1024
      : 1_000_000;
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new RequestBodyError();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > limit) throw new RequestBodyError();
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  return Uint8Array.from(body).buffer;
}

function corsHeaders(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (origin !== appOrigin) return {};
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": appOrigin,
    Vary: "Origin",
  };
}

async function send(response: ServerResponse, result: Response, request: IncomingMessage) {
  const headers = Object.fromEntries(result.headers.entries());
  response.writeHead(result.status, { ...headers, ...corsHeaders(request) });
  if (!result.body) {
    response.end();
    return;
  }
  // SAFETY: Node's fetch body is the Web ReadableStream implementation accepted by fromWeb.
  Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(requestUrl(request));
    if (url.pathname === "/healthz" && request.method === "GET") {
      await send(
        response,
        Response.json({ status: "ok", version: env.APP_VERSION || "development" }),
        request,
      );
      return;
    }
    if (request.method === "OPTIONS") {
      const originAllowed = request.headers.origin === appOrigin;
      response.writeHead(originAllowed ? 204 : 403, corsHeaders(request));
      response.end();
      return;
    }
    const body =
      request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
    await send(
      response,
      await handleRequest(webRequest(request, body), env, requestMetadata(request)),
      request,
    );
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      const status = error instanceof RequestBodyError ? 413 : 500;
      const message = status === 413 ? "Request body is too large" : "Unexpected request failure";
      await send(response, Response.json({ error: message }, { status }), request);
    } else {
      response.destroy();
    }
  }
});

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(requestUrl(request));
    if (url.pathname !== "/api/room") throw new Error("Not found");
    if (request.headers.origin !== appOrigin) throw new Error("Forbidden origin");
    const authorization = await authenticateRoomMember(
      webRequest(request),
      env,
      requestMetadata(request),
    );
    if (!authorization) throw new Error("Unauthorized");
    webSockets.handleUpgrade(request, socket, head, (webSocket) =>
      room.connect(webSocket, authorization.member, authorization.expires),
    );
  } catch (error) {
    const status =
      error instanceof Error && error.message === "Unauthorized"
        ? "401 Unauthorized"
        : "403 Forbidden";
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }
});

server.listen(port, () => {
  console.log(`bunny.plus API listening on :${port}`);
});
