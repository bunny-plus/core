import { useEffect, useRef, useState } from "react";

import WatchRoom, { type User } from "./WatchRoom";
import StreamControl from "./StreamControl";
import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiUrl } from "./api";

type Session = {
  delaySeconds: number;
  streamUrl: string;
  user: User;
};

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [version, setVersion] = useState<string | null>(null);
  const loadedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    apiFetch("/api/session")
      .then((response) => response.ok ? response.json() as Promise<Session> : null)
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    let stopped = false;

    async function checkVersion() {
      try {
        const response = await apiFetch("/api/version", { cache: "no-store" });
        const result = await response.json() as { version: string };
        if (stopped) return;

        const previous = loadedVersionRef.current ?? localStorage.getItem("bunny-plus-version");
        if (previous && previous !== result.version) {
          localStorage.setItem("bunny-plus-version", result.version);
          const url = new URL(location.href);
          url.searchParams.set("_version", result.version);
          location.replace(url);
          return;
        }

        loadedVersionRef.current = result.version;
        localStorage.setItem("bunny-plus-version", result.version);
        setVersion(result.version);
      } catch {
        // A failed update check should not interrupt the current page.
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") void checkVersion();
    }

    void checkVersion();
    const timer = setInterval(checkVersion, 60_000);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  if (session === undefined) return <main className="login-shell"><FloatingDecorations /><p className="loading-bunny"><AssetIcon name="bunny-face" /><small>Hopping in...</small></p><VersionBadge version={version} /></main>;
  if (session === null) return <Login version={version} />;

  async function logout() {
    await apiFetch("/api/logout", { method: "POST" });
    setSession(null);
  }

  const path = location.pathname.replace(/\/$/, "") || "/";
  const canManageStream = session.user.admin || session.user.permissions?.includes("stream.manage") === true;
  const canChatChloe = session.user.admin || session.user.permissions?.includes("chloe.chat") === true;
  const page = path === "/stream"
    ? <WatchRoom {...session} currentUser={session.user} />
    : path === "/admin" && canManageStream
      ? <AdminPage />
      : path === "/chloe" && canChatChloe
        ? <ChloePage />
        : <HomePage canChatChloe={canChatChloe} canManageStream={canManageStream} />;

  return (
    <main className={`room-shell${path === "/stream" ? " stream-page" : ""}`}>
      <FloatingDecorations />
      <header className="room-header">
        <a className="wordmark" href="/"><AssetIcon name="bunny-face" /> bunny<span>+</span></a>
        <div className="account">
          <details className="profile-menu">
            <summary aria-label="Open profile menu" title={session.user.name}>
              {session.user.avatar
                ? <img src={session.user.avatar} alt="" />
                : <span>{session.user.name[0]?.toUpperCase()}</span>}
              {canManageStream && <AssetIcon className="profile-carrot" name="carrot" />}
            </summary>
            <div className="profile-popover">
              <div className="profile-identity">
                <small>{canManageStream ? "BURROW KEEPER" : "BUNNY+ MEMBER"}</small>
                <strong>{session.user.name}</strong>
              </div>
              {canManageStream && <a href="/admin"><UiIcon name="wrench" /> Admin burrow</a>}
              <button type="button" onClick={() => void logout()}><AssetIcon name="bunny" /> Hop out</button>
            </div>
          </details>
        </div>
      </header>
      {page}
      <VersionBadge version={version} />
    </main>
  );
}

function HomePage({ canChatChloe, canManageStream }: { canChatChloe: boolean; canManageStream: boolean }) {
  return (
    <section className="activity-home">
      <div className="burrow-title"><h1>pick a tunnel</h1><UiIcon name="paw" /></div>
      <div className="burrow-map">
        <svg className="burrow-trail" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">
          <path d="M500 8 C510 48 535 63 565 100" />
          <path d="M520 245 C455 275 365 300 250 310" />
          <path d="M635 225 C720 220 790 250 860 285" />
          <path d="M250 350 C315 450 440 448 550 478" />
          <path d="M855 370 C790 450 685 450 590 478" />
        </svg>
        <AssetIcon className="trail-carrot carrot-one" name="carrot" />
        <AssetIcon className="trail-carrot carrot-two" name="carrot" />
        <AssetIcon className="trail-carrot carrot-three" name="carrot" />
        <a className="activity-spot cinema" href="/stream">
          <UiIcon className="spot-icon" name="film" />
          <small>NOW SHOWING</small>
          <h2>carrot cinema</h2>
          <p>the live room</p>
          <span className="ticket-stub" aria-hidden="true"><i>ADMIT</i><strong>ONE</strong><AssetIcon name="carrot" /></span>
        </a>
        {canManageStream ? (
          <a className="activity-spot admin" href="/admin">
            <UiIcon className="spot-icon" name="wrench" />
            <small>KEEP OUT, BUNS</small>
            <h2>admin burrow</h2>
            <p>break stuff</p>
          </a>
        ) : (
          <div className="activity-spot admin locked" aria-label="Admin burrow requires permission">
            <UiIcon className="spot-icon" name="lock" />
            <small>ROLE REQUIRED</small>
            <h2>admin burrow</h2>
            <p>no sneaking in</p>
            <b>can't go there</b>
          </div>
        )}
        {canChatChloe ? (
          <a className="activity-spot chloe" href="/chloe">
            <UiIcon className="chloe-sparkle sparkle-one" name="sparkle" />
            <UiIcon className="spot-icon" name="nail" />
            <UiIcon className="chloe-sparkle sparkle-two" name="sparkle" />
            <small>GIRL TALK</small>
            <h2>chat with chloe</h2>
            <p>gloss, gossip &amp; good advice</p>
          </a>
        ) : (
          <div className="activity-spot chloe locked chloe-locked" aria-label="Chat with Chloe requires permission">
            <UiIcon className="spot-icon" name="lock" />
            <small>GUEST LIST ONLY</small>
            <h2>chat with chloe</h2>
            <p>your name isn't down</p>
            <b>can't go there</b>
          </div>
        )}
        <div className="future-patch">
          <AssetIcon name="leafy" /><AssetIcon name="carrot" /><AssetIcon name="leafy" />
          <small>something is growing here...</small>
        </div>
        <span className="burrow-hole hole-one" aria-hidden="true" />
        <span className="burrow-hole hole-two" aria-hidden="true" />
      </div>
    </section>
  );
}

function ChloePage() {
  return (
    <section className="chloe-page">
      <div className="chloe-phone">
        <div className="chloe-phone-top"><span>✦ CHLOE ONLINE ✦</span><UiIcon name="nail" /></div>
        <div className="chloe-chat-preview">
          <span className="chloe-avatar"><UiIcon name="heart" /></span>
          <div><strong>chloe</strong><p>gimme a sec babe, doing my nails...</p></div>
        </div>
        <p className="chloe-coming-soon">chat is getting a gyaru makeover. check back soon ♡</p>
        <a href="/">back to the burrow</a>
      </div>
    </section>
  );
}

function AdminPage() {
  return (
    <section className="admin-page">
      <div className="admin-page-heading"><UiIcon name="wrench" /><div><p>ADMIN BURROW</p><h1>Stream control</h1><small>Pick what plays in carrot cinema. More controls can live here later.</small></div></div>
      <StreamControl />
    </section>
  );
}

function Login({ version }: { version: string | null }) {
  const error = new URLSearchParams(location.search).get("error");
  return (
    <main className="login-shell">
      <FloatingDecorations />
      <section className="login-content">
        <div className="login-hero">
          <AssetIcon className="hero-bunny" name="bunny-face" />
          <div><h1>bunny<span>+</span></h1></div>
        </div>
        <div className="login-card">
          {error && <p className="login-error">Could not admit that Discord account. Make sure you belong to the server.</p>}
          <a className="primary-button" href={apiUrl("/auth/discord")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.3 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128l.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01l.373.292a.077.077 0 0 1-.006.127c-.6.35-1.225.65-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419s.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419s.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
            Continue with Discord
          </a>
          <p className="admission-note">only bunny+ members can hop in.</p>
        </div>
      </section>
      <VersionBadge version={version} />
    </main>
  );
}

function VersionBadge({ version }: { version: string | null }) {
  if (!version) return null;
  return (
    <footer
      className="version-id"
      data-version={`Version ${version}`}
      aria-label={`Current Version ID: ${version}`}
      role="contentinfo"
      tabIndex={0}
    >
      <AssetIcon name="carrot" />
    </footer>
  );
}

function FloatingDecorations() {
  const decorations = ["bunny-face", "carrot", "blossom", "leafy", "bunny", "carrot", "blossom", "bunny-face", "carrot", "leafy", "bunny", "blossom"] as const;
  return (
    <div className="floating-decorations" aria-hidden="true">
      {decorations.map((decoration, index) => <AssetIcon name={decoration} key={index} />)}
    </div>
  );
}
