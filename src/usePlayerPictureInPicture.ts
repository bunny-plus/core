import { useLayoutEffect, useRef, useState, type RefObject } from "react";

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options: { width: number; height: number }): Promise<Window>;
    };
  }
}

function copyPlayerStyles(target: Document) {
  const base = target.createElement("base");
  base.href = document.baseURI;
  target.head.append(base);
  for (const sheet of document.styleSheets) {
    if (sheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      link.media = sheet.media.mediaText;
      target.head.append(link);
    } else {
      const style = target.createElement("style");
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      style.media = sheet.media.mediaText;
      target.head.append(style);
    }
  }
}

export function usePlayerPictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  // Keep the portal target stable when moving documents so playback and React events survive.
  const [playerMount] = useState(() => document.createElement("div"));
  const dockRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const sessionRef = useRef<{ window: Window; restore: () => void } | null>(null);
  const pendingRef = useRef(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const supported = !!window.documentPictureInPicture;

  useLayoutEffect(() => {
    mountedRef.current = true;
    dockRef.current?.append(playerMount);
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      session?.restore();
      session?.window.close();
      playerMount.remove();
    };
  }, [playerMount]);

  function movePlayer(target: HTMLElement) {
    const video = videoRef.current;
    const playing = video && !video.paused;
    target.append(playerMount);
    if (playing) void video.play().catch(() => {});
  }

  async function toggle() {
    const session = sessionRef.current;
    if (session) {
      session.restore();
      session.window.close();
      return;
    }
    const api = window.documentPictureInPicture;
    if (!api || pendingRef.current) return;
    pendingRef.current = true;
    setOpening(true);
    setError("");
    let opened: Window | null = null;
    try {
      opened = await api.requestWindow({ width: 640, height: 360 });
      if (!mountedRef.current || !dockRef.current) {
        opened.close();
        return;
      }
      const pip = opened;
      copyPlayerStyles(pip.document);
      pip.document.title = "bunny.plus · picture-in-picture";
      pip.document.body.className = "player-pip";
      pip.document.body.classList.toggle(
        "lights-out",
        document.body.classList.contains("lights-out"),
      );
      const shell = pip.document.createElement("div");
      shell.className = "stream-page";
      pip.document.body.append(shell);
      const restore = () => {
        if (sessionRef.current?.window !== pip) return;
        sessionRef.current = null;
        pip.removeEventListener("pagehide", restore);
        const dock = dockRef.current;
        if (dock) movePlayer(dock);
        if (mountedRef.current) setPipWindow(null);
      };
      sessionRef.current = { window: pip, restore };
      pip.addEventListener("pagehide", restore);
      movePlayer(shell);
      setPipWindow(pip);
    } catch {
      sessionRef.current?.restore();
      opened?.close();
      if (mountedRef.current) setError("Couldn’t open picture-in-picture. Please try again.");
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setOpening(false);
    }
  }

  return { dockRef, playerMount, pipWindow, supported, opening, error, toggle };
}
