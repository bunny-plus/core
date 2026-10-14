import { useState } from "react";
import type { StreamStatus } from "../shared/stream";
import { UiIcon } from "./Icons";
import JellyfinControl from "./JellyfinControl";
import RestreamControl from "./RestreamControl";
import { apiJson } from "./api";

export default function StreamControl({
  status,
  onStreamChange,
}: {
  status: StreamStatus | null;
  onStreamChange: () => void;
}) {
  const [source, setSource] = useState<"jellyfin" | "restream">("jellyfin");
  const [stopping, setStopping] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function streamStarted() {
    onStreamChange();
    setMessage(null);
  }

  async function stop() {
    setStopping(true);
    setMessage(null);
    try {
      await apiJson("/api/admin/stream/stop", { method: "POST" });
      onStreamChange();
      setMessage("Stream stopped");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop stream");
    } finally {
      setStopping(false);
    }
  }

  return (
    <section className="stream-modal backstage-controls" aria-labelledby="stream-control-title">
      <h2 id="stream-control-title" className="sr-only">
        Stream source
      </h2>

      {status?.running && (
        <div className="current-stream">
          <div>
            <i />
            <span>On air</span>
            <strong>{status.title || "Room stream"}</strong>
          </div>
          <button type="button" disabled={stopping || sourceBusy} onClick={() => void stop()}>
            {stopping ? "Stopping..." : "Stop stream"}
          </button>
        </div>
      )}

      <div className="source-picker" role="group" aria-label="Stream source">
        <button
          className={source === "restream" ? "active" : ""}
          disabled={sourceBusy || stopping}
          type="button"
          aria-pressed={source === "restream"}
          onClick={() => setSource("restream")}
        >
          <UiIcon name="broadcast" />
          <span>
            <strong>Restream</strong>
            <small>YouTube + Twitch</small>
          </span>
        </button>
        <button
          className={source === "jellyfin" ? "active" : ""}
          disabled={sourceBusy || stopping}
          type="button"
          aria-pressed={source === "jellyfin"}
          onClick={() => setSource("jellyfin")}
        >
          <UiIcon name="server" />
          <span>
            <strong>Jellyfin</strong>
            <small>Movies + shows</small>
          </span>
        </button>
      </div>

      {message && (
        <p className="stream-message" role="status">
          {message}
        </p>
      )}
      {source === "restream" && (
        <RestreamControl onBusyChange={setSourceBusy} onStarted={streamStarted} />
      )}
      {source === "jellyfin" && (
        <JellyfinControl onBusyChange={setSourceBusy} onStarted={streamStarted} />
      )}
    </section>
  );
}
