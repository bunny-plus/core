import { useEffect, useState } from "react";

import { AssetIcon } from "./Icons";

type JsonObject = { [key: string]: JsonValue };
type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;
type VersionPayload = { version: string };

const CHECK_INTERVAL = 60_000;

function isVersionPayload(value: JsonValue): value is VersionPayload {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    typeof value.version === "string"
  );
}

export default function UpdatePrompt() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  useEffect(() => {
    let request: AbortController | undefined;

    async function checkForUpdate() {
      request?.abort();
      request = new AbortController();
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) return;
        const result: JsonValue = await response.json();
        if (!isVersionPayload(result)) return;
        if (result.version && result.version !== __STATIC_VERSION__) {
          setAvailableVersion(result.version);
        }
      } catch {
        // Update checks are best-effort and should never disrupt the current page.
      }
    }

    function checkVisiblePage() {
      if (document.visibilityState === "visible") void checkForUpdate();
    }

    void checkForUpdate();
    const timer = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL);
    window.addEventListener("focus", checkVisiblePage);
    document.addEventListener("visibilitychange", checkVisiblePage);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", checkVisiblePage);
      document.removeEventListener("visibilitychange", checkVisiblePage);
    };
  }, []);

  if (!availableVersion) return null;

  function loadUpdate() {
    if (!availableVersion) return;
    const url = new URL(window.location.href);
    url.searchParams.set("_version", availableVersion);
    window.location.replace(url);
  }

  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <AssetIcon animate={false} name="bunny-face" />
      <span>
        <strong>Fresh carrots arrived</strong>
        <small>A new bunny+ version is ready.</small>
      </span>
      <button type="button" onClick={loadUpdate}>
        Update
      </button>
    </aside>
  );
}
