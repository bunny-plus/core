import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import WatchRoom, { type User } from "./WatchRoom";
import StreamControl from "./StreamControl";
import CinemaDiary from "./CinemaDiary";
import CinemaTicketAdmin from "./CinemaTicketAdmin";
import { AssetIcon, UiIcon } from "./Icons";
import { apiFetch, apiUrl } from "./api";
import { useDismissibleDetails } from "./useDismissibleDetails";

type Session = {
  delaySeconds: number;
  streamUrl: string;
  user: User;
};

export default function App() {
  const route = useLocation();
  const path = route.pathname.replace(/\/$/, "") || "/";
  const previousLocation = useRef(route.key);
  const mainRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(profileRef);
  const [session, setSession] = useState<Session | null | undefined>();
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionRequest, setSessionRequest] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (previousLocation.current === route.key) return;
    previousLocation.current = route.key;
    profileRef.current?.removeAttribute("open");
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [route.key]);

  useEffect(() => {
    const request = new AbortController();

    async function loadSession() {
      try {
        const response = await apiFetch("/api/session", { signal: request.signal });
        let result: Session | null;
        if (response.status === 401 || response.status === 403) {
          result = null;
        } else {
          if (!response.ok) throw new Error(`The session service returned ${response.status}.`);
          // SAFETY: /api/session is produced by the matching server-side Session contract.
          result = (await response.json()) as Session;
        }
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

  if (sessionError)
    return (
      <SessionError
        message={sessionError}
        onRetry={() => {
          setSessionError(null);
          setSession(undefined);
          setSessionRequest((request) => request + 1);
        }}
      />
    );
  if (session === undefined)
    return (
      <main className="login-shell">
        <FloatingDecorations />
        <p className="loading-bunny" role="status">
          <AssetIcon name="bunny-face" />
          <small>Hopping in...</small>
        </p>
        <VersionBadge />
      </main>
    );
  if (session === null) return <Login />;

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

  const canManageStream =
    session.user.admin || session.user.permissions?.includes("stream.manage") === true;
  const canChatChloe =
    session.user.admin || session.user.permissions?.includes("chloe.chat") === true;
  const page =
    path === "/stream" ? (
      <WatchRoom {...session} currentUser={session.user} />
    ) : path === "/admin" && canManageStream ? (
      <AdminPage />
    ) : path === "/chloe" && canChatChloe ? (
      <ChloePage />
    ) : path === "/diary" ? (
      <CinemaDiary currentUser={session.user} />
    ) : (
      <HomePage canChatChloe={canChatChloe} canManageStream={canManageStream} />
    );

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      className={`room-shell${path === "/stream" ? " stream-page" : ""}`}
    >
      <FloatingDecorations />
      <header className="room-header">
        <Link className="wordmark" to="/">
          <AssetIcon animate={false} name="bunny-face" /> bunny<span>+</span>
        </Link>
        <div className="account">
          <details className="profile-menu" ref={profileRef} name="bunny-popover">
            <summary aria-label="Open profile menu" title={session.user.name}>
              {session.user.avatar ? (
                <img src={session.user.avatar} alt="" />
              ) : (
                <span>{session.user.name[0]?.toUpperCase()}</span>
              )}
              {canManageStream && <AssetIcon className="profile-carrot" name="carrot" />}
            </summary>
            <div className="profile-popover">
              <div className="profile-identity">
                <small>{canManageStream ? "BURROW KEEPER" : "BUNNY+ MEMBER"}</small>
                <strong>{session.user.name}</strong>
              </div>
              {canManageStream && (
                <Link to="/admin">
                  <UiIcon name="wrench" /> Admin burrow
                </Link>
              )}
              <Link to="/diary">
                <UiIcon name="ticket" /> My cinema tickets
              </Link>
              <button type="button" disabled={loggingOut} onClick={() => void logout()}>
                <AssetIcon animate={false} name="bunny" />{" "}
                {loggingOut ? "Hopping out..." : "Hop out"}
              </button>
              {logoutError && (
                <p className="logout-error" role="alert">
                  {logoutError}
                </p>
              )}
            </div>
          </details>
        </div>
      </header>
      {page}
      <VersionBadge />
    </main>
  );
}

function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="login-shell">
      <FloatingDecorations />
      <section className="session-error-card" role="alert">
        <AssetIcon animate={false} name="bunny-face" />
        <h1>Could not check your session</h1>
        <p>{message} This is not a logout; your session may still be active.</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </section>
      <VersionBadge />
    </main>
  );
}

function AdminPouch({ locked = false }: { locked?: boolean }) {
  return (
    <>
      <span className="pouch-zipper" aria-hidden="true" />
      <span className="pouch-charm" aria-hidden="true">
        <UiIcon name={locked ? "lock" : "wrench"} />
      </span>
      <span className="pouch-bow" aria-hidden="true" />
      <div className="pouch-label">
        <h2>admin burrow</h2>
        <p>{locked ? "staff only" : "stream & tickets"}</p>
      </div>
    </>
  );
}

function HomePage({
  canChatChloe,
  canManageStream,
}: {
  canChatChloe: boolean;
  canManageStream: boolean;
}) {
  return (
    <section className="activity-home">
      <div className="burrow-title">
        <h1>pick a tunnel</h1>
        <UiIcon name="paw" />
      </div>
      <div className="burrow-map">
        <svg
          className="burrow-trail"
          viewBox="0 0 1000 500"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="trail-ribbon"
            d="M500 8 C510 48 535 63 565 100 M520 245 C455 275 365 300 250 310 M635 225 C720 220 790 250 860 285 M250 350 C315 450 440 448 550 478 M855 370 C790 450 685 450 590 478"
          />
          <path
            className="trail-stitch"
            d="M500 8 C510 48 535 63 565 100 M520 245 C455 275 365 300 250 310 M635 225 C720 220 790 250 860 285 M250 350 C315 450 440 448 550 478 M855 370 C790 450 685 450 590 478"
          />
        </svg>
        <UiIcon className="trail-charm charm-one" name="heart" />
        <UiIcon className="trail-charm charm-two" name="sparkle" />
        <UiIcon className="trail-charm charm-three" name="heart" />
        <Link className="activity-spot cinema" to="/stream">
          <span className="cinema-tape" aria-hidden="true" />
          <small>NOW SHOWING</small>
          <h2>
            carrot
            <br />
            cinema
          </h2>
          <p>
            the live room <span aria-hidden="true">↗</span>
          </p>
          <span className="ticket-stub" aria-hidden="true">
            <UiIcon className="spot-icon" name="film" />
            <i>ADMIT</i>
            <strong>ONE</strong>
            <span className="ticket-barcode" />
          </span>
        </Link>
        {canManageStream ? (
          <Link className="activity-spot admin" to="/admin">
            <AdminPouch />
          </Link>
        ) : (
          <div className="activity-spot admin locked" aria-label="Admin burrow requires permission">
            <AdminPouch locked />
          </div>
        )}
        {canChatChloe ? (
          <Link className="activity-spot chloe" to="/chloe">
            <span className="chloe-bow" aria-hidden="true" />
            <UiIcon className="chloe-sparkle sparkle-one" name="sparkle" />
            <UiIcon className="spot-icon" name="nail" />
            <UiIcon className="chloe-sparkle sparkle-two" name="sparkle" />
            <small>GIRL TALK</small>
            <h2>chat with chloe</h2>
            <p>gloss, gossip &amp; good advice</p>
          </Link>
        ) : (
          <div
            className="activity-spot chloe locked chloe-locked"
            aria-label="Chat with Chloe requires permission"
          >
            <UiIcon className="spot-icon" name="lock" />
            <small>GUEST LIST ONLY</small>
            <h2>chat with chloe</h2>
            <p>your name isn't down</p>
            <b>can't go there</b>
          </div>
        )}
        <Link className="diary-home-link" to="/diary">
          <UiIcon name="ticket" />
          <span>
            <strong>cinema diary</strong>
          </span>
          <AssetIcon animate={false} name="carrot" />
        </Link>
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
        <div className="chloe-phone-top">
          <span>✦ CHLOE ONLINE ✦</span>
          <UiIcon name="nail" />
        </div>
        <div className="chloe-chat-preview">
          <span className="chloe-avatar">
            <UiIcon name="heart" />
          </span>
          <div>
            <strong>chloe</strong>
            <p>gimme a sec babe, doing my nails...</p>
          </div>
        </div>
        <p className="chloe-coming-soon">chat is getting a gyaru makeover. check back soon ♡</p>
        <Link to="/">back to the burrow</Link>
      </div>
    </section>
  );
}

function AdminPage() {
  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <UiIcon name="wrench" />
        <h1>Stream control</h1>
      </div>
      <StreamControl />
      <CinemaTicketAdmin />
    </section>
  );
}

function Login() {
  const { search } = useLocation();
  const error = new URLSearchParams(search).get("error");
  return (
    <main className="login-shell">
      <FloatingDecorations />
      <section className="login-content">
        <div className="login-hero">
          <AssetIcon className="hero-bunny" name="bunny-face" />
          <div>
            <h1>
              bunny<span>+</span>
            </h1>
          </div>
        </div>
        <div className="login-card">
          {error && (
            <p className="login-error">
              Could not admit that Discord account. Make sure you belong to the server.
            </p>
          )}
          <a className="primary-button" href={apiUrl("/auth/discord")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.3 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128l.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01l.373.292a.077.077 0 0 1-.006.127c-.6.35-1.225.65-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419s.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419s.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Continue with Discord
          </a>
          <p className="admission-note">only bunny+ members can hop in.</p>
        </div>
      </section>
      <VersionBadge />
    </main>
  );
}

function VersionBadge() {
  return (
    <footer
      className="version-id"
      data-version={`Static version ${__STATIC_VERSION__}`}
      aria-label={`Current static version: ${__STATIC_VERSION__}`}
      role="contentinfo"
      tabIndex={0}
    >
      <AssetIcon name="carrot" />
    </footer>
  );
}

function FloatingDecorations() {
  const decorations = [
    "bunny-face",
    "carrot",
    "blossom",
    "leafy",
    "bunny",
    "carrot",
    "blossom",
    "bunny-face",
    "carrot",
    "leafy",
    "bunny",
    "blossom",
  ] as const;
  return (
    <div className="floating-decorations" aria-hidden="true">
      {decorations.map((decoration, index) => (
        <AssetIcon animate={false} name={decoration} key={index} />
      ))}
    </div>
  );
}
