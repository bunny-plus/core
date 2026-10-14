import { isJsonObject, isString, type JsonValue } from "../shared/json";

const configuredApiUrl =
  import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "") ||
  (location.hostname === "bunny.plus" ? "https://api.bunny.plus" : "");

export function apiUrl(path: string) {
  return `${configuredApiUrl}${path}`;
}

export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}

export async function apiJson<T>(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init);
  const result: JsonValue = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isJsonObject(result) && isString(result.error) ? result.error : null;
    throw new ApiError(
      message || `Request failed (${response.status}). Please try again.`,
      response.status,
    );
  }
  if (result === null)
    throw new ApiError("The server returned an invalid response.", response.status);
  // SAFETY: Callers select the matching contract for a first-party bunny.plus API route.
  return result as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiWebSocketUrl(path: string) {
  const url = new URL(apiUrl(path), location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
