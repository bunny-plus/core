import { useState, type FormEvent } from "react";

import { UiIcon } from "./Icons";
import { apiJson } from "./api";

const qualities = [
  { label: "Best available", value: "best" },
  { label: "Up to 1080p", value: "1080p" },
  { label: "Up to 720p", value: "720p" },
  { label: "Up to 480p", value: "480p" },
] as const;

export default function RestreamControl({ onStarted }: { onStarted: (title: string) => void }) {
  const [source, setSource] = useState("");
  const [quality, setQuality] = useState("best");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiJson<{ detail: string; title: string }>("/api/admin/restream/start", {
        body: JSON.stringify({ quality, source }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      onStarted(result.title);
      setMessage(result.detail);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the restream");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="restream-panel">
      <div className="restream-intro">
        <UiIcon name="broadcast" />
        <div>
          <strong>Relay a public livestream</strong>
          <p>
            Paste a YouTube or Twitch stream URL. Private and subscriber streams are unsupported.
          </p>
        </div>
      </div>
      <form onSubmit={(event) => void start(event)}>
        <label className="restream-url">
          <span>Stream URL</span>
          <input
            type="url"
            value={source}
            placeholder="https://www.twitch.tv/channel"
            autoComplete="off"
            required
            spellCheck={false}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label className="restream-quality">
          <span>Input quality</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value)}>
            {qualities.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="start-relay" type="submit" disabled={busy || !source.trim()}>
          {busy ? "Connecting..." : "Start restream"}
        </button>
      </form>
      {message && <p className="stream-message">{message}</p>}
    </div>
  );
}
