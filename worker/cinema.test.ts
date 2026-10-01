import assert from "node:assert/strict";
import test from "node:test";

import { CinemaDiary } from "../server/cinema";
import { cinemaImageMaxBytes } from "../shared/cinema";
import { createSession } from "./session";
import { handleRequest, type Env } from "./index";

function cinemaEnv(id: string, diary?: CinemaDiary): Env {
  return {
    ADMIN_DISCORD_IDS: "",
    APP_URL: "https://bunny.plus",
    API_URL: "https://api.bunny.plus",
    CINEMA_DIARY: diary,
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "discord-secret",
    DISCORD_GUILD_ID: "guild",
    DISCORD_ROLE_PERMISSIONS: "{}",
    NODE_ENV: "production",
    RELAY_CONTROLLER_SECRET: "controller-secret",
    RELAY_CONTROLLER_URL: `http://${id}-controller.test`,
    SESSION_SECRET: "a-secure-session-key-with-32-bytes",
    STREAM_DELAY_SECONDS: "6",
    STREAM_URL: `https://${id}-stream.test/index.m3u8`,
    TORBOX_API_KEY: "torbox-secret",
  };
}

async function viewerCookie(env: Env, id: string, admin = false) {
  const token = await createSession(
    { admin, avatar: null, id, name: id, permissions: admin ? ["stream.manage"] : [] },
    env.SESSION_SECRET,
  );
  return `bp_session=${token}`;
}

function request(env: Env, path: string, cookie: string, body?: string) {
  return new Request(`${env.API_URL}${path}`, {
    body,
    headers: { Cookie: cookie, Origin: env.APP_URL, "Content-Type": "application/json" },
    method: body === undefined ? "GET" : "POST",
  });
}

const restreamBody = JSON.stringify({
  source: "https://www.twitch.tv/bunny",
  title: "Together",
  quality: "best",
});

test("ticket collections require authentication and cannot read another viewer's diary", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("collection", diary);
    const screening = diary.start("Perfect Blue", 0);
    assert.ok(diary.createTicket(screening.id, "Perfect Blue", null, 0));
    for (let elapsed = 0; elapsed <= 600_000; elapsed += 10_000)
      diary.watching("owner", "tab", screening.id, true, elapsed);
    const unauthorized = await handleRequest(request(env, "/api/cinema/tickets", ""), env);
    assert.equal(unauthorized.status, 401);
    const ownerCookie = await viewerCookie(env, "owner");
    const owner = await handleRequest(request(env, "/api/cinema/tickets", ownerCookie), env);
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await owner.json(), diary.collection("owner"));
    const guestCookie = await viewerCookie(env, "guest");
    const guest = await handleRequest(
      request(env, "/api/cinema/tickets?viewerId=owner", guestCookie),
      env,
    );
    assert.equal(guest.status, 200);
    assert.deepEqual(await guest.json(), { tickets: [], total: 0 });
    const unavailableEnv = cinemaEnv("unavailable");
    const unavailable = await handleRequest(
      request(unavailableEnv, "/api/cinema/tickets", ownerCookie),
      unavailableEnv,
    );
    assert.equal(unavailable.status, 503);
  } finally {
    diary.close();
  }
});

test("successful repeated controller starts each open a screening and successful stop ends it", async (context) => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("lifecycle", diary);
    const cookie = await viewerCookie(env, "lifecycle-admin", true);
    let running = true;
    let error = "";
    context.mock.method(globalThis, "fetch", async () =>
      Response.json({ running, title: "Together", error }),
    );
    const firstResponse = await handleRequest(
      request(env, "/api/admin/restream/start", cookie, restreamBody),
      env,
    );
    assert.equal(firstResponse.status, 200);
    const first = diary.current();
    assert.ok(first);
    const secondResponse = await handleRequest(
      request(env, "/api/admin/restream/start", cookie, restreamBody),
      env,
    );
    assert.equal(secondResponse.status, 200);
    const second = diary.current();
    assert.ok(second);
    assert.notEqual(second.id, first.id);
    assert.equal(second.title, first.title);
    running = false;
    await handleRequest(request(env, "/api/admin/restream/start", cookie, restreamBody), env);
    assert.deepEqual(diary.current(), second);
    running = true;
    error = "Relay failed";
    await handleRequest(request(env, "/api/admin/restream/start", cookie, restreamBody), env);
    assert.deepEqual(diary.current(), second);
    running = false;
    error = "";
    const stop = await handleRequest(request(env, "/api/admin/stream/stop", cookie, "{}"), env);
    assert.equal(stop.status, 200);
    assert.equal(diary.current(), null);
  } finally {
    diary.close();
  }
});

test("controller status adopts an existing stream but failed polls do not split its screening", async (context) => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("adoption", diary);
    const cookie = await viewerCookie(env, "adoption-viewer");
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      if (String(input) === env.RELAY_CONTROLLER_URL)
        return Response.json({ running: true, title: "Already playing" });
      return new Response("#EXTM3U");
    });
    const response = await handleRequest(request(env, "/api/stream-info", cookie), env);
    const current = diary.current();
    assert.ok(current);
    const info = await response.json();
    assert.deepEqual(info.screening, current);
    assert.equal(current.title, "Already playing");
    const failureEnv = {
      ...env,
      RELAY_CONTROLLER_URL: "http://failed-controller.test",
      STREAM_URL: "https://failed-stream.test/index.m3u8",
    };
    context.mock.method(globalThis, "fetch", async () => {
      throw new Error("Temporary outage");
    });
    const failed = await handleRequest(request(failureEnv, "/api/stream-info", cookie), failureEnv);
    assert.equal(failed.status, 200);
    const failedInfo = await failed.json();
    assert.equal(failedInfo.running, false);
    assert.equal(failedInfo.online, false);
    assert.deepEqual(failedInfo.screening, current);
    assert.deepEqual(diary.current(), current);
  } finally {
    diary.close();
  }
});

test("an in-flight old stream probe cannot replace a newly started screening or return its old ID", async (context) => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("racing-probe", diary);
    const cookie = await viewerCookie(env, "racing-admin", true);
    diary.start("Old title");
    let releaseHls!: (response: Response) => void;
    const hls = new Promise<Response>((resolve) => {
      releaseHls = resolve;
    });
    let controllerRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      controllerRead = resolve;
    });
    let title = "Old title";
    let probes = 0;
    let hlsProbes = 0;
    context.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === env.STREAM_URL) {
          hlsProbes += 1;
          return hlsProbes === 1 ? hls : new Response("#EXTM3U");
        }
        assert.equal(String(input), env.RELAY_CONTROLLER_URL);
        if (init?.method === "POST") {
          title = "New title";
          return Response.json({ running: true, title });
        }
        probes += 1;
        controllerRead();
        return Response.json({ running: true, title });
      },
    );
    const oldProbe = handleRequest(request(env, "/api/stream-info", cookie), env);
    await readStarted;
    const started = await handleRequest(
      request(env, "/api/admin/restream/start", cookie, restreamBody),
      env,
    );
    assert.equal(started.status, 200);
    const current = diary.current();
    assert.ok(current);
    assert.equal(current.title, "New title");
    releaseHls(new Response("#EXTM3U"));
    const oldInfo = await (await oldProbe).json();
    assert.deepEqual(oldInfo.screening, current);
    const fresh = await handleRequest(request(env, "/api/stream-info", cookie), env);
    const freshInfo = await fresh.json();
    assert.equal(freshInfo.title, "New title");
    assert.deepEqual(freshInfo.screening, current);
    assert.equal(probes, 2);
    assert.deepEqual(diary.current(), current);
  } finally {
    diary.close();
  }
});

const pngData =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfYQAAAAASUVORK5CYII=";

test("screening ticket creation requires management permission, same-origin JSON, and current screening", async (context) => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("design-permissions", diary);
    const screening = diary.start("Stream title");
    const body = JSON.stringify({ screeningId: screening.id, title: "Collectible title" });
    const viewer = await viewerCookie(env, "design-viewer");
    const admin = await viewerCookie(env, "design-admin", true);
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
      String(input) === env.RELAY_CONTROLLER_URL
        ? Response.json({ running: false })
        : new Response("#EXTM3U"),
    );
    for (const path of ["/api/cinema/screening", "/api/cinema/screening/ticket"]) {
      const response = await handleRequest(
        request(env, path, viewer, path.endsWith("/ticket") ? body : undefined),
        env,
      );
      assert.equal(response.status, 403);
    }
    const current = await handleRequest(request(env, "/api/cinema/screening", admin), env);
    assert.equal(current.status, 200);
    assert.deepEqual(await current.json(), { screening });
    const foreign = await handleRequest(
      new Request(`${env.API_URL}/api/cinema/screening/ticket`, {
        method: "POST",
        body,
        headers: {
          Cookie: admin,
          Origin: "https://foreign.test",
          "Content-Type": "application/json",
        },
      }),
      env,
    );
    assert.equal(foreign.status, 403);
    const unsupported = await handleRequest(
      new Request(`${env.API_URL}/api/cinema/screening/ticket`, {
        method: "POST",
        body,
        headers: { Cookie: admin, Origin: env.APP_URL, "Content-Type": "text/plain" },
      }),
      env,
    );
    assert.equal(unsupported.status, 415);
    const stale = await handleRequest(
      request(
        env,
        "/api/cinema/screening/ticket",
        admin,
        JSON.stringify({ screeningId: "old-screening", title: "Old draft" }),
      ),
      env,
    );
    assert.equal(stale.status, 409);
    assert.equal(diary.current()?.ticketDesign, null);
    const roleToken = await createSession(
      {
        admin: false,
        avatar: null,
        id: "design-manager",
        name: "Manager",
        permissions: ["stream.manage"],
      },
      env.SESSION_SECRET,
    );
    const created = await handleRequest(
      request(env, "/api/cinema/screening/ticket", `bp_session=${roleToken}`, body),
      env,
    );
    assert.equal(created.status, 201);
    const repeated = await handleRequest(
      request(env, "/api/cinema/screening/ticket", admin, body),
      env,
    );
    assert.equal(repeated.status, 409);
    assert.equal(diary.current()?.ticketDesign?.title, "Collectible title");
  } finally {
    diary.close();
  }
});

test("an uploaded image stays private, preserves validated bytes, and appears on late-earned tickets", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("design-image", diary);
    const screening = diary.start("Stream title", 0);
    for (let elapsed = 0; elapsed <= 600_000; elapsed += 10_000)
      diary.watching("watcher", "tab", screening.id, true, elapsed);
    diary.watching("watcher", "tab", screening.id, false, 610_000);
    assert.equal(diary.progress("watcher").ticket, null);
    const admin = await viewerCookie(env, "image-admin", true);
    const created = await handleRequest(
      request(
        env,
        "/api/cinema/screening/ticket",
        admin,
        JSON.stringify({
          screeningId: screening.id,
          title: "  A night in the burrow  ",
          image: { mimeType: "image/png", data: pngData },
        }),
      ),
      env,
    );
    assert.equal(created.status, 201);
    const designed = (await created.json()).screening;
    assert.equal(designed.ticketDesign.title, "A night in the burrow");
    const path = designed.ticketDesign.imagePath;
    assert.equal(path, `/api/cinema/screenings/${screening.id}/image`);
    const ticket = diary.watching("watcher", "tab", screening.id, false, 620_000).ticket;
    assert.ok(ticket);
    assert.equal(ticket.title, "A night in the burrow");
    assert.equal(ticket.imagePath, path);
    assert.equal(diary.collection("watcher").total, 1);
    const unauthorized = await handleRequest(request(env, path, ""), env);
    assert.equal(unauthorized.status, 401);
    const viewer = await viewerCookie(env, "image-viewer");
    const image = await handleRequest(request(env, path, viewer), env);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/png");
    assert.equal(image.headers.get("Cache-Control"), "private, no-store");
    assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(
      new Uint8Array(await image.arrayBuffer()),
      Uint8Array.from(Buffer.from(pngData, "base64")),
    );
    const missing = await handleRequest(
      request(env, "/api/cinema/screenings/not-found/image", viewer),
      env,
    );
    assert.equal(missing.status, 404);
  } finally {
    diary.close();
  }
});

test("ticket designs reject invalid titles, remote images, malformed base64, type mismatches, and oversized uploads", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("design-validation", diary);
    const screening = diary.start("Stream title");
    const tooLarge = Buffer.alloc(cinemaImageMaxBytes + 1);
    Buffer.from(pngData, "base64").copy(tooLarge);
    const cases = [
      { title: "", status: 400 },
      { title: "x".repeat(201), status: 400 },
      { title: "Valid", image: "https://example.test/image.png", status: 400 },
      { title: "Valid", image: { mimeType: "image/svg+xml", data: btoa("<svg/>") }, status: 400 },
      { title: "Valid", image: { mimeType: "image/png", data: "bad base64!" }, status: 400 },
      { title: "Valid", image: { mimeType: "image/png", data: "/x==" }, status: 400 },
      { title: "Valid", image: { mimeType: "image/jpeg", data: pngData }, status: 400 },
      { title: "Valid", image: { mimeType: "image/webp", data: pngData }, status: 400 },
      {
        title: "Valid",
        image: { mimeType: "image/png", data: `data:image/png;base64,${pngData}` },
        status: 400,
      },
      {
        title: "Valid",
        image: { mimeType: "image/png", data: tooLarge.toString("base64") },
        status: 413,
      },
    ];
    for (const [index, invalid] of cases.entries()) {
      const cookie = await viewerCookie(env, `validation-admin-${index}`, true);
      const response = await handleRequest(
        request(
          env,
          "/api/cinema/screening/ticket",
          cookie,
          JSON.stringify({ ...invalid, screeningId: screening.id }),
        ),
        env,
      );
      assert.equal(response.status, invalid.status);
      assert.equal(diary.current()?.ticketDesign, null);
    }
  } finally {
    diary.close();
  }
});

test("supported JPEG and WebP images are accepted and their exact MIME is preserved", async () => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("design-types", diary);
    const cookie = await viewerCookie(env, "types-admin", true);
    const images = [
      { mimeType: "image/jpeg", bytes: Uint8Array.from([255, 216, 255, 224, 0, 2, 255, 217]) },
      {
        mimeType: "image/webp",
        bytes: Uint8Array.from([82, 73, 70, 70, 10, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 0, 0]),
      },
    ];
    for (const image of images) {
      const screening = diary.start("New stream");
      const response = await handleRequest(
        request(
          env,
          "/api/cinema/screening/ticket",
          cookie,
          JSON.stringify({
            screeningId: screening.id,
            title: "Ticket",
            image: { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString("base64") },
          }),
        ),
        env,
      );
      assert.equal(response.status, 201);
      const served = await handleRequest(
        request(env, `/api/cinema/screenings/${screening.id}/image`, cookie),
        env,
      );
      assert.equal(served.headers.get("Content-Type"), image.mimeType);
      assert.deepEqual(new Uint8Array(await served.arrayBuffer()), image.bytes);
    }
  } finally {
    diary.close();
  }
});

test("concurrent creation is immutable and a queued stream switch rejects the previous draft", async (context) => {
  const diary = new CinemaDiary(":memory:");
  try {
    const env = cinemaEnv("design-race", diary);
    const cookie = await viewerCookie(env, "race-design-admin", true);
    const screening = diary.start("First stream");
    const body = JSON.stringify({ screeningId: screening.id, title: "First ticket" });
    const responses = await Promise.all([
      handleRequest(request(env, "/api/cinema/screening/ticket", cookie, body), env),
      handleRequest(request(env, "/api/cinema/screening/ticket", cookie, body), env),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const second = diary.start("Second stream");
    let controllerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      controllerStarted = resolve;
    });
    let releaseController!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      releaseController = resolve;
    });
    context.mock.method(globalThis, "fetch", async () => {
      controllerStarted();
      return pending;
    });
    const switchStream = handleRequest(
      request(env, "/api/admin/restream/start", cookie, restreamBody),
      env,
    );
    await started;
    const oldDraft = handleRequest(
      request(
        env,
        "/api/cinema/screening/ticket",
        cookie,
        JSON.stringify({ screeningId: second.id, title: "Old draft" }),
      ),
      env,
    );
    releaseController(Response.json({ running: true, title: "Third stream" }));
    assert.equal((await switchStream).status, 200);
    assert.equal((await oldDraft).status, 409);
    assert.equal(diary.current()?.title, "Third stream");
    assert.equal(diary.current()?.ticketDesign, null);
  } finally {
    diary.close();
  }
});
