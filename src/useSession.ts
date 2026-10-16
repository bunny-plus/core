import { useEffect, useState } from "react";
import type { Session } from "../shared/user";
import { ApiError, apiFetch, apiJson } from "./api";

async function readSession(signal: AbortSignal) {
  try {
    return await apiJson<Session>("/api/session", { signal });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionRequest, setSessionRequest] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const request = new AbortController();

    async function loadSession() {
      try {
        const result = await readSession(request.signal);
        if (!request.signal.aborted) setSession(result);
      } catch (error) {
        if (request.signal.aborted) return;
        setSessionError(
          error instanceof Error ? error.message : "The session service could not be reached.",
        );
      }
    }

    void loadSession();

    return () => request.abort();
  }, [sessionRequest]);

  const signedIn = session !== undefined && session !== null;
  useEffect(() => {
    if (!signedIn || loggingOut) return;
    const request = new AbortController();
    let pending = false;

    async function refreshSession() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const refreshed = await readSession(request.signal);
        if (!request.signal.aborted) setSession(refreshed);
      } catch {
      } finally {
        pending = false;
      }
    }

    const refresh = () => void refreshSession();
    const interval = window.setInterval(refresh, 15 * 60 * 1_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      request.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn, loggingOut]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await apiFetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error(`Logout failed with status ${response.status}.`);
      setSession(null);
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Could not log out. Please try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  function retrySession() {
    setSessionError(null);
    setSession(undefined);
    setSessionRequest((request) => request + 1);
  }
  return { session, sessionError, retrySession, loggingOut, logoutError, logout };
}
