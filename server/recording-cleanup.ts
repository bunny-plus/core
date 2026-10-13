import type { Env } from "../worker/index";
import { streamApiBaseUrl, streamInputId } from "./stream-playback";
import { fetchJson, readBoundedBytes, type JsonObject, type JsonValue } from "./upstream";

type CleanupEnvironment = Pick<Env, "STREAM_URL" | "CF_ACCOUNT_ID" | "CF_TOKEN">;

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRecording(value: JsonValue, inputId: string): value is JsonObject & { uid: string } {
  return (
    isObject(value) &&
    typeof value.uid === "string" &&
    /^[a-f\d]{32}$/i.test(value.uid) &&
    value.liveInput === inputId &&
    isObject(value.status) &&
    typeof value.status.state === "string" &&
    ["ready", "error", "queued", "inprogress", "downloading", "pendingupload"].includes(
      value.status.state,
    )
  );
}

async function metadata(url: string, token: string) {
  const { data } = await fetchJson<JsonValue>(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    timeoutMs: 10_000,
    maxBytes: 4_000_000,
    name: "Recording cleanup",
  });
  if (!isObject(data) || data.success !== true || data.result === undefined)
    throw new Error("Recording cleanup returned invalid metadata");
  return data.result;
}

async function deleteRecording(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    method: "DELETE",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404 || response.status === 204) {
    await response.body?.cancel();
    return;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Recording deletion failed (${response.status})`);
  }
  // Stream deletions can succeed with an empty 200 response as well as a 204.
  if (response.status === 200 && !response.body) return;
  const bytes = await readBoundedBytes(response, 32_000, "Recording deletion");
  if (response.status === 200 && bytes.length === 0) return;
  const data: JsonValue = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObject(data) || data.success !== true)
    throw new Error("Recording deletion was not confirmed");
}

export async function purgeRecordings(env: CleanupEnvironment) {
  const { CF_ACCOUNT_ID: accountId, CF_TOKEN: token } = env;
  if (!accountId || !token) throw new Error("Recording cleanup credentials are not configured");
  if (!/^[a-f\d]{32}$/i.test(accountId)) throw new Error("Recording cleanup account ID is invalid");
  const inputId = streamInputId(env.STREAM_URL);
  const base = `${streamApiBaseUrl}/${accountId}/stream`;
  const query = new URLSearchParams({ live_input_id: inputId, limit: "1000" });
  const videos = await metadata(`${base}?${query}`, token);
  if (!Array.isArray(videos)) throw new Error("Recording cleanup returned an invalid video list");
  let deleted = 0;
  let failed = 0;
  const candidates = videos.filter((video) => isRecording(video, inputId));
  // Recheck each video before deletion: an active broadcast must never be removed.
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const results = await Promise.allSettled(
      candidates.slice(offset, offset + 4).map(async (video) => {
        const url = `${base}/${video.uid}`;
        const current = await metadata(url, token);
        if (!isRecording(current, inputId) || current.uid !== video.uid) return false;
        await deleteRecording(url, token);
        return true;
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") failed += 1;
      else if (result.value) deleted += 1;
    }
  }
  return { deleted, failed };
}

export function startRecordingCleanup(env: CleanupEnvironment) {
  const { CF_ACCOUNT_ID: accountId, CF_TOKEN: token } = env;
  if (!accountId || !token) {
    console.warn(
      "Automatic recording cleanup is disabled: configure its account ID and API token.",
    );
    return;
  }
  let pending = false;
  const cleanup = async () => {
    if (pending) return;
    pending = true;
    try {
      const result = await purgeRecordings(env);
      if (result.deleted) console.log(`Removed ${result.deleted} finished stream recordings.`);
      if (result.failed)
        console.error(`Could not remove ${result.failed} stream recordings; will retry.`);
    } catch (error) {
      // Provider responses can contain private URLs; keep logs limited to our sanitized errors.
      console.error(
        "Recording cleanup could not complete; will retry.",
        error instanceof Error ? error.name : "Error",
      );
    } finally {
      pending = false;
    }
  };
  void cleanup();
  setInterval(() => void cleanup(), 30_000).unref();
}
