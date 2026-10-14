import type { StreamStatus } from "../shared/stream";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { AssetIcon, UiIcon } from "./Icons";
import StreamControl from "./StreamControl";

export default function StreamBackstage({
  status,
  onStreamChange,
}: {
  status: StreamStatus | null;
  onStreamChange: () => void;
}) {
  const { hash } = useLocation();
  const [open, setOpen] = useState(hash === "#backstage");
  const [visited, setVisited] = useState(open);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (hash === "#backstage") setOpen(true);
  }, [hash]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setVisited(true);
      if (!dialog.open) dialog.showModal();
      document.body.style.setProperty(
        "--backstage-scrollbar",
        `${window.innerWidth - document.documentElement.clientWidth}px`,
      );
    } else if (dialog.open) {
      dialog.close();
    }
    document.body.classList.toggle("backstage-open", open);
    return () => {
      document.body.classList.remove("backstage-open");
      document.body.style.removeProperty("--backstage-scrollbar");
    };
  }, [open]);

  return (
    <>
      <button
        id="backstage"
        className="backstage-launcher"
        type="button"
        aria-label="Open stream control"
        aria-haspopup="dialog"
        aria-controls="backstage-dialog"
        data-tooltip="Stream control"
        onClick={() => setOpen(true)}
      >
        <AssetIcon animate={false} name="heart-locket" />
        <span className="sr-only">Backstage</span>
      </button>
      <dialog
        ref={dialogRef}
        className="backstage-dialog"
        id="backstage-dialog"
        aria-labelledby="backstage-title"
        aria-describedby="backstage-description"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="backstage-heading">
          <div>
            <span className="backstage-eyebrow">
              <UiIcon name="lock" /> ADMINS ONLY
            </span>
            <h2 id="backstage-title">
              backstage <UiIcon name="sparkle" />
            </h2>
            <p id="backstage-description">Your room. Your show. Pick what plays next.</p>
          </div>
          <span className="backstage-pass" aria-hidden="true">
            <AssetIcon animate={false} name="bow" />
            <span>ALL ACCESS</span>
            <strong>bunny+</strong>
          </span>
          <button
            className="backstage-close"
            type="button"
            aria-label="Close stream control"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="backstage-body">
          {visited && <StreamControl status={status} onStreamChange={onStreamChange} />}
        </div>
        <footer className="backstage-footer">
          <UiIcon name="heart" /> keep it cute, keep it rolling
        </footer>
      </dialog>
    </>
  );
}
