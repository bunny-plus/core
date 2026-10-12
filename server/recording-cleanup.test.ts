import assert from "node:assert/strict";
import test from "node:test";

import { purgeRecordings } from "./recording-cleanup";

const inputId = "a".repeat(32);
const env = {
  STREAM_URL: `https://customer-test.cloudflarestream.com/${inputId}/manifest/video.m3u8`,
  STREAM_RECORDING_CLEANUP_ACCOUNT_ID: "f".repeat(32),
  STREAM_RECORDING_CLEANUP_API_TOKEN: "private-recording-cleanup-token",
};

function recording(uid: string, state: string, liveInput = inputId) {
  return { uid, liveInput, status: { state } };
}

test("cleanup uses the existing Stream credential pair and never mixes partial overrides", async (context) => {
  const existing = {
    STREAM_URL: env.STREAM_URL,
    CLOUDFLARE_STREAM_ACCOUNT_ID: "c".repeat(32),
    CLOUDFLARE_STREAM_API_TOKEN: "existing-stream-read-and-edit-token",
  };
  let requests = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      assert.ok(
        new URL(String(input)).pathname.startsWith(
          `/client/v4/accounts/${existing.CLOUDFLARE_STREAM_ACCOUNT_ID}/stream`,
        ),
      );
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${existing.CLOUDFLARE_STREAM_API_TOKEN}`,
      );
      return Response.json({ success: true, result: [] });
    },
  );
  assert.deepEqual(await purgeRecordings(existing), { deleted: 0, failed: 0 });
  assert.equal(requests, 1);
  await assert.rejects(
    purgeRecordings({ ...existing, STREAM_RECORDING_CLEANUP_ACCOUNT_ID: "d".repeat(32) }),
    /not configured/,
  );
  assert.equal(requests, 1);
});

test("cleanup deletes this input's finished videos and rechecks status before touching any recording", async (context) => {
  const finished = ["ready", "error", "queued", "inprogress", "downloading", "pendingupload"].map(
    (state, index) => recording(String(index + 1).repeat(32), state),
  );
  const active = recording("9".repeat(32), "live-inprogress");
  const foreign = recording("b".repeat(32), "ready", "c".repeat(32));
  const uncertain = recording("d".repeat(32), "unknown");
  const changed = recording("e".repeat(32), "ready");
  const deleted: string[] = [];
  const checked: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${env.STREAM_RECORDING_CLEANUP_API_TOKEN}`,
      );
      assert.equal(init?.redirect, "error");
      if (url.search) {
        assert.equal(url.searchParams.get("live_input_id"), inputId);
        assert.equal(url.searchParams.get("limit"), "1000");
        return Response.json({
          success: true,
          result: [...finished, active, foreign, uncertain, changed],
        });
      }
      const uid = url.pathname.split("/").at(-1)!;
      if (init?.method === "DELETE") {
        deleted.push(uid);
        return new Response(null, { status: 204 });
      }
      checked.push(uid);
      return Response.json({
        success: true,
        result:
          uid === changed.uid
            ? recording(uid, "live-inprogress")
            : finished.find((video) => video.uid === uid),
      });
    },
  );
  assert.deepEqual(await purgeRecordings(env), { deleted: 6, failed: 0 });
  assert.deepEqual(deleted.sort(), finished.map((video) => video.uid).sort());
  assert.ok(checked.includes(changed.uid));
  assert.ok(!checked.includes(active.uid));
  assert.ok(!checked.includes(foreign.uid));
  assert.ok(!checked.includes(uncertain.uid));
});

test("cleanup retries failed deletions on later runs without losing the successful work", async (context) => {
  let videos = [recording("1".repeat(32), "ready"), recording("2".repeat(32), "ready")];
  let failFirst = true;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.search) return Response.json({ success: true, result: videos });
      const uid = url.pathname.split("/").at(-1)!;
      if (init?.method === "DELETE") {
        if (failFirst && uid === "1".repeat(32)) return new Response(null, { status: 503 });
        videos = videos.filter((video) => video.uid !== uid);
        return Response.json({ success: true });
      }
      return Response.json({ success: true, result: videos.find((video) => video.uid === uid) });
    },
  );
  assert.deepEqual(await purgeRecordings(env), { deleted: 1, failed: 1 });
  assert.equal(videos.length, 1);
  failFirst = false;
  assert.deepEqual(await purgeRecordings(env), { deleted: 1, failed: 0 });
  assert.equal(videos.length, 0);
});

test("cleanup fails closed when authorization or provider metadata cannot be trusted", async (context) => {
  let response = () => new Response(null, { status: 403 });
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
      assert.notEqual(init?.method, "DELETE");
      return response();
    },
  );
  await assert.rejects(purgeRecordings(env), /request failed \(403\)/);
  response = () => Response.json({ success: false, result: [] });
  await assert.rejects(purgeRecordings(env), /invalid metadata/);
  response = () => Response.json({ success: true, result: {} });
  await assert.rejects(purgeRecordings(env), /invalid video list/);
  await assert.rejects(
    purgeRecordings({ ...env, STREAM_RECORDING_CLEANUP_API_TOKEN: undefined }),
    /not configured/,
  );
});
