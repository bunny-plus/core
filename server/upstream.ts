export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;

export type JsonFetchOptions = RequestInit & {
  fetch?: typeof fetch;
  maxBytes?: number;
  name: string;
  requireOk?: boolean;
  timeoutMs: number;
};

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function readBoundedBytes(response: Response, maxBytes: number, name: string) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamError(`${name} response was too large`);
  }

  if (!response.body) throw new UpstreamError(`${name} returned an invalid response`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new UpstreamError(`${name} response was too large`);
      chunks.push(value);
    }
  } finally {
    if (length > maxBytes) await reader.cancel();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchJson<T>(
  url: string | URL,
  options: JsonFetchOptions,
): Promise<{ data: T; response: Response }> {
  const {
    fetch: fetchImplementation = fetch,
    maxBytes = 1_000_000,
    name,
    requireOk = true,
    timeoutMs,
    ...init
  } = options;

  let response: Response;
  try {
    response = await fetchImplementation(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new UpstreamError(`${name} request timed out`);
    }
    throw new UpstreamError(`${name} request failed`);
  }

  if (requireOk && !response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(`${name} request failed (${response.status})`, response.status);
  }
  const contentType =
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) {
    await response.body?.cancel();
    throw new UpstreamError(`${name} returned an invalid response`, response.status);
  }

  try {
    // SAFETY: Callers provide the expected response contract and validate required fields before use.
    return {
      data: JSON.parse(
        new TextDecoder().decode(await readBoundedBytes(response, maxBytes, name)),
      ) as T,
      response,
    };
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError(`${name} returned invalid JSON`, response.status);
  }
}
