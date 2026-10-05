import type { TicketBunny as BunnyParts } from "../shared/ticket-bunny";
import { ticketBunnyColours } from "./ticket-bunny-colours";
import { BunnyEarJewellery } from "./BunnyEarJewellery";
import { ExtraBunnyAccessory } from "./ExtraBunnyAccessory";

const edging = "#fff9f3";

export function TicketBunnyAccessories({
  parts,
  patternId,
  coat,
}: {
  parts: BunnyParts;
  patternId: string;
  coat: string;
}) {
  const colours = ticketBunnyColours[parts.palette];
  return (
    <g
      data-part={`accessory-${parts.accessory}`}
      stroke={edging}
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {(parts.accessory === "bow" || parts.accessory === "leopardbow") && (
        <g transform="translate(69 45) rotate(-8)">
          <path
            d="M-2 0c-12-16-24-8-16 1 3 4 9 2 14 1l-6 15 9-4 2-11 10 13 7-5L5 1c17-1 19-13 12-15C10-16 4-5 1-1Z"
            fill={parts.accessory === "leopardbow" ? `url(#${patternId})` : colours.accent}
          />
          <path d="m-14-5 11 6m7-1 10-9" fill="none" stroke={colours.light} strokeWidth="1.2" />
          <ellipse cx="0" cy="1" rx="4.5" ry="4" fill={colours.accent} />
        </g>
      )}
      {parts.accessory === "flower" && (
        <g transform="translate(71 45)">
          {[0, 72, 144, 216, 288].map((rotation) => (
            <path
              key={rotation}
              transform={`rotate(${rotation})`}
              d="M0 1C-6-2-10-10-5-13c2-1 4 0 5 2 1-2 3-3 5-2 5 3 1 11-5 14Z"
              fill={colours.light}
              strokeWidth="1"
            />
          ))}
          <circle r="3.5" fill={colours.accent} stroke="none" />
          <path d="M0 0q6 3 8 9" fill="none" stroke="#d5b17e" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="1.8" fill="#e1bd88" stroke="none" />
          <circle cx="9" cy="10" r="1.8" fill="#e1bd88" stroke="none" />
        </g>
      )}
      {parts.accessory === "tiara" && (
        <g fill="#dfbb86">
          <path d="m33 44-2-14 10 7 7-14 7 14 10-7-2 14q-15 5-30 0Z" />
          <path d="M35 42q13 4 26 0" fill="none" stroke="#fff0ce" strokeWidth="1" />
          <path d="m48 31 3 5-3 4-3-4Z" fill={colours.accent} strokeWidth="1" />
          <circle cx="31" cy="29" r="2" />
          <circle cx="48" cy="22" r="2" />
          <circle cx="65" cy="29" r="2" />
        </g>
      )}
      {parts.accessory === "headphones" && (
        <g fill={colours.accent}>
          <path d="M21 62C15 28 81 28 75 62" fill="none" strokeWidth="6" />
          <path
            d="M21 62C15 28 81 28 75 62"
            fill="none"
            stroke={colours.accent}
            strokeWidth="3.5"
          />
          <rect x="17" y="57" width="10" height="17" rx="5" />
          <rect x="69" y="57" width="10" height="17" rx="5" />
          <path d="M21 61v8m54-8v8" fill="none" stroke={colours.light} strokeWidth="1.3" />
        </g>
      )}
      {parts.accessory === "heartshades" && (
        <g>
          <path
            d="M46 60q2-2 4 0m-24-3-5-1m49 1 5-1"
            fill="none"
            stroke={colours.accent}
            strokeWidth="2"
          />
          <path
            d="M36 56c-9-10-21 2 0 14 21-12 9-24 0-14Zm24 0c-9-10-21 2 0 14 21-12 9-24 0-14Z"
            fill="#786073"
            stroke={colours.accent}
            strokeWidth="2.5"
          />
          <path d="m30 58 4 3m20-3 4 3" stroke={colours.light} strokeWidth="1.5" />
        </g>
      )}
      {parts.accessory === "hoops" && <BunnyEarJewellery ears={parts.ears} kind="hoops" />}
      {parts.accessory === "flipphone" && (
        <g transform="translate(72 72) rotate(7)">
          <rect x="0" y="-2" width="14" height="15" rx="2.5" fill={colours.accent} />
          <rect x="0" y="14" width="14" height="16" rx="2.5" fill={colours.accent} />
          <rect x="2.5" y=".5" width="9" height="9" rx="1" fill={colours.light} stroke="none" />
          <path d="M7 3c-4-4-7 1 0 5 7-4 4-9 0-5Z" fill="#cd86a0" stroke="none" />
          <path
            d="M4 18h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"
            stroke={colours.light}
            strokeWidth="2"
          />
          <path d="M14 3q6 0 5 6v7" fill="none" stroke="#d5b17e" strokeWidth="1" />
          <path
            d="M19 17c-4-5-7 1 0 5 7-4 4-10 0-5Z"
            fill={colours.light}
            stroke="#d5b17e"
            strokeWidth="1"
          />
          <path d="M0 21c-7-5-8 5-2 6l3-1" fill={coat} />
        </g>
      )}
      {parts.accessory === "chain" && (
        <g>
          <path d="M33 77q15 23 30 0" fill="none" stroke="#a6875d" strokeWidth="3.5" />
          <path
            d="M33 77q15 23 30 0"
            fill="none"
            stroke="#edcc92"
            strokeWidth="2"
            strokeDasharray="2 2"
          />
          <rect
            x="44.5"
            y="87"
            width="7"
            height="9"
            rx="2"
            fill="#dfbb86"
            stroke="#a6875d"
            strokeWidth="1"
          />
          <path d="M47 90v3" stroke="#fff0ce" />
        </g>
      )}
      <ExtraBunnyAccessory parts={parts} patternId={patternId} coat={coat} />
    </g>
  );
}
