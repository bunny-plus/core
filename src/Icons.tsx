import { useSyncExternalStore, type ReactNode } from "react";

type AssetName = "blossom" | "bunny" | "bunny-face" | "carrot" | "leafy";
type IconName =
  | "chat"
  | "disc"
  | "film"
  | "fullscreen"
  | "gear"
  | "heart"
  | "lock"
  | "moon"
  | "nail"
  | "paw"
  | "server"
  | "sparkle"
  | "volume"
  | "volume-off"
  | "wrench";

const assets: Record<AssetName, string> = {
  blossom: "/cherry_blossom_3d.png",
  bunny: "/rabbit_animated.png",
  "bunny-face": "/rabbit_face_animated.png",
  carrot: "/carrot_3d.png",
  leafy: "/leafy_green_3d.png",
};

const staticBunnies = {
  bunny: "/rabbit_static.png",
  "bunny-face": "/rabbit_face_static.png",
};

function reducedMotionSnapshot() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function subscribeToReducedMotion(update: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

export function AssetIcon({
  animate = true,
  className = "",
  name,
}: {
  animate?: boolean;
  className?: string;
  name: AssetName;
}) {
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const source =
    (reduceMotion || !animate) && (name === "bunny" || name === "bunny-face")
      ? staticBunnies[name]
      : assets[name];
  return (
    <img
      className={`asset-icon asset-${name} ${className}`}
      src={source}
      alt=""
      aria-hidden="true"
    />
  );
}

export function UiIcon({ className = "", name }: { className?: string; name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    chat: (
      <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v7a3.5 3.5 0 0 1-3.5 3.5H10l-5.5 4v-4.6A3.5 3.5 0 0 1 4 13.5v-8Z" />
    ),
    disc: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" />
      </>
    ),
    fullscreen: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    heart: (
      <path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    moon: <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 9 9 0 1 0 20.5 15.5Z" />,
    nail: (
      <>
        <path d="M8 3h8l-1 5H9L8 3Z" />
        <path d="M9 8h6l2 12H7L9 8Z" />
        <path d="M10 12h4M10.5 16h3" />
      </>
    ),
    paw: (
      <>
        <circle cx="7" cy="8" r="2" />
        <circle cx="12" cy="5.5" r="2" />
        <circle cx="17" cy="8" r="2" />
        <path d="M6.5 17c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5c0 2-1.7 3-3.2 2.2a4.8 4.8 0 0 0-4.6 0C8.2 20 6.5 19 6.5 17Z" />
      </>
    ),
    server: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5" />
      </>
    ),
    sparkle: (
      <path d="M12 2c.8 5.2 2.8 8 8 10-5.2 2-7.2 4.8-8 10-.8-5.2-2.8-8-8-10 5.2-2 7.2-4.8 8-10Z" />
    ),
    volume: (
      <>
        <path d="M4 10v4h4l5 4V6L8 10H4Z" />
        <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
      </>
    ),
    "volume-off": (
      <>
        <path d="M4 10v4h4l5 4V6L8 10H4Z" />
        <path d="m17 10 5 5M22 10l-5 5" />
      </>
    ),
    wrench: (
      <path d="M21 6.5a6 6 0 0 1-7.8 5.7L6.4 19a2 2 0 1 1-2.8-2.8l6.8-6.8A6 6 0 0 1 18.5 2L15 5.5l3.5 3.5L21 6.5Z" />
    ),
  };

  return (
    <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
