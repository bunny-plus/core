import type { TicketBunny } from "../shared/ticket-bunny";

// Piercings sit on the ear itself. A folded ear uses its dangling tip; lop ears
// use their outer ends, beyond the cheeks. Coordinates match BunnyEars.
const earAttachments = {
  upright: [
    { x: 30, y: 29, angle: -12 },
    { x: 65, y: 28, angle: 12 },
  ],
  floppy: [
    { x: 30, y: 29, angle: -12 },
    { x: 79, y: 39, angle: 12 },
  ],
  lop: [
    { x: 14, y: 70, angle: 8 },
    { x: 82, y: 70, angle: -8 },
  ],
  short: [
    { x: 29, y: 30, angle: -12 },
    { x: 67, y: 30, angle: 12 },
  ],
} satisfies Record<TicketBunny["ears"], { x: number; y: number; angle: number }[]>;

export function BunnyEarJewellery({
  ears,
  kind,
}: {
  ears: TicketBunny["ears"];
  kind:
    | "hoops"
    | "heartdrops"
    | "stardrops"
    | "cherrydrops"
    | "pearlstuds"
    | "earcuffs"
    | "safetypins";
}) {
  return (
    <g data-ear-jewellery={kind}>
      {earAttachments[ears].map(({ x, y, angle }, index) => (
        <g
          key={index}
          data-ear-attachment={index === 0 ? "left" : "right"}
          transform={`translate(${x} ${y}) rotate(${angle})`}
        >
          {kind === "hoops" ? (
            <>
              <ellipse cy="6" rx="3.8" ry="6" fill="none" stroke="#b2915f" strokeWidth="3" />
              <ellipse cy="6" rx="3.8" ry="6" fill="none" stroke="#edcc92" strokeWidth="1.8" />
              <path d="M-2 3q-2 3 0 6" fill="none" stroke="#fff4d9" strokeWidth=".8" />
            </>
          ) : kind === "pearlstuds" ? (
            <>
              <circle r="2.8" fill="#fff4df" stroke="#c7ab92" strokeWidth="1" />
              <circle cx="-.6" cy="-.7" r=".9" fill="#fff" stroke="none" />
            </>
          ) : kind === "earcuffs" ? (
            <g fill="none" stroke="#dfbb86" strokeWidth="2">
              <path d="M-4-6q4 3 8 0M-4-2q4 3 8 0M-4 2q4 3 8 0" />
            </g>
          ) : (
            <>
              <circle r="1.5" fill="#dfbb86" stroke="#fff0da" strokeWidth=".6" />
              <path d="M0 1v4" fill="none" stroke="#b7986b" strokeWidth="1" />
              {kind === "heartdrops" && (
                <path
                  d="M0 7c-6-7-12 1 0 8 12-7 6-15 0-8Z"
                  fill="#cd86a0"
                  stroke="#fff0da"
                  strokeWidth="1"
                />
              )}
              {kind === "stardrops" && (
                <path
                  d="m0 4 2 4 4 .6-3 3 1 4-4-2-4 2 1-4-3-3 4-.6Z"
                  fill="#dfbb86"
                  stroke="#fff0da"
                  strokeWidth="1"
                />
              )}
              {kind === "cherrydrops" && (
                <>
                  <path d="m0 4-3 5m3-5 3 7" stroke="#90a080" strokeWidth="1.2" />
                  <circle cx="-3" cy="10" r="3" fill="#bd6886" stroke="#fff0da" strokeWidth=".8" />
                  <circle cx="3" cy="12" r="3" fill="#cd86a0" stroke="#fff0da" strokeWidth=".8" />
                </>
              )}
              {kind === "safetypins" && (
                <g stroke="#b6a6ba" strokeWidth="1.5" fill="none">
                  <rect x="-2.5" y="4" width="5" height="12" rx="2.5" />
                  <path d="m-1 6 2 8" />
                  <rect x="-2.5" y="12" width="5" height="4" rx="1" fill="#d1c3d4" />
                </g>
              )}
            </>
          )}
        </g>
      ))}
    </g>
  );
}
