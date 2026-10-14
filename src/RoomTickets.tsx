import { Link } from "react-router";
import type { CinemaProgress, CinemaTicket } from "../shared/cinema";
import { UiIcon } from "./Icons";
import { CinemaTicketCard } from "./CinemaDiary";
import { formatTime } from "./playback";

export default function RoomTickets({
  showProgress,
  progress,
  earnedTicket,
  onDismiss,
}: {
  showProgress: boolean;
  progress: CinemaProgress | null;
  earnedTicket: CinemaTicket | null;
  onDismiss: () => void;
}) {
  return (
    <>
      {showProgress &&
        progress?.screening?.ticketCountingEnabled &&
        (progress.screening.ticketDesign || progress.ticket) && (
          <div className="cinema-ticket-progress">
            <div className="cinema-ticket-stub">
              <span className="cinema-ticket-stamp">
                <UiIcon name="ticket" />
              </span>
              <div className="cinema-ticket-copy">
                <strong className="cinema-ticket-progress-title">
                  {progress.screening.ticketDesign?.title || progress.ticket?.title}
                </strong>
                <span>
                  {progress.ticket
                    ? "Ticket collected"
                    : `${formatTime(progress.watchedSeconds)} / ${formatTime(progress.requiredSeconds)} watched`}
                </span>
                {!progress.ticket && (
                  <progress
                    aria-label="Watch time toward your cinema ticket"
                    max={progress.requiredSeconds}
                    value={progress.watchedSeconds}
                  />
                )}
              </div>
            </div>
            <Link to="/diary">My tickets ↗</Link>
          </div>
        )}
      {earnedTicket && (
        <aside className="cinema-ticket-award" aria-label="New cinema ticket">
          <div className="cinema-ticket-award-heading">
            <p className="sr-only" role="status">
              Added to your tickets
            </p>
            <button type="button" aria-label="Dismiss ticket" onClick={onDismiss}>
              ×
            </button>
          </div>
          <CinemaTicketCard ticket={earnedTicket} compact />
          <Link to="/diary">My tickets ↗</Link>
        </aside>
      )}
    </>
  );
}
