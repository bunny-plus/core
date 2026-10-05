import { useId } from "react";

import type { TicketBunny as BunnyParts } from "../shared/ticket-bunny";
import { ticketBunnyColours } from "./ticket-bunny-colours";

const furColours = {
  cream: { coat: "#efdfc9", shadow: "#ccb39c" },
  biscuit: { coat: "#d5b093", shadow: "#b58a72" },
  cocoa: { coat: "#b18d83", shadow: "#936b66" },
  smoke: { coat: "#c7bfd0", shadow: "#a494af" },
  ink: { coat: "#85717f", shadow: "#695566" },
  blush: { coat: "#d6b3c0", shadow: "#bb8da2" },
};
const ink = "#795968";
const edging = "#fff9f3";

function BunnyEars({ parts }: { parts: BunnyParts }) {
  const fur = furColours[parts.fur];
  return (
    <g data-part={`ears-${parts.ears}`} fill={fur.coat} stroke={edging} strokeWidth="2.2">
      {parts.ears === "lop" ? (
        <>
          <path d="M30 44C17 39 7 54 9 69c1 11 8 13 12 3l10-21Zm36 0c13-5 23 10 21 25-1 11-8 13-12 3L65 51Z" />
          <path
            d="M23 49c-7 3-10 14-8 22m58-22c7 3 10 14 8 22"
            fill="none"
            stroke="#f1cad8"
            strokeWidth="4"
          />
        </>
      ) : parts.ears === "short" ? (
        <>
          <path d="M30 47c-9-17-9-29-3-30s12 13 14 27Zm25-3c2-14 8-28 14-27s6 13-3 30Z" />
          <path d="m28 24 7 18m33-18-7 18" fill="none" stroke="#f1cad8" strokeWidth="4" />
        </>
      ) : (
        <>
          <path d="M32 48C17 21 21 1 28 7c7 7 10 27 12 38Z" />
          <path d="M27 14c-1 8 4 22 8 29" fill="none" stroke="#f1cad8" strokeWidth="4" />
          {parts.ears === "floppy" ? (
            <>
              <path d="M55 45c0-20 7-36 17-28 9 7 14 26 7 29-6 3-10-16-13-19l-4 21Z" />
              <path
                d="M61 40c1-10 2-19 7-18s9 13 10 17"
                fill="none"
                stroke="#f1cad8"
                strokeWidth="3.5"
              />
            </>
          ) : (
            <>
              <path d="M55 45C54 25 60 2 67 6c10 6 0 31-6 43Z" />
              <path d="M65 13c0 9-5 23-7 29" fill="none" stroke="#f1cad8" strokeWidth="4" />
            </>
          )}
        </>
      )}
    </g>
  );
}

function BunnyFace({ face, dark }: { face: BunnyParts["face"]; dark: boolean }) {
  const faceInk = dark ? "#fff0e7" : ink;
  return (
    <g data-part={`face-${face}`} fill={faceInk}>
      <g fill="#cb8ba3" opacity={face === "tough" ? ".35" : ".75"}>
        <ellipse cx="29" cy="68" rx="5.5" ry="2.8" />
        <ellipse cx="67" cy="68" rx="5.5" ry="2.8" />
      </g>
      {face === "tough" ? (
        <g fill="none" stroke={faceInk} strokeWidth="2" strokeLinecap="round">
          <path d="m32 57 8 1m16 0 8-1m-28 5h2m21 0h2" />
          <path d="m31 72 1 2m4 1 1 2m5 0v2m7-2v2m6-3v2m6-5-1 2" strokeWidth="1" opacity=".65" />
        </g>
      ) : face === "dreamy" ? (
        <path
          d="M32 61q4 5 8 0m16 0q4 5 8 0"
          fill="none"
          stroke={faceInk}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <>
          <ellipse cx="36" cy="62" rx="1.8" ry="2.8" />
          <circle cx="35.5" cy="61" r=".65" fill={dark ? ink : edging} />
          {face === "wink" ? (
            <path
              d="m57 60 5 2-5 2"
              fill="none"
              stroke={faceInk}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              <ellipse cx="60" cy="62" rx="1.8" ry="2.8" />
              <circle cx="59.5" cy="61" r=".65" fill={dark ? ink : edging} />
            </>
          )}
        </>
      )}
      <path d="M45 67q0-2 3-1 3-1 3 1l-3 3Z" />
      <path
        d="M48 69v3m0 0c-3 4-6 2-6 0m6 0c3 4 6 2 6 0"
        fill="none"
        stroke={faceInk}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  );
}

function BunnyOutfit({ parts, patternId }: { parts: BunnyParts; patternId: string }) {
  const colours = ticketBunnyColours[parts.palette];
  const fur = furColours[parts.fur];
  return (
    <g data-part={`outfit-${parts.outfit}`} stroke={edging} strokeWidth="2" strokeLinejoin="round">
      {parts.outfit === "action" ? (
        <>
          <path d="M32 74c-13 1-18 12-18 24h68c0-12-5-23-18-24Z" fill="#56505b" />
          <path
            d="M37 78q11 10 22 0m-33 7-2 10m46-10 2 10"
            fill="none"
            stroke="#8d7e8c"
            strokeWidth="1.4"
          />
          <path
            d="M17 91c-5-11 0-19 6-15 3-5 9-2 9 3 7 1 9 14 4 19H17Zm62 0c5-11 0-19-6-15-3-5-9-2-9 3-7 1-9 14-4 19h19Z"
            fill={fur.coat}
          />
          <path
            d="m22 82 1 7m5-7 1 7m40-7-1 7m6-7-1 7"
            fill="none"
            stroke={fur.shadow}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M35 74c-8 6-12 14-11 24h48c1-10-3-18-11-24Z"
            fill={parts.outfit === "leopard" ? `url(#${patternId})` : colours.accent}
          />
          {parts.outfit === "sailor" ? (
            <>
              <path d="m34 76-4 6 18 12 18-12-4-6-14 9Z" fill={colours.light} strokeWidth="1.5" />
              <path d="m44 91-7-2 1 8 9-4 10 4 1-8-8 2" fill={colours.paper} strokeWidth="1.2" />
              <circle cx="48" cy="92" r="2.5" fill={colours.accent} stroke="none" />
            </>
          ) : (
            <>
              <path
                d="M31 83q3 6 6 3 3 6 6 3 5 6 10 0 3 3 6-3 3 3 6-3"
                fill="none"
                stroke={colours.light}
                strokeWidth="2.5"
              />
              <g fill={edging} stroke="#d8bdc5" strokeWidth=".5">
                <circle cx="37" cy="80" r="2" />
                <circle cx="42" cy="82" r="2" />
                <circle cx="48" cy="83" r="2" />
                <circle cx="54" cy="82" r="2" />
                <circle cx="59" cy="80" r="2" />
              </g>
            </>
          )}
          <path
            d="M27 85c-7 1-8 13-3 14 5 2 10-4 9-8-1-5-3-7-6-6Zm42 0c7 1 8 13 3 14-5 2-10-4-9-8 1-5 3-7 6-6Z"
            fill={fur.coat}
          />
          <path d="m26 93 1 3m43-3-1 3" stroke={fur.shadow} strokeWidth="1" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

function BunnyAccessory({ parts, patternId }: { parts: BunnyParts; patternId: string }) {
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
      {parts.accessory === "hoops" && (
        <g fill="none" stroke="#dfbb86" strokeWidth="3">
          <ellipse cx="22" cy="75" rx="4" ry="7" />
          <ellipse cx="74" cy="75" rx="4" ry="7" />
          <path d="M20 71q-2 4 0 7m52-7q-2 4 0 7" stroke="#fff0ce" strokeWidth="1" />
        </g>
      )}
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
          <path d="M0 21c-7-5-8 5-2 6l3-1" fill={furColours[parts.fur].coat} />
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
    </g>
  );
}

/** The illustrated style renders the same saved traits, including existing version 1 tickets. */
export function TicketBunny({ parts }: { parts: BunnyParts }) {
  const patternId = useId();
  const colours = ticketBunnyColours[parts.palette];
  const fur = furColours[parts.fur];
  return (
    <svg className="ticket-bunny" viewBox="0 0 96 104" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={patternId} width="13" height="12" patternUnits="userSpaceOnUse">
          <rect width="13" height="12" fill="#e2c3a0" />
          <path
            d="M3 2Q0 3 2 7l4 1 3-3-2-3Zm7 7 2 1-1 2-2-1Z"
            fill="#b88975"
            stroke="#80616b"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </pattern>
      </defs>
      <g data-part={`palette-${parts.palette}`}>
        <rect width="96" height="104" fill={colours.paper} />
        <ellipse cx="48" cy="59" rx="41" ry="39" fill={colours.light} />
        <ellipse
          cx="48"
          cy="59"
          rx="43"
          ry="41"
          fill="none"
          stroke={colours.accent}
          strokeWidth=".65"
          strokeDasharray="1 3"
          opacity=".35"
        />
        <path
          d="m14 28 1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8Zm68 47 1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4Z"
          fill={edging}
        />
        <path d="M80 18c-5-6-10 1 0 7 10-6 5-13 0-7Z" fill={colours.accent} opacity=".55" />
      </g>
      <BunnyEars parts={parts} />
      <BunnyOutfit parts={parts} patternId={patternId} />
      <g data-part={`fur-${parts.fur}`}>
        <path
          d="M48 41C31 40 20 48 19 61c-2 14 12 21 29 21s31-7 29-21C76 48 65 40 48 41Z"
          fill={fur.coat}
          stroke={edging}
          strokeWidth="2.2"
        />
        <path
          d="M24 69q4 10 20 10"
          fill="none"
          stroke={fur.shadow}
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity=".45"
        />
        {parts.face === "tough" && (
          <path d="M30 47c3-11 33-11 36 0l-6-1-4-4-5 3-7-3-7 4Z" fill="#65515b" />
        )}
      </g>
      <BunnyFace face={parts.face} dark={parts.fur === "ink"} />
      <BunnyAccessory parts={parts} patternId={patternId} />
    </svg>
  );
}
