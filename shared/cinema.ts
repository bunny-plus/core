import type { TicketBunny } from "./ticket-bunny";

export const ticketWatchSeconds = 10 * 60;
// D1 rows are limited to 2,000,000 bytes; leave space for the title and metadata.
export const cinemaImageMaxBytes = 1_900_000;

export type CinemaTicketDesign = {
  title: string;
  imagePath: string | null;
  createdAt: string;
  bunny?: TicketBunny;
};

export type CinemaTicketCreation = {
  screeningId: string;
  title: string;
  image?: { mimeType: string; data: string };
  bunny?: TicketBunny;
};

export type CinemaScreening = {
  id: string;
  title: string;
  startedAt: string;
  ticketCountingEnabled: boolean;
  ticketDesign: CinemaTicketDesign | null;
};

export type CinemaTicket = {
  id: string;
  screeningId: string;
  title: string;
  screenedAt: string;
  earnedAt: string;
  number: number;
  imagePath: string | null;
  bunny?: TicketBunny;
};

export type CinemaProgress = {
  screening: CinemaScreening | null;
  watchedSeconds: number;
  requiredSeconds: number;
  ticket: CinemaTicket | null;
};

export type CinemaCollection = {
  tickets: CinemaTicket[];
  total: number;
};
