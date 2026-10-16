import { useCallback, useState } from "react";

export type ChatDisplayMode = "bubbles" | "scrolling";

function readPreference(key: string) {
  try {
    return localStorage.getItem(`bunny-plus-${key}`);
  } catch {
    return null;
  }
}

function usePreference<T>(
  key: string,
  parse: (stored: string | null) => T,
  encode: (value: T) => string = String,
) {
  const [value, setValue] = useState(() => parse(readPreference(key)));
  const change = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`bunny-plus-${key}`, encode(next));
      } catch {}
    },
    [key, encode],
  );
  return [value, change] as const;
}

function sidebarValue(open: boolean) {
  return open ? "open" : "closed";
}

export function usePlayerPreferences() {
  const [volume, setVolume] = usePreference("volume", (stored) => {
    const value = Number(stored);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  });
  const [lightsOut, setLightsOut] = usePreference("lights-out", (value) => value === "true");
  const [shortcutsEnabled, setShortcutsEnabled] = usePreference(
    "shortcuts",
    (value) => value !== "false",
  );
  const [chatDisplayMode, setChatDisplayMode] = usePreference<ChatDisplayMode>(
    "chat-display",
    (value) => (value === "bubbles" ? "bubbles" : "scrolling"),
  );
  const [sidebarOpen, setSidebarOpen] = usePreference(
    "sidebar",
    (value) => value !== "closed",
    sidebarValue,
  );
  const [theatreMode, setTheatreMode] = usePreference("theatre", (value) => value === "true");

  return {
    volume,
    setVolume,
    lightsOut,
    setLightsOut,
    shortcutsEnabled,
    setShortcutsEnabled,
    chatDisplayMode,
    setChatDisplayMode,
    sidebarOpen,
    setSidebarOpen,
    theatreMode,
    setTheatreMode,
  };
}
