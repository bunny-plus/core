import { isJsonObject, isString, type JsonValue } from "../shared/json";
import { streamInputId } from "./stream-playback";
import { readBoundedBytes, UpstreamError } from "./upstream";

type CleanupEnvironment = { CF_ACCOUNT_ID: string; CF_TOKEN: string; STREAM_URL: string };

function completedRecording(value: JsonValue, input: string, now: number) {
  return (
    isJsonObject(value) &&
    isString(value.uid) &&
    /^[a-f\d]{32}$/.test(value.uid) &&
    value.uid !== input &&
    value.liveInput === input &&
    isJsonObject(value.status) &&
    (value.status.state === "ready" || value.status.state === "error") &&
    isString(value.modified) &&
    Date.parse(value.modified) <= now - 120_000
  );
}

export async function cleanupRecordings(env: CleanupEnvironment, dryRun = false) {
  if (!/^[a-f\d]{32}$/i.test(env.CF_ACCOUNT_ID) || !/^[\x21-\x7e]{20,512}$/.test(env.CF_TOKEN))
    throw new Error("Recording cleanup requires Cloudflare account credentials");
  const input = streamInputId(env.STREAM_URL);
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream`;
  const now = Date.now();
  async function request(path: string, method = "GET") {
    let response: Response;
    try {
      response = await fetch(base + path, {
        headers: { Authorization: `Bearer ${env.CF_TOKEN}` },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Recording cleanup request failed");
    }
    if (response.status === 404 || (method === "DELETE" && response.ok)) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError(`Recording cleanup request failed (${response.status})`);
    }
    let data: JsonValue;
    try {
      data = JSON.parse(
        new TextDecoder().decode(await readBoundedBytes(response, 5_000_000, "Recording cleanup")),
      );
    } catch {
      throw new Error("Recording cleanup returned invalid data");
    }
    if (!isJsonObject(data) || data.success !== true)
      throw new UpstreamError(`Recording cleanup request failed (${response.status})`);
    return data.result ?? null;
  }

  const recordings = await request(`/live_inputs/${input}/videos`);
  if (!Array.isArray(recordings)) throw new Error("Recording cleanup returned an invalid list");
  let deleted = 0;
  let eligible = 0;
  let failed = 0;
  for (const recording of recordings) {
    if (!completedRecording(recording, input, now) || !isJsonObject(recording)) continue;
    try {
      const current = await request(`/${recording.uid}`);
      if (
        !completedRecording(current, input, now) ||
        !isJsonObject(current) ||
        current.uid !== recording.uid
      )
        continue;
      eligible++;
      if (!dryRun) {
        await request(`/${recording.uid}`, "DELETE");
        deleted++;
      }
    } catch {
      failed++;
    }
  }
  if (failed)
    throw new Error(`Recording cleanup failed for ${failed} recording(s); next run will retry`);
  return { eligible, deleted };
}
