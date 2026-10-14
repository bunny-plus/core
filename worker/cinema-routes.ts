import type { Env, RequestMetadata } from "./env";
import { authorizeCostly } from "./authentication";
import { apiError, ClientError, jsonObject } from "./http";
import { streamInfo, controllerQueue } from "./stream-controller";
import type { CinemaImage } from "../server/cinema";
import { cinemaImageMaxBytes } from "../shared/cinema";
import { isTicketBunny } from "../shared/ticket-bunny";
import { isJsonObject, isString, type JsonValue } from "../shared/json";
function hasSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ticketImage(input: JsonValue | undefined): CinemaImage | null {
  if (input === undefined) return null;
  if (!isJsonObject(input) || !isString(input.mimeType) || !isString(input.data))
    throw new ClientError("A valid uploaded image is required", 400);
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.mimeType))
    throw new ClientError("Upload a PNG, JPEG, or WebP image", 400);
  if (input.data.length > Math.ceil(cinemaImageMaxBytes / 3) * 4)
    throw new ClientError("Ticket images must be 1.9 MB or smaller", 413);
  if (!input.data || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
    throw new ClientError("The uploaded image is not valid base64", 400);
  let decoded: string;
  try {
    decoded = atob(input.data);
  } catch {
    throw new ClientError("The uploaded image is not valid base64", 400);
  }
  if (btoa(decoded) !== input.data)
    throw new ClientError("The uploaded image is not valid base64", 400);
  if (decoded.length > cinemaImageMaxBytes)
    throw new ClientError("Ticket images must be 1.9 MB or smaller", 413);
  const data = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const validImage =
    (input.mimeType === "image/png" && hasSignature(data, [137, 80, 78, 71, 13, 10, 26, 10])) ||
    (input.mimeType === "image/jpeg" && hasSignature(data, [255, 216, 255])) ||
    (input.mimeType === "image/webp" &&
      data.length >= 16 &&
      hasSignature(data, [82, 73, 70, 70]) &&
      hasSignature(data, [87, 69, 66, 80], 8) &&
      hasSignature(data, [86, 80, 56], 12) &&
      [32, 76, 88].includes(data[15]));
  if (!validImage) throw new ClientError("The uploaded image does not match its file type", 400);
  return { mimeType: input.mimeType, data };
}

export async function cinemaRoutes(
  request: Request,
  env: Env,
  url: URL,
  metadata?: RequestMetadata,
) {
  if (url.pathname === "/api/cinema/tickets" && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "cinema-collection", 60);
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      return Response.json(await env.CINEMA_DIARY.collection(authorization.id));
    } catch (error) {
      console.error("Could not read cinema tickets", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  if (url.pathname === "/api/cinema/screening" && request.method === "GET") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "cinema-admin-read",
      60,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      await streamInfo(env);
      return Response.json({ screening: await env.CINEMA_DIARY.current() });
    } catch (error) {
      console.error("Could not read cinema screening", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  if (url.pathname === "/api/cinema/screening/counting" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "cinema-counting",
      20,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    const diary = env.CINEMA_DIARY;
    if (!diary) return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      const input = await jsonObject(request);
      if (!isString(input.screeningId) || !input.screeningId || input.screeningId.length > 100)
        throw new ClientError("A current screening is required", 400);
      if (input.enabled !== true && input.enabled !== false)
        throw new ClientError("enabled must be a boolean", 400);
      const { screeningId, enabled } = input;
      const screening = await controllerQueue.run(() =>
        diary.setTicketCounting(screeningId, enabled),
      );
      if (!screening)
        return Response.json(
          { error: "The screening changed. Refresh and try again." },
          { status: 409 },
        );
      return Response.json({ screening });
    } catch (error) {
      if (error instanceof ClientError) return apiError(error);
      console.error("Could not change cinema ticket counting", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  if (url.pathname === "/api/cinema/screening/ticket" && request.method === "POST") {
    const authorization = await authorizeCostly(
      request,
      env,
      metadata,
      "cinema-design",
      10,
      "stream.manage",
    );
    if (authorization instanceof Response) return authorization;
    const diary = env.CINEMA_DIARY;
    if (!diary) return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      const input = await jsonObject(request);
      if (!isString(input.screeningId) || !input.screeningId || input.screeningId.length > 100)
        throw new ClientError("A current screening is required", 400);
      if (!isString(input.title) || !input.title.trim() || input.title.length > 200)
        throw new ClientError("A ticket title of 1 to 200 characters is required", 400);
      const screeningId = input.screeningId;
      const title = input.title.trim();
      const image = ticketImage(input.image);
      if (input.bunny !== undefined && !isTicketBunny(input.bunny))
        throw new ClientError("Choose valid bunny parts", 400);
      const bunny = input.bunny;
      if (bunny && image) throw new ClientError("Choose a bunny or an uploaded image", 400);
      const screening = await controllerQueue.run(() =>
        diary.createTicket(screeningId, title, image, Date.now(), bunny),
      );
      if (!screening)
        return Response.json(
          { error: "The screening changed or its ticket was already created" },
          { status: 409 },
        );
      return Response.json({ screening }, { status: 201 });
    } catch (error) {
      if (error instanceof ClientError) return apiError(error);
      console.error("Could not create cinema ticket", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  const cinemaImageMatch = url.pathname.match(/^\/api\/cinema\/screenings\/([^/]{1,100})\/image$/);
  if (cinemaImageMatch && request.method === "GET") {
    const authorization = await authorizeCostly(request, env, metadata, "cinema-image", 240);
    if (authorization instanceof Response) return authorization;
    if (!env.CINEMA_DIARY)
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    try {
      const image = await env.CINEMA_DIARY.image(cinemaImageMatch[1]);
      if (!image) return Response.json({ error: "Ticket image not found" }, { status: 404 });
      return new Response(Uint8Array.from(image.data).buffer, {
        headers: { "Content-Type": image.mimeType, "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      console.error("Could not read cinema ticket image", error);
      return Response.json({ error: "Cinema diary is unavailable" }, { status: 503 });
    }
  }
  return null;
}
