import assert from "node:assert/strict";
import test from "node:test";
import { cleanupRecordings } from "./recording-cleanup";

const input = "a".repeat(32);
const env = {
  CF_ACCOUNT_ID: "b".repeat(32),
  CF_TOKEN: "test-account-token-kept-private",
  STREAM_URL: `https://customer-test.cloudflarestream.com/${input}/manifest/video.m3u8?protocol=llhlsbeta`,
};
const recording = (uid: string, state = "ready", modified = "2020-01-01T00:00:00Z") => ({
  uid: uid.repeat(32),
  liveInput: input,
  status: { state },
  modified,
});

test("cleanup deletes only completed recordings from this input after a grace period and rechecks each candidate", async (context) => {
  const rows = [
    recording("1"),
    recording("2", "error"),
    recording("3", "live-inprogress"),
    recording("4", "inprogress"),
    recording("5", "ready", new Date().toISOString()),
    { ...recording("6"), liveInput: "c".repeat(32) },
    recording("a"),
    recording("7", "ready", "invalid"),
    recording("8"),
    recording("9"),
  ];
  const deleted: string[] = [];
  const inspected: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(
      init.headers && new Headers(init.headers).get("Authorization"),
      `Bearer ${env.CF_TOKEN}`,
    );
    assert.equal(init.redirect, "error");
    if (url.endsWith(`/live_inputs/${input}/videos`))
      return Response.json({ success: true, result: rows });
    const uid = url.split("/").at(-1)!;
    if (init.method === "DELETE") {
      deleted.push(uid);
      return new Response(null, { status: 200 });
    }
    inspected.push(uid);
    const result =
      uid === "8".repeat(32)
        ? recording("8", "live-inprogress")
        : uid === "9".repeat(32)
          ? { ...recording("9"), liveInput: "d".repeat(32) }
          : rows.find((row) => row.uid === uid);
    return Response.json({ success: true, result });
  });
  assert.deepEqual(await cleanupRecordings(env), { eligible: 2, deleted: 2 });
  assert.deepEqual(deleted, ["1".repeat(32), "2".repeat(32)]);
  assert.deepEqual(inspected, ["1".repeat(32), "2".repeat(32), "8".repeat(32), "9".repeat(32)]);
});

test("cleanup dry run never deletes and failed deletions remain retryable without exposing provider errors", async (context) => {
  let deletes = 0;
  let reject = true;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/videos")) return Response.json({ success: true, result: [recording("1")] });
    if (init.method === "DELETE") {
      deletes++;
      return reject
        ? new Response("private upstream diagnostics", { status: 503 })
        : new Response(null, { status: 404 });
    }
    return Response.json({ success: true, result: recording("1") });
  });
  assert.deepEqual(await cleanupRecordings(env, true), { eligible: 1, deleted: 0 });
  assert.equal(deletes, 0);
  await assert.rejects(cleanupRecordings(env), {
    message: "Recording cleanup failed for 1 recording(s); next run will retry",
  });
  reject = false;
  assert.deepEqual(await cleanupRecordings(env), { eligible: 1, deleted: 1 });
  assert.equal(deletes, 2);
});

test("cleanup refuses invalid targets and API failures before deleting anything", async (context) => {
  const mock = context.mock.method(globalThis, "fetch", async () =>
    Response.json({ success: false, result: [] }),
  );
  await assert.rejects(cleanupRecordings({ ...env, STREAM_URL: "https://unrelated.test/video" }));
  await assert.rejects(cleanupRecordings({ ...env, CF_ACCOUNT_ID: "invalid" }));
  assert.equal(mock.mock.callCount(), 0);
  await assert.rejects(cleanupRecordings(env), /Recording cleanup request failed/);
  assert.equal(mock.mock.callCount(), 1);
});
