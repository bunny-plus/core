import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "../worker/index";
import {
  jellyfinBaseUrl,
  jellyfinLibrary,
  jellyfinOptions,
  jellyfinRelay,
  jellyfinSubtitleFile,
  isJellyfinPlayback,
} from "./jellyfin";

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
        { Index: 2, Type: "Subtitle", DisplayTitle: "English", Codec: "subrip" },
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

test("subtitle extraction rejects oversized data and upstream errors without exposing tokens", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [movie] }));
  const source = (await jellyfinOptions(env, itemId)).sources[0];
  const playback = {
    sessionId: "b".repeat(32),
    itemId,
    mediaSourceId: sourceId,
    startedAt: null,
    subtitleIndex: 2,
  };
  const upstream = context.mock.method(
    globalThis,
    "fetch",
    async () => new Response("secret upstream details", { status: 401 }),
  );
  await assert.rejects(
    jellyfinSubtitleFile(env, playback, source, "track", 2),
    /Could not extract/,
  );
  upstream.mock.mockImplementation(
    async () => new Response("[Events]", { headers: { "Content-Length": "9000000" } }),
  );
  await assert.rejects(
    jellyfinSubtitleFile(env, playback, source, "track", 2),
    /Could not extract/,
  );
  upstream.mock.mockImplementation(async () => new Response("<html>Login</html>"));
  await assert.rejects(
    jellyfinSubtitleFile(env, playback, source, "track", 2),
    /Could not extract/,
  );
});

test("Jellyfin virtual seasons use the TV episode endpoint instead of folder children", async (context) => {
  const seriesId = "b".repeat(32);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/jellyfin/Items") {
      assert.equal(url.searchParams.get("Ids"), itemId);
      return Response.json({
        Items: [
          {
            Id: itemId,
            Name: "Season 1",
            Type: "Season",
            SeriesId: seriesId,
            LocationType: "Virtual",
          },
        ],
      });
    }
    assert.equal(url.pathname, `/jellyfin/Shows/${seriesId}/Episodes`);
    assert.equal(url.searchParams.get("SeasonId"), itemId);
    assert.equal(url.searchParams.get("IsMissing"), "false");
    assert.equal(url.searchParams.get("StartIndex"), "40");
    assert.equal(url.searchParams.get("Limit"), "40");
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
      TotalRecordCount: 41,
    });
  });
  const library = await jellyfinLibrary(
    env,
    new URLSearchParams({ parentId: itemId, startIndex: "40" }),
  );
  assert.equal(library.items[0].title, "Bunnies · S01E02 · Pilot");
  assert.equal(library.total, 41);
  assert.equal(library.startIndex, 40);
});

test("Jellyfin seasons are paginated locally because the seasons endpoint ignores page parameters", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/jellyfin/Items")
      return Response.json({ Items: [{ Id: itemId, Name: "Bunnies", Type: "Series" }] });
    assert.equal(url.pathname, `/jellyfin/Shows/${itemId}/Seasons`);
    assert.equal(url.searchParams.has("Limit"), false);
    return Response.json({
      Items: Array.from({ length: 41 }, (_, index) => ({
        Id: index.toString(16).padStart(32, "0"),
        Name: `Season ${index + 1}`,
        Type: "Season",
      })),
      TotalRecordCount: 41,
    });
  });
  const library = await jellyfinLibrary(
    env,
    new URLSearchParams({ parentId: itemId, startIndex: "40" }),
  );
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].name, "Season 41");
  assert.equal(library.total, 41);
});

test("episode searches remain inside the selected virtual season and count matches before paging", async (context) => {
  const seriesId = "b".repeat(32);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/jellyfin/Items")
      return Response.json({ Items: [{ Id: itemId, Type: "Season", SeriesId: seriesId }] });
    assert.equal(url.pathname, `/jellyfin/Shows/${seriesId}/Episodes`);
    assert.equal(url.searchParams.get("SeasonId"), itemId);
    assert.equal(url.searchParams.has("Limit"), false);
    assert.equal(url.searchParams.has("SearchTerm"), false);
    return Response.json({
      Items: [
        { Id: itemId, Name: "Countdown", Type: "Episode" },
        { Id: seriesId, Name: "Red Coast", Type: "Episode" },
      ],
      TotalRecordCount: 2,
    });
  });
  const library = await jellyfinLibrary(
    env,
    new URLSearchParams({ parentId: itemId, query: "COUNT" }),
  );
  assert.equal(library.total, 1);
  assert.equal(library.items[0].name, "Countdown");
});

test("deleted or non-container parents fail without browsing unrelated episodes", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [] }));
  await assert.rejects(
    jellyfinLibrary(env, new URLSearchParams({ parentId: itemId })),
    /no longer available/,
  );
  fetch.mock.mockImplementation(async () => Response.json({ Items: [movie] }));
  await assert.rejects(
    jellyfinLibrary(env, new URLSearchParams({ parentId: itemId })),
    /show or season/,
  );
  assert.equal(fetch.mock.callCount(), 2);
});

test("Jellyfin playback options preserve stream indexes, media versions and preferred audio", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [movie] }));
  const options = await jellyfinOptions(env, itemId);
  assert.equal(options.sources[0].id, sourceId);
  assert.equal(options.sources[0].height, 2160);
  assert.equal(options.sources[0].defaultAudioIndex, 3);
  assert.equal(options.sources[0].defaultSubtitleIndex, 2);
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
    subtitleIndex: 2,
    resolutionIndex: 5,
    source: "https://attacker.test/video",
    title: "Client title",
  });
  assert.deepEqual(relay, {
    action: "jellyfin",
    apiKey: env.JELLYFIN_API_KEY,
    audioIndex: 3,
    subtitleIndex: 2,
    resolutionIndex: 5,
    hdrTransfer: null,
    title: "Movie night",
    source: `https://jellyfin.test/jellyfin/Videos/${itemId}/stream?Static=true&MediaSourceId=version-1`,
  });
  const defaults = await jellyfinRelay(env, { itemId, mediaSourceId: sourceId });
  assert.equal(defaults.audioIndex, 3);
  assert.equal(defaults.subtitleIndex, 2);
  const disabled = await jellyfinRelay(env, {
    itemId,
    mediaSourceId: sourceId,
    subtitleIndex: null,
  });
  assert.equal(disabled.subtitleIndex, null);
});

test("subtitle defaults follow the selected media version and reject unavailable formats", async (context) => {
  const version = {
    ...movie.MediaSources[0],
    DefaultSubtitleStreamIndex: 4,
    MediaStreams: [
      ...movie.MediaSources[0].MediaStreams,
      { Index: 4, Type: "Subtitle", DisplayTitle: "Japanese", Codec: "ass" },
      { Index: 5, Type: "Subtitle", DisplayTitle: "PGS", Codec: "hdmv_pgs_subtitle" },
    ],
  };
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ Items: [{ ...movie, MediaSources: [version] }] }),
  );
  assert.equal((await jellyfinOptions(env, itemId)).sources[0].defaultSubtitleIndex, 4);
  assert.equal((await jellyfinRelay(env, { itemId, mediaSourceId: sourceId })).subtitleIndex, 4);
  for (const subtitleIndex of [0, 1, 5, 99])
    await assert.rejects(
      jellyfinRelay(env, { itemId, mediaSourceId: sourceId, subtitleIndex }),
      /subtitle track is unavailable or unsupported/,
    );
  version.DefaultSubtitleStreamIndex = 5;
  assert.equal((await jellyfinOptions(env, itemId)).sources[0].defaultSubtitleIndex, 2);
  version.MediaStreams = version.MediaStreams.filter((stream) => stream.Type !== "Subtitle");
  assert.equal((await jellyfinOptions(env, itemId)).sources[0].defaultSubtitleIndex, null);
  assert.equal((await jellyfinRelay(env, { itemId, mediaSourceId: sourceId })).subtitleIndex, null);
});

test("playback metadata accepts an admin subtitle index or no selection, including older sessions", () => {
  const playback = { sessionId: "b".repeat(32), itemId, mediaSourceId: sourceId, startedAt: null };
  assert.equal(isJellyfinPlayback(playback), true);
  for (const subtitleIndex of [null, 0, 3])
    assert.equal(isJellyfinPlayback({ ...playback, subtitleIndex }), true);
  for (const subtitleIndex of [-1, 1.5, "3", true])
    assert.equal(isJellyfinPlayback({ ...playback, subtitleIndex }), false);
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

test("Jellyfin derives HDR conversion from the selected server media, ignoring client overrides", async (context) => {
  for (const transfer of [undefined, "bt709", "smpte2084", "arib-std-b67"]) {
    const hdrMovie = {
      ...movie,
      MediaSources: [
        {
          ...movie.MediaSources[0],
          MediaStreams: movie.MediaSources[0].MediaStreams.map((stream) =>
            stream.Type === "Video" ? { ...stream, ColorTransfer: transfer } : stream,
          ),
        },
      ],
    };
    context.mock.method(globalThis, "fetch", async () => Response.json({ Items: [hdrMovie] }));
    const relay = await jellyfinRelay(env, {
      itemId,
      mediaSourceId: sourceId,
      hdrTransfer: "injected",
    });
    assert.equal(
      relay.hdrTransfer,
      transfer === "smpte2084" || transfer === "arib-std-b67" ? transfer : null,
    );
  }
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
  for (const subtitleIndex of [-1, true, "2", 1.5])
    await assert.rejects(
      jellyfinRelay(env, { itemId, mediaSourceId: sourceId, subtitleIndex }),
      /Invalid subtitle track/,
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
