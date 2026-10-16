import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { apiJson } from "./api";
import { AssetIcon } from "./Icons";

export default function DiscordLogin() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [error, setError] = useState<string | null>(null);
  const redemption = useRef<Promise<{ ok: true }> | null>(null);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError("Run /login in Bunny's Discord for a fresh private login link.");
      return;
    }
    let active = true;
    redemption.current ??= apiJson<{ ok: true }>("/api/login/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    void redemption.current.then(
      () => {
        if (active) window.location.replace("/");
      },
      (reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Couldn't sign you in. Please try /login again in Discord.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <section className="session-error-card" aria-live="polite">
      <AssetIcon animate={!error} name="bunny-face" />
      <h1>{error ? "Let's get you a new link ♡" : "Hopping in..."}</h1>
      <p>{error || "Opening your little corner of bunny.plus ♡"}</p>
      {error && (
        <Link className="primary-button" to="/">
          Back to bunny.plus
        </Link>
      )}
    </section>
  );
}
