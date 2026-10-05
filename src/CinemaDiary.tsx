import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { CinemaCollection, CinemaScreening, CinemaTicket } from "../shared/cinema";
import type { TicketBunny as BunnyParts } from "../shared/ticket-bunny";
import { apiJson, apiUrl } from "./api";
import { AssetIcon, UiIcon } from "./Icons";
import { TicketBunny } from "./TicketBunny";

const ticketColors = ["rose", "apricot", "sage", "lilac"];

function screeningColor(screeningId: string) {
  let hash = 0;
  for (const character of screeningId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ticketColors[hash % ticketColors.length];
}

function screeningDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function screeningTime(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function CinemaTicketCard({
  ticket,
  compact = false,
}: {
  ticket: CinemaTicket;
  compact?: boolean;
}) {
  return (
    <CinemaTicketPaper
      screeningId={ticket.screeningId}
      title={ticket.title}
      screenedAt={ticket.screenedAt}
      imageSrc={ticket.imagePath ? apiUrl(ticket.imagePath) : null}
      bunny={ticket.bunny}
      earnedAt={ticket.earnedAt}
      number={ticket.number}
      compact={compact}
    />
  );
}

export function CinemaTicketPreview({
  screening,
  title,
  imageSrc,
  bunny,
  created = false,
}: {
  screening: CinemaScreening;
  title: string;
  imageSrc: string | null;
  bunny?: BunnyParts;
  created?: boolean;
}) {
  return (
    <CinemaTicketPaper
      screeningId={screening.id}
      title={title || "Ticket title"}
      screenedAt={screening.startedAt}
      imageSrc={imageSrc}
      bunny={bunny}
      previewLabel={created ? "10 minutes to collect" : "Ticket preview"}
    />
  );
}

function TicketArtwork({ source }: { source: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <div className="cinema-ticket-artwork">
      {unavailable ? (
        <div className="cinema-ticket-artwork-fallback">
          <UiIcon name="film" />
          <span>Artwork unavailable</span>
        </div>
      ) : (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setUnavailable(true)}
        />
      )}
    </div>
  );
}

function CinemaTicketPaper({
  screeningId,
  title,
  screenedAt,
  imageSrc,
  bunny,
  earnedAt,
  number,
  compact = false,
  previewLabel,
}: {
  screeningId: string;
  title: string;
  screenedAt: string;
  imageSrc: string | null;
  bunny?: BunnyParts;
  earnedAt?: string;
  number?: number;
  compact?: boolean;
  previewLabel?: string;
}) {
  return (
    <article
      className={`cinema-ticket cinema-ticket--${bunny?.palette ?? screeningColor(screeningId)}${compact ? " cinema-ticket--compact" : ""}${imageSrc || bunny ? " cinema-ticket--with-artwork" : ""}${bunny ? " cinema-ticket--with-bunny" : ""}`}
      aria-label={
        number === undefined ? `Ticket preview: ${title}` : `${title}, ticket number ${number}`
      }
    >
      <div className="cinema-ticket-main">
        {bunny ? (
          <div className="cinema-ticket-artwork cinema-ticket-bunny-artwork">
            <TicketBunny parts={bunny} />
          </div>
        ) : imageSrc ? (
          <TicketArtwork key={imageSrc} source={imageSrc} />
        ) : null}
        <div className="cinema-ticket-brand">
          <UiIcon name="film" />
          <span>CARROT CINEMA</span>
          <UiIcon className="cinema-ticket-sparkle" name="sparkle" />
        </div>
        <h3 title={title}>{title}</h3>
        <div className="cinema-ticket-screening">
          <span>SCREENING</span>
          <time dateTime={screenedAt}>
            {screeningDate(screenedAt)}
            <span className="cinema-ticket-time">{screeningTime(screenedAt)}</span>
          </time>
        </div>
        <div className="cinema-ticket-earned">
          <UiIcon name="heart" />
          <span>
            {earnedAt ? (
              <>
                <time className="sr-only" dateTime={earnedAt}>
                  Collected {screeningDate(earnedAt)}
                </time>
              </>
            ) : (
              previewLabel
            )}
          </span>
        </div>
      </div>
      <div className="cinema-ticket-stub">
        <div className="cinema-ticket-stub-mark" aria-hidden="true">
          <AssetIcon animate={false} name="bunny-face" />
          <span className="cinema-ticket-admit">
            ADMIT
            <br />
            ONE
          </span>
        </div>
        <div className="cinema-ticket-stub-code">
          <span className="cinema-ticket-barcode" aria-hidden="true" />
          <span className="cinema-ticket-number">
            <span className="sr-only">Ticket number </span>
            <span aria-hidden="true">Nº </span>
            {number === undefined ? "—" : String(number).padStart(5, "0")}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function CinemaDiary({ currentUser }: { currentUser: { name: string } }) {
  const [collection, setCollection] = useState<CinemaCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState(0);

  useEffect(() => {
    const request = new AbortController();

    async function loadTickets() {
      try {
        const result = await apiJson<CinemaCollection>("/api/cinema/tickets", {
          signal: request.signal,
        });
        if (!request.signal.aborted) setCollection(result);
      } catch (loadError) {
        if (request.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load tickets.");
      }
    }

    void loadTickets();
    return () => request.abort();
  }, [currentUser.name, requestNumber]);

  const tickets = collection?.tickets ?? [];
  const limitedCollection = collection !== null && collection.total > collection.tickets.length;

  return (
    <section className="cinema-diary" aria-labelledby="cinema-diary-title">
      <nav className="cinema-diary-navigation" aria-label="Cinema diary navigation">
        <Link to="/">← Back</Link>
      </nav>
      <header className="cinema-diary-heading">
        <div className="cinema-diary-intro">
          <h1 id="cinema-diary-title">
            cinema diary
            <UiIcon name="heart" />
          </h1>
        </div>
        <div className="cinema-diary-count" aria-live="polite">
          <AssetIcon className="diary-count-bunny" animate={false} name="bunny-face" />
          <UiIcon name="film" />
          <strong>{collection ? collection.total.toLocaleString() : "—"}</strong>
          <span>{collection?.total === 1 ? "ticket" : "tickets"}</span>
        </div>
      </header>
      {error ? (
        <div className="cinema-diary-state" role="alert">
          <AssetIcon animate={false} name="bunny-face" />
          <h2>Could not load tickets</h2>
          <p>{error}</p>
          <button
            className="cinema-diary-button"
            type="button"
            onClick={() => {
              setError(null);
              setCollection(null);
              setRequestNumber((number) => number + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : collection === null ? (
        <div className="cinema-diary-state cinema-diary-loading" role="status">
          <AssetIcon name="bunny-face" />
          <p>Loading tickets…</p>
        </div>
      ) : collection.total === 0 ? (
        <div className="cinema-diary-state cinema-diary-empty">
          <div className="cinema-diary-empty-pocket" aria-hidden="true">
            <AssetIcon animate={false} name="bunny-face" />
            <UiIcon name="heart" />
          </div>
          <h2>No tickets yet</h2>
          <p>Watch a screening with a ticket for 10 minutes to collect it.</p>
          <Link className="cinema-diary-button" to="/stream">
            <UiIcon name="film" /> Watch
          </Link>
        </div>
      ) : (
        <>
          {limitedCollection && (
            <p className="cinema-diary-limit">
              Latest {collection.tickets.length.toLocaleString()} of{" "}
              {collection.total.toLocaleString()} tickets
            </p>
          )}
          <ul className="cinema-diary-tickets" aria-label="Your collected cinema tickets">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <CinemaTicketCard ticket={ticket} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
