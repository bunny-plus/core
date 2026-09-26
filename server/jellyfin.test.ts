import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "../worker/index";
import { jellyfinBaseUrl, jellyfinLibrary, jellyfinOptions, jellyfinRelay } from "./jellyfin";

const itemId = "a".repeat(32);
const sourceId = "version-1";
const env: Env = {
  ADMIN_DISCORD_IDS: "",
  APP_URL: "https://bunny.plus",
  DISCORD_CLIENT_ID: "client",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_GUILD_ID: "guild",
  DISCORD_ROLE_PERMISSIONS: "{}",
  SESSION_SECRET: "test-session-secret-with-at-least-32-bytes",
  STREAM_DELAY_SECONDS: "6",
  STREAM_URL: "https://stream.test/index.m3u8",
  TORBOX_API_KEY: "torbox",
  JELLYFIN_URL: "https://jellyfin.test/jellyfin/",
  JELLYFIN_API_KEY: "private-api-token-for-tests",
};
const movie = {
  Id: itemId,
  Name: "Movie night",
  Type: "Movie",
  ProductionYear: 2026,
  RunTimeTicks: 54_000_000_000,
  Path: "/private/library/movie.mkv",
  MediaSources: [
    {
      Id: sourceId,
      Name: "4K edition",
      Protocol: "File",
      Path: "/private/movie.mkv",
      DefaultAudioStreamIndex: 3,
      MediaStreams: [
        { Index: 0, Type: "Video", Height: 2160 },
        { Index: 1, Type: "Audio", DisplayTitle: "English · AAC stereo", IsDefault: true },
        { Index: 2, Type: "Subtitle", DisplayTitle: "English" },
        { Index: 3, Type: "Audio", DisplayTitle: "Japanese · 5.1" },
      ],
    },
  ],
};

test("Jellyfin library preserves the server base path, searches and paginates without disclosing secrets", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/jellyfin/Items");
      assert.equal(url.searchParams.get("SearchTerm"), "night");
      assert.equal(url.searchParams.get("StartIndex"), "40");
      assert.equal(url.searchParams.get("Limit"), "40");
      assert.equal(url.searchParams.get("IncludeItemTypes"), "Movie,Series,Episode");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`,
      );
      assert.equal(init?.redirect, "error");
      assert.ok(!String(input).includes(env.JELLYFIN_API_KEY!));
      return Response.json({ Items: [movie], TotalRecordCount: 41 });
    },
  );
  const library = await jellyfinLibrary(
    env,
    new URLSearchParams({ query: "night", startIndex: "40" }),
  );
  assert.equal(library.total, 41);
  assert.equal(library.items[0].minutes, 90);
  assert.ok(!JSON.stringify(library).includes("/private"));
  assert.ok(!JSON.stringify(library).includes(env.JELLYFIN_API_KEY!));
});

test("Jellyfin show browsing lists seasons and episodes in episode order", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("ParentId"), itemId);
    assert.equal(url.searchParams.get("Recursive"), "false");
    assert.equal(url.searchParams.get("SortBy"), "ParentIndexNumber,IndexNumber,SortName");
    return Response.json({
      Items: [
        {
          Id: itemId,
          Name: "Pilot",
          Type: "Episode",
          SeriesName: "Bunnies",
          ParentIndexNumber: 1,
          IndexNumber: 2,
        },
      ],
      TotalRecordCount: 1,
    });
  });
  const library = await jellyfinLibrary(env, new URLSearchParams({ parentId: itemId }));
  assert.equal(library.items[0].title, "Bunnies · S01E02 · Pilot");
});

test("Jellyfin playback options preserve stream indexes, media versions and preferred audio", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [movie] }));
  const options = await jellyfinOptions(env, itemId);
  assert.equal(options.sources[0].id, sourceId);
  assert.equal(options.sources[0].height, 2160);
  assert.equal(options.sources[0].defaultAudioIndex, 3);
  assert.deepEqual(
    options.sources[0].audio.map((track) => track.index),
    [1, 3],
  );
  assert.ok(!JSON.stringify(options).includes("Path"));
});

test("Jellyfin relay resolves title and URL on the server and forwards the selected tracks", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [movie] }));
  const relay = await jellyfinRelay(env, {
    itemId,
    mediaSourceId: sourceId,
    audioIndex: 3,
    resolutionIndex: 5,
    source: "https://attacker.test/video",
    title: "Client title",
  });
  assert.deepEqual(relay, {
    action: "jellyfin",
    apiKey: env.JELLYFIN_API_KEY,
    audioIndex: 3,
    resolutionIndex: 5,
    title: "Movie night",
    source: `https://jellyfin.test/jellyfin/Videos/${itemId}/stream?Static=true&MediaSourceId=version-1`,
  });
  const defaults = await jellyfinRelay(env, { itemId, mediaSourceId: sourceId });
  assert.equal(defaults.audioIndex, 3);
});

test("Jellyfin rejects missing media versions, wrong track indexes and unsupported sources", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [movie] }));
  await assert.rejects(
    jellyfinRelay(env, { itemId, mediaSourceId: "gone" }),
    /version is no longer available/,
  );
  await assert.rejects(
    jellyfinRelay(env, { itemId, mediaSourceId: sourceId, audioIndex: 2 }),
    /audio track is no longer available/,
  );
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({
      Items: [{ ...movie, MediaSources: [{ ...movie.MediaSources[0], Protocol: "Http" }] }],
    }),
  );
  await assert.rejects(jellyfinOptions(env, itemId), /no available video file/);
});

test("Jellyfin rejects invalid input before contacting upstreams", async (context) => {
  const network = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected fetch");
  });
  await assert.rejects(jellyfinOptions(env, "../other"), /valid Jellyfin itemId/);
  await assert.rejects(
    jellyfinLibrary(env, new URLSearchParams({ startIndex: "-1" })),
    /Invalid Jellyfin search/,
  );
  await assert.rejects(
    jellyfinRelay(env, { itemId, mediaSourceId: sourceId, resolutionIndex: 8 }),
    /Invalid audio track or resolution/,
  );
  await assert.rejects(
    jellyfinRelay(env, { itemId, mediaSourceId: sourceId, audioIndex: true }),
    /Invalid audio track or resolution/,
  );
  await assert.rejects(
    jellyfinRelay(env, { itemId, mediaSourceId: sourceId, subtitleIndex: 1 }),
    /subtitles are not supported/,
  );
  await assert.rejects(
    jellyfinLibrary({ ...env, JELLYFIN_API_KEY: undefined }, new URLSearchParams()),
    /not connected yet/,
  );
  assert.equal(network.mock.callCount(), 0);
});

test("Jellyfin reports unavailable items and token failures without leaking upstream details", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [] }));
  await assert.rejects(jellyfinOptions(env, itemId), /no longer available/);
  context.mock.method(
    globalThis,
    "fetch",
    async () => new Response("private token details", { status: 401 }),
  );
  await assert.rejects(jellyfinOptions(env, itemId), /rejected the configured API key/);
});

test("Jellyfin accepts clean HTTP and HTTPS API base URLs", () => {
  assert.equal(
    jellyfinBaseUrl("https://jellyfin.test/jellyfin/"),
    "https://jellyfin.test/jellyfin",
  );
  for (const url of [
    "ftp://jellyfin.test",
    "https://user:password@jellyfin.test",
    "https://jellyfin.test/jellyfin/web/#/home",
    "https://jellyfin.test/?api_key=secret",
  ])
    assert.throws(() => jellyfinBaseUrl(url));
});

test("Jellyfin uses cluster HTTP for browsing and a separate controller URL for streaming", async (context) => {
  const local = {
    ...env,
    JELLYFIN_URL: "http://jellyfin.default.svc.cluster.local:8096/jellyfin",
    JELLYFIN_STREAM_URL: "http://192.168.1.240:8096/jellyfin",
  };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.ok(String(input).startsWith(`${local.JELLYFIN_URL}/Items?`));
    return Response.json({ Items: [movie], TotalRecordCount: 1 });
  });
  await jellyfinLibrary(local, new URLSearchParams());
  const relay = await jellyfinRelay(local, { itemId, mediaSourceId: sourceId });
  assert.equal(
    relay.source,
    `${local.JELLYFIN_STREAM_URL}/Videos/${itemId}/stream?Static=true&MediaSourceId=version-1`,
  );
});
