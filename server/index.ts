import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { WebSocketServer } from "ws";

import { authenticateRoomMember, handleRequest, type Env } from "../worker/index";
import { WatchRoom } from "./room";

const env = process.env as unknown as Env;
const port = Number(process.env.PORT || 8787);
const appOrigin = new URL(env.APP_URL || "http://localhost:5173").origin;
const room = new WatchRoom();
const webSockets = new WebSocketServer({ noServer: true });

function requestUrl(request: IncomingMessage) {
  const forwardedProtocol = request.headers["x-forwarded-proto"]?.toString().split(",")[0]?.trim();
  const protocol = forwardedProtocol || ((request.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = request.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim()
    || request.headers.host
    || `localhost:${port}`;
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

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
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
  Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(requestUrl(request));
    if (url.pathname === "/healthz" && request.method === "GET") {
      await send(response, Response.json({ status: "ok", version: env.APP_VERSION || "development" }), request);
      return;
    }
    if (request.method === "OPTIONS") {
      const originAllowed = request.headers.origin === appOrigin;
      response.writeHead(originAllowed ? 204 : 403, corsHeaders(request));
      response.end();
      return;
    }
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
    await send(response, await handleRequest(webRequest(request, body), env), request);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      await send(response, Response.json({ error: "Unexpected request failure" }, { status: 500 }), request);
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
    const member = await authenticateRoomMember(webRequest(request), env);
    if (!member) throw new Error("Unauthorized");
    webSockets.handleUpgrade(request, socket, head, (webSocket) => room.connect(webSocket, member));
  } catch (error) {
    const status = error instanceof Error && error.message === "Unauthorized" ? "401 Unauthorized" : "403 Forbidden";
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }
});

server.listen(port, () => {
  console.log(`bunny.plus API listening on :${port}`);
});
