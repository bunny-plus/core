import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  cinemaImageMaxBytes,
  type CinemaScreening,
  type CinemaTicketCreation,
} from "../shared/cinema";
import { generateTicketBunny, type TicketBunny } from "../shared/ticket-bunny";
import { apiFetch, apiJson, apiUrl } from "./api";
import { CinemaTicketPreview } from "./CinemaDiary";
import { AssetIcon, UiIcon } from "./Icons";
import TicketBunnyEditor from "./TicketBunnyEditor";

type TicketImage = {
  mimeType: string;
  data: string;
  preview: string;
  name: string;
};

type TicketDraft = {
  screeningId: string;
  title: string;
  image: TicketImage | null;
  artwork: "bunny" | "image" | "none";
  bunny: TicketBunny;
};

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (!reader.result || reader.result instanceof ArrayBuffer) {
        reject(new Error("Could not read this image. Choose it again."));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () =>
      reject(new Error("Could not read this image. Choose it again.")),
    );
    reader.readAsDataURL(file);
  });
}

export default function CinemaTicketAdmin() {
  const [screening, setScreening] = useState<CinemaScreening | null | undefined>();
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshNumber, setRefreshNumber] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const screeningId = useRef<string | null>(null);
  const imageSelection = useRef(0);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const currentRequest = useRef<AbortController | null>(null);
  const submissionRequest = useRef<AbortController | null>(null);
  const submissionPending = useRef(false);
  const active = useRef(true);
  const formId = useId();

  const applyScreening = useCallback((next: CinemaScreening | null) => {
    const nextId = next?.id ?? null;
    if (screeningId.current !== nextId) {
      screeningId.current = nextId;
      imageSelection.current += 1;
      setReadingImage(false);
      setImageError(null);
      setSubmitError(null);
      setNotice(null);
      setDraft(
        next
          ? {
              screeningId: next.id,
              title: next.title.slice(0, 200),
              image: null,
              artwork: "bunny",
              bunny: generateTicketBunny(next.id),
            }
          : null,
      );
      if (imageInput.current) imageInput.current.value = "";
    }
    setScreening(next);
    setLoadError(null);
  }, []);

  const loadCurrentScreening = useCallback(async () => {
    if (
      submissionPending.current ||
      !active.current ||
      (currentRequest.current && !currentRequest.current.signal.aborted)
    )
      return;
    currentRequest.current?.abort();
    const request = new AbortController();
    currentRequest.current = request;
    setLoadingCurrent(true);
    try {
      const result = await apiJson<{ screening: CinemaScreening | null }>("/api/cinema/screening", {
        signal: request.signal,
      });
      if (!request.signal.aborted) applyScreening(result.screening);
    } catch (error) {
      if (!request.signal.aborted) {
        setLoadError(
          error instanceof Error ? error.message : "Could not check the current screening.",
        );
      }
    } finally {
      if (currentRequest.current === request) {
        currentRequest.current = null;
        if (!request.signal.aborted) setLoadingCurrent(false);
      }
    }
  }, [applyScreening]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      submissionRequest.current?.abort();
      imageSelection.current += 1;
    };
  }, []);

  useEffect(() => {
    void loadCurrentScreening();
    const poll = window.setInterval(() => void loadCurrentScreening(), 10_000);
    return () => {
      window.clearInterval(poll);
      currentRequest.current?.abort();
      currentRequest.current = null;
    };
  }, [loadCurrentScreening, refreshNumber]);

  function removeImage() {
    imageSelection.current += 1;
    setReadingImage(false);
    setImageError(null);
    setDraft((previous) => (previous ? { ...previous, image: null } : null));
    if (imageInput.current) imageInput.current.value = "";
  }

  function chooseArtwork(artwork: TicketDraft["artwork"]) {
    imageSelection.current += 1;
    setReadingImage(false);
    setImageError(null);
    setDraft((previous) => (previous ? { ...previous, artwork } : null));
  }

  async function chooseImage(file: File | undefined) {
    if (!file || !draft || submissionPending.current) return;
    const expectedScreeningId = draft.screeningId;
    const selection = ++imageSelection.current;
    setImageError(null);
    if (!imageTypes.has(file.type)) {
      setReadingImage(false);
      setImageError("Choose a PNG, JPG or WebP image.");
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    if (file.size > cinemaImageMaxBytes) {
      setReadingImage(false);
      setImageError("Choose an image up to 2 MiB.");
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    setReadingImage(true);
    try {
      const preview = await readImageFile(file);
      const image = new Image();
      image.src = preview;
      await image.decode();
      if (imageSelection.current !== selection || !active.current) return;
      setDraft((previous) =>
        previous?.screeningId === expectedScreeningId
          ? {
              ...previous,
              image: {
                mimeType: file.type,
                data: preview.slice(preview.indexOf(",") + 1),
                preview,
                name: file.name,
              },
            }
          : previous,
      );
    } catch {
      if (imageSelection.current === selection && active.current) {
        setImageError("Could not open this image. Choose a different PNG, JPG or WebP.");
        if (imageInput.current) imageInput.current.value = "";
      }
    } finally {
      if (imageSelection.current === selection && active.current) setReadingImage(false);
    }
  }

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submissionPending.current ||
      (draft?.artwork === "image" && (readingImage || imageError)) ||
      loadingCurrent ||
      loadError ||
      !screening ||
      screening.ticketDesign ||
      !draft ||
      draft.screeningId !== screening.id ||
      !draft.title.trim()
    )
      return;
    submissionPending.current = true;
    currentRequest.current?.abort();
    const request = new AbortController();
    submissionRequest.current = request;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const creation: CinemaTicketCreation = {
        screeningId: draft.screeningId,
        title: draft.title.trim(),
      };
      if (draft.artwork === "bunny") creation.bunny = draft.bunny;
      if (draft.artwork === "image" && draft.image)
        creation.image = { mimeType: draft.image.mimeType, data: draft.image.data };
      const response = await apiFetch("/api/cinema/screening/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify(creation),
      });
      // SAFETY: This first-party endpoint returns {screening} on success or {error} on failure.
      const result = (await response.json()) as { screening: CinemaScreening; error?: string };
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "The screening changed or a ticket already exists. Check the current screening."
            : result.error || "The ticket could not be created. Please try again.",
        );
      }
      if (!request.signal.aborted && active.current) {
        applyScreening(result.screening);
        setNotice("Ticket created.");
      }
    } catch (error) {
      if (!request.signal.aborted && active.current) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "The ticket could not be created. Please try again.",
        );
      }
    } finally {
      submissionPending.current = false;
      if (!request.signal.aborted && active.current) {
        setSubmitting(false);
        void loadCurrentScreening();
      }
    }
  }

  async function toggleTicketCounting() {
    if (!screening || submissionPending.current) return;
    submissionPending.current = true;
    currentRequest.current?.abort();
    const request = new AbortController();
    submissionRequest.current = request;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    const enabled = !screening.ticketCountingEnabled;
    try {
      const result = await apiJson<{ screening: CinemaScreening }>(
        "/api/cinema/screening/counting",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: request.signal,
          body: JSON.stringify({ screeningId: screening.id, enabled }),
        },
      );
      if (!request.signal.aborted && active.current) {
        applyScreening(result.screening);
        setNotice(
          enabled
            ? "Ticket counting resumed."
            : "Ticket counting stopped. Collected tickets are kept.",
        );
      }
    } catch (error) {
      if (!request.signal.aborted && active.current)
        setSubmitError(
          error instanceof Error ? error.message : "Could not change ticket counting.",
        );
    } finally {
      submissionPending.current = false;
      if (!request.signal.aborted && active.current) {
        setSubmitting(false);
        void loadCurrentScreening();
      }
    }
  }

  const design = screening?.ticketDesign;
  const canCreate =
    !submitting &&
    !(draft?.artwork === "image" && (readingImage || imageError)) &&
    !loadingCurrent &&
    !loadError &&
    screening !== null &&
    screening !== undefined &&
    !design &&
    draft?.screeningId === screening.id &&
    Boolean(draft?.title.trim());

  return (
    <section
      className="cinema-ticket-admin"
      aria-labelledby={`${formId}-heading`}
      aria-busy={submitting}
    >
      <header className="cinema-ticket-admin-heading">
        <AssetIcon name="carrot" />
        <div>
          <h2 id={`${formId}-heading`}>Screening ticket</h2>
        </div>
      </header>

      {loadError && (
        <div className="cinema-ticket-admin-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            disabled={loadingCurrent || submitting}
            onClick={() => setRefreshNumber((number) => number + 1)}
          >
            {loadingCurrent ? "Checking…" : "Try again"}
          </button>
        </div>
      )}
      {submitError && (
        <p className="cinema-ticket-admin-error" role="alert">
          {submitError}
        </p>
      )}
      {notice && (
        <p className="cinema-ticket-admin-notice" role="status">
          {notice}
        </p>
      )}

      {screening === undefined ? (
        !loadError && (
          <p className="cinema-ticket-admin-state" role="status">
            <AssetIcon animate={false} name="bunny-face" /> Loading screening…
          </p>
        )
      ) : screening === null ? (
        <div className="cinema-ticket-admin-offline">
          <UiIcon name="film" />
          <h3>No active screening</h3>
          <p>Start a stream, then create a ticket.</p>
          <button
            className="cinema-ticket-admin-secondary"
            type="button"
            disabled={loadingCurrent}
            onClick={() => setRefreshNumber((number) => number + 1)}
          >
            {loadingCurrent ? "Checking…" : "Check for a screening"}
          </button>
        </div>
      ) : design ? (
        <div className="cinema-ticket-admin-created">
          <div className="cinema-ticket-admin-created-copy">
            <span className="cinema-ticket-admin-created-badge">
              <UiIcon name="heart" /> TICKET CREATED
            </span>
            <h3>{design.title}</h3>
            <p>
              {screening.ticketCountingEnabled
                ? "Viewers collect this ticket after 10 minutes."
                : "Counting is stopped. Collected tickets stay in viewers’ diaries."}
            </p>
            <small>Title and artwork are final.</small>
          </div>
          <div className="cinema-ticket-admin-preview">
            <CinemaTicketPreview
              screening={screening}
              title={design.title}
              imageSrc={design.imagePath ? apiUrl(design.imagePath) : null}
              bunny={design.bunny}
              created
            />
          </div>
        </div>
      ) : draft?.screeningId === screening.id ? (
        <form className="cinema-ticket-admin-form" onSubmit={(event) => void createTicket(event)}>
          <div className="cinema-ticket-admin-fields">
            <div className="cinema-ticket-admin-current">
              <span>NOW SHOWING</span>
              <strong>{screening.title}</strong>
            </div>
            <label htmlFor={`${formId}-title`}>Ticket title</label>
            <input
              id={`${formId}-title`}
              value={draft.title}
              required
              maxLength={200}
              disabled={submitting}
              onChange={(event) => {
                const title = event.target.value;
                setDraft((previous) => (previous ? { ...previous, title } : null));
              }}
            />
            <fieldset className="ticket-artwork-choice" disabled={submitting}>
              <legend>Ticket artwork</legend>
              <div>
                <button
                  type="button"
                  aria-pressed={draft.artwork === "bunny"}
                  onClick={() => chooseArtwork("bunny")}
                >
                  Bunny
                </button>
                <button
                  type="button"
                  aria-pressed={draft.artwork === "image"}
                  onClick={() => chooseArtwork("image")}
                >
                  Upload
                </button>
                <button
                  type="button"
                  aria-pressed={draft.artwork === "none"}
                  onClick={() => chooseArtwork("none")}
                >
                  None
                </button>
              </div>
            </fieldset>
            {draft.artwork === "bunny" && (
              <TicketBunnyEditor
                value={draft.bunny}
                disabled={submitting}
                onChange={(bunny) =>
                  setDraft((previous) => (previous ? { ...previous, bunny } : null))
                }
              />
            )}
            {draft.artwork === "image" && (
              <>
                <label htmlFor={`${formId}-image`}>
                  Ticket artwork <span>optional</span>
                </label>
                <p className="cinema-ticket-admin-image-help" id={`${formId}-image-help`}>
                  PNG, JPG or WebP · up to 2 MiB
                </p>
                <input
                  ref={imageInput}
                  className="cinema-ticket-admin-file"
                  id={`${formId}-image`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-describedby={`${formId}-image-help${imageError ? ` ${formId}-image-error` : ""}`}
                  disabled={submitting}
                  onChange={(event) => void chooseImage(event.target.files?.[0])}
                />
                {readingImage && (
                  <p className="cinema-ticket-admin-image-status" role="status">
                    Loading image…
                  </p>
                )}
                {imageError && (
                  <p
                    className="cinema-ticket-admin-image-error"
                    id={`${formId}-image-error`}
                    role="alert"
                  >
                    {imageError}
                  </p>
                )}
                {(draft.image || imageError || readingImage) && (
                  <div className="cinema-ticket-admin-selected-image">
                    <span>{draft.image?.name ?? "No artwork selected"}</span>
                    <button type="button" disabled={submitting} onClick={removeImage}>
                      {draft.image ? "Remove image" : "Use no artwork"}
                    </button>
                  </div>
                )}
              </>
            )}
            <p className="cinema-ticket-admin-final-note">
              Title and artwork cannot be changed after creation.
            </p>
            <button className="cinema-ticket-admin-submit" type="submit" disabled={!canCreate}>
              <UiIcon name="ticket" /> {submitting ? "Creating ticket…" : "Create screening ticket"}
            </button>
          </div>
          <div className="cinema-ticket-admin-preview">
            <span>PREVIEW</span>
            <CinemaTicketPreview
              screening={screening}
              title={draft.title.trim()}
              imageSrc={draft.artwork === "image" ? (draft.image?.preview ?? null) : null}
              bunny={draft.artwork === "bunny" ? draft.bunny : undefined}
            />
          </div>
        </form>
      ) : null}
      {screening && (
        <div className="cinema-ticket-admin-counting">
          <div>
            <strong>
              {screening.ticketCountingEnabled
                ? "Ticket counting enabled"
                : "Ticket counting stopped"}
            </strong>
            <p>
              {screening.ticketCountingEnabled
                ? "Watch time counts while a stream is live. You can stop it here without stopping the stream."
                : "Watch time is stopped. Existing progress and collected tickets are saved."}
            </p>
          </div>
          <button
            className="cinema-ticket-admin-secondary"
            type="button"
            disabled={submitting}
            onClick={() => void toggleTicketCounting()}
          >
            {submitting
              ? "Saving…"
              : screening.ticketCountingEnabled
                ? "Stop counting"
                : "Resume counting"}
          </button>
        </div>
      )}
    </section>
  );
}
