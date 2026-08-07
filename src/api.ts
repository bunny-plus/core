const configuredApiUrl =
  import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "") ||
  (location.hostname === "bunny.plus" ? "https://api.bunny.plus" : "");

export function apiUrl(path: string) {
  return `${configuredApiUrl}${path}`;
}

export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(apiUrl(path), { ...init, credentials: "include" });
}

export function apiWebSocketUrl(path: string) {
  const url = new URL(apiUrl(path), location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
