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
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function apiWebSocketUrl(path: string) {
  const url = new URL(apiUrl(path), location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
