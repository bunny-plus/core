export const ticketWatchSeconds = 10 * 60;
export const cinemaImageMaxBytes = 2 * 1024 * 1024;

export type CinemaTicketDesign = {
  title: string;
  imagePath: string | null;
  createdAt: string;
};

export type CinemaTicketCreation = {
  screeningId: string;
  title: string;
  image?: { mimeType: string; data: string };
};

export type CinemaScreening = {
  id: string;
  title: string;
  startedAt: string;
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
