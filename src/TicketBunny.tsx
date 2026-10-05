import { useId } from "react";

import type { TicketBunny as BunnyParts } from "../shared/ticket-bunny";
import { ticketBunnyColours } from "./ticket-bunny-colours";

const furColours = {
  cream: { coat: "#fff4df", shadow: "#debea5" },
  biscuit: { coat: "#dbaa7c", shadow: "#b77e5c" },
  cocoa: { coat: "#a07869", shadow: "#785347" },
  smoke: { coat: "#c3bfd0", shadow: "#93879f" },
  ink: { coat: "#685565", shadow: "#493b4b" },
};
const ink = "#503749";

function BunnyEars({ parts }: { parts: BunnyParts }) {
  const fur = furColours[parts.fur];
  return (
    <g data-part={`ears-${parts.ears}`} fill={fur.coat} stroke={ink} strokeWidth="2">
      {parts.ears === "lop" ? (
        <>
          <path d="M31 41H19v4h-5v9h-2v12h3v8h9v-5h4V55h5Zm34 0h12v4h5v9h2v12h-3v8h-9v-5h-4V55h-5Z" />
          <path
            d="M23 48h-4v7h-2v13h4v-7h2Zm50 0h4v7h2v13h-4v-7h-2Z"
            fill="#df97aa"
            stroke="none"
          />
        </>
      ) : parts.ears === "short" ? (
        <>
          <path d="M29 41V22h3v-6h8v5h3v20Zm24 0V21h3v-5h8v6h3v19Z" />
          <path d="M34 24h4v14h-4m24-14h4v14h-4" fill="#df97aa" stroke="none" />
        </>
      ) : (
        <>
          <path d="M30 43V31h-3V18h-2V9h3V5h7v5h3v13h3v19Z" />
          <path d="M30 12h4v13h3v12h-4V26h-3Z" fill="#df97aa" stroke="none" />
          {parts.ears === "floppy" ? (
            <>
              <path d="M55 42V24h3V13h3V9h10v4h5v5h3v11h-3v4h-8v-4h-4v13Z" />
              <path d="M61 37V24h3V15h5v4h4v9h-4v-7h-3v17Z" fill="#df97aa" stroke="none" />
            </>
          ) : (
            <>
              <path d="M55 42V23h3V10h3V5h7v4h3v9h-2v13h-3v12Z" />
              <path d="M62 12h4v14h-3v11h-4V25h3Z" fill="#df97aa" stroke="none" />
            </>
          )}
        </>
      )}
    </g>
  );
}

function BunnyFace({ face }: { face: BunnyParts["face"] }) {
  return (
    <g data-part={`face-${face}`} fill={ink}>
      {face === "tough" ? (
        <>
          <path d="M29 46h10v2h3v3h-7v-2h-6m25 2v-3h3v-2h10v3h-6v2Z" />
          <path d="M34 54h6v3h-6m21-3h6v3h-6M43 61h8v3h-8m-6 6h4v-2h12v2h4v2h-6v-1h-8v1h-6Z" />
          <path
            d="M30 63h3v4h3v4h4v3h15v-3h5v-4h3v-4h3v9h-4v4H34v-4h-4Z"
            fill="#73534d"
            opacity=".65"
          />
          <path d="M34 68h1v2h-1m3 3h1v2h-1m5 1h1v2h-1m6-1h1v2h-1m6-3h1v2h-1m5-4h1v2h-1" />
        </>
      ) : (
        <>
          <path d="M28 48h2v3h4v2h-5v-2h-3v-3m39 0h2v3h3v2h-7v-2h2Z" />
          {face === "dreamy" ? (
            <path d="M31 53h3v3h6v-3h3v4h-3v2h-6v-2h-3m22-4h3v3h6v-3h3v4h-3v2h-6v-2h-3Z" />
          ) : (
            <>
              <path d="M33 50h7v2h2v9h-2v2h-7v-2h-2v-9h2Z" />
              <path d="M33 52h4v4h-4" fill="#fffdf5" />
              <path d="M38 59h2v2h-2" fill="#dbb0ce" />
              {face === "wink" ? (
                <path d="M55 52h3v2h4v2h3v2h-4v2h-6v-2h5v-2h-5Z" />
              ) : (
                <>
                  <path d="M56 50h7v2h2v9h-2v2h-7v-2h-2v-9h2Z" />
                  <path d="M56 52h4v4h-4" fill="#fffdf5" />
                  <path d="M61 59h2v2h-2" fill="#dbb0ce" />
                </>
              )}
            </>
          )}
          <path d="M26 63h10v4H26m34-4h10v4H60" fill="#dc83a2" opacity=".7" />
          <path d="M44 62h3v1h2v-1h3v3h-2v2h-4v-2h-2Z" fill="#cd7995" />
          <path d="M47 67h2v3h3v-2h2v3h-5v-1h-2v1h-5v-3h2v2h3Z" />
          <path d="M25 59h3v1h-3m-2 4h2v1h-2m46-5h3v1h-3m2 4h2v1h-2" fill="#b78894" />
        </>
      )}
    </g>
  );
}

function BunnyOutfit({ parts, patternId }: { parts: BunnyParts; patternId: string }) {
  const colours = ticketBunnyColours[parts.palette];
  const fur = furColours[parts.fur];
  return (
    <g data-part={`outfit-${parts.outfit}`} stroke={ink} strokeWidth="2">
      {parts.outfit === "action" ? (
        <>
          <path d="M19 95V84h4v-7h10v-4h30v4h10v7h4v11Z" fill="#363342" />
          <path
            d="M39 76h18v4H39m-8 1h-5v10m44-10h-5v10"
            fill="none"
            stroke="#625968"
            strokeWidth="2"
          />
          <path d="M15 94V84h3v-6h9v3h5v13Zm49 0V81h5v-3h9v6h3v10Z" fill={fur.coat} />
          <path
            d="M18 85h3v5h-3m5-7h3v7h-3m45-7h3v7h-3m5-5h3v5h-3"
            stroke="none"
            fill={fur.shadow}
          />
        </>
      ) : (
        <>
          <path
            d="M29 95V84h4v-7h9v-3h12v3h9v7h4v11Z"
            fill={parts.outfit === "leopard" ? `url(#${patternId})` : colours.accent}
          />
          {parts.outfit === "sailor" ? (
            <>
              <path d="m38 76-6 5 16 10 16-10-6-5-10 7Z" fill={colours.light} />
              <path d="M46 88h4v4h-4m-1-1h-5v5h5m6-5h5v5h-5" fill={colours.paper} strokeWidth="1" />
            </>
          ) : (
            <>
              <path d="M35 81h4v3h18v-3h4v5h-4v3H39v-3h-4Z" fill={colours.light} stroke="none" />
              <path
                d="M38 77h3v3h-3m5 1h3v3h-3m6-3h3v3h-3m5-4h3v3h-3"
                fill="#fffaf0"
                stroke="#af9197"
                strokeWidth="1"
              />
              <path d="M44 85h3v2h2v-2h3v4h-2v2h-4v-2h-2Z" fill={colours.accent} stroke="none" />
            </>
          )}
          <path d="M27 95V85h3v-3h5v5h3v8Zm31 0v-8h3v-5h5v3h3v10Z" fill={fur.coat} />
          <path d="M31 88h2v5h-2m30-5h2v5h-2" fill={fur.shadow} stroke="none" />
        </>
      )}
    </g>
  );
}

function BunnyAccessory({ parts, patternId }: { parts: BunnyParts; patternId: string }) {
  const colours = ticketBunnyColours[parts.palette];
  return (
    <g data-part={`accessory-${parts.accessory}`} stroke={ink} strokeWidth="1">
      {(parts.accessory === "bow" || parts.accessory === "leopardbow") && (
        <g transform="translate(68 39)">
          <path
            d="M-3-2h-3v-3h-8V6h3v3h7v-3h8v3h7V6h3V-5H6v3H3Z"
            fill={parts.accessory === "leopardbow" ? `url(#${patternId})` : colours.accent}
            strokeWidth="2"
          />
          <path d="M-6 7h5v12l-4-3-4 1Zm7 0h5l3 10-4-1-4 3Z" fill={colours.light} />
          <path d="M-11-1h3v3h-3m19-3h3v3H8" fill={colours.light} stroke="none" />
          <path d="M-3-2h6v9h-6Z" fill={colours.paper} />
          <path d="M-1 0h2v2h-2" fill="#fffcf1" stroke="none" />
        </g>
      )}
      {parts.accessory === "flower" && (
        <g transform="translate(69 38)">
          <path d="M-3-3v-9h7v3h3v5h8v7h-3v3H6v8h-8v-3h-3V6h-8V-2h3v-3Z" fill={colours.light} />
          <path d="M-2-7h3v8h7v3H1v6h-3V4h-7V1h7Z" fill={colours.accent} stroke="none" />
          <path d="M-3-1h6v6h-6m4 0h2v3h3" fill="#dfaf5c" stroke="#93644e" />
        </g>
      )}
      {parts.accessory === "tiara" && (
        <g fill="#edc57c" stroke="#926440">
          <path d="M34 38V25h3v4h6v-5h3v-4h4v4h3v5h6v-4h3v13Z" />
          <path d="M35 34h26" />
          <path d="M46 27h4v5h-4m-9-1h2v2h-2m20-2h2v2h-2" fill={colours.accent} stroke="none" />
        </g>
      )}
      {parts.accessory === "headphones" && (
        <g>
          <path d="M23 57V43h4V33h8v-4h26v4h8v10h4v14" fill="none" stroke={ink} strokeWidth="6" />
          <path
            d="M23 54V43h4V33h8v-4h26v4h8v10h4v11"
            fill="none"
            stroke={colours.accent}
            strokeWidth="2"
          />
          <path d="M19 53h9v15h-9m49-15h9v15h-9" fill={colours.accent} strokeWidth="2" />
          <path d="M21 56h2v7h-2m49-7h2v7h-2" fill={colours.light} stroke="none" />
        </g>
      )}
      {parts.accessory === "heartshades" && (
        <g>
          <path
            d="M26 49h9v3h3v-3h9v11h-3v4h-4v3h-6v-3h-4v-4h-4Zm24 0h9v3h3v-3h9v11h-3v4h-4v3h-6v-3h-4v-4h-4Z"
            fill={colours.accent}
            strokeWidth="2"
          />
          <path
            d="M29 53h6v3h4v-3h5v6h-3v4h-6v-3h-3v-3h-3m24-4h6v3h4v-3h5v6h-3v4h-6v-3h-3v-3h-3"
            fill="#554656"
            stroke="none"
          />
          <path d="M31 54h3v4h-3m24-4h3v4h-3M46 54h5v2h-5" fill={colours.light} stroke="none" />
        </g>
      )}
      {parts.accessory === "hoops" && (
        <g fill="#edc57c" stroke="#976e48">
          <path
            d="M20 62h8v3h2v10h-2v3h-8v-3h-2V65h2Zm2 3v10h4V65Zm46-3h8v3h2v10h-2v3h-8v-3h-2V65h2Zm2 3v10h4V65Z"
            fillRule="evenodd"
          />
          <path d="M20 64h2v8h-2m48-8h2v8h-2" fill="#fff5ce" stroke="none" />
        </g>
      )}
      {parts.accessory === "flipphone" && (
        <g transform="translate(73 64)">
          <path d="M0 0h13v14H0Zm0 16h13v15H0Z" fill={colours.accent} strokeWidth="2" />
          <path d="M2 2h9v9H2" fill={colours.light} />
          <path d="M4 4h2v1h1V4h2v3H7v2H6V7H4Z" fill="#d677a0" stroke="none" />
          <path
            d="M2 19h3v2H2m5-2h3v2H7m-5 3h3v2H2m5-2h3v2H7m-5 3h3v2H2m5-2h3v2H7"
            fill={colours.light}
            stroke="none"
          />
          <path d="M13 4h5v13h-3v5h3v3h4v-7h-3" fill="none" stroke="#d3a251" />
          <path d="M-4 19h5v9h-5" fill={furColours[parts.fur].coat} />
        </g>
      )}
      {parts.accessory === "chain" && (
        <g fill="#dfb563" stroke="#8f644b">
          <path d="M34 76h3v3h3v3h5v2h6v-2h5v-3h3v-3h3v5h-3v3h-5v3H42v-3h-5v-3h-3Z" />
          <path d="M45 85h6v7h-6Z" />
          <path d="M46 86h2v4h-2m-8-8h3v1h-3m17-1h3v1h-3" fill="#fff0b7" stroke="none" />
        </g>
      )}
    </g>
  );
}

/** Original pixel SVG layers. Keep the version 1 parts stable once tickets are issued. */
export function TicketBunny({ parts }: { parts: BunnyParts }) {
  const patternId = useId();
  const colours = ticketBunnyColours[parts.palette];
  const fur = furColours[parts.fur];
  return (
    <svg className="ticket-bunny" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={patternId} width="12" height="10" patternUnits="userSpaceOnUse">
          <rect width="12" height="10" fill={colours.paper} />
          <path d="M2 1h5v2H2m-1 0h2v4H1m2 0h4v2H3m4-6h2v4H7m3 2h2v2h-2" fill={ink} />
          <path d="M3 3h4v4H3" fill={colours.accent} />
        </pattern>
      </defs>
      <g data-part={`palette-${parts.palette}`}>
        <rect width="96" height="96" fill={colours.paper} />
        <path
          d="M25 16h46v6h10v11h6v38h-6v10H71v6H25v-6H15V71H9V33h6V22h10Z"
          fill={colours.light}
        />
        <path
          d="M12 10h2v4h4v2h-4v4h-2v-4H8v-2h4m71 45h2v4h4v2h-4v4h-2v-4h-4v-2h4"
          fill="#fffdf5"
        />
        <path
          d="M80 20h4v2h2v-2h4v6h-2v2h-2v2h-2v-2h-2v-2h-2Z"
          fill={colours.accent}
          opacity=".65"
        />
        <path d="M8 73h3v3H8m74-64h2v2h-2M17 86h2v2h-2" fill={colours.accent} opacity=".55" />
      </g>
      <BunnyEars parts={parts} />
      <g data-part={`fur-${parts.fur}`} stroke={ink} strokeWidth="2">
        <path
          d="M29 45v-6h7v-4h8v-3h5v3h11v4h7v6h5v18h-4v7h-6v5H34v-5h-6v-7h-4V45Z"
          fill={fur.coat}
        />
        <path
          d="M32 53h7v-3h18v3h7v4h4v7h-5v5H33v-5h-5v-7h4Z"
          fill="#fff2de"
          stroke="none"
          opacity={parts.fur === "cream" ? ".5" : ".92"}
        />
        <path d="M30 65h3v5h6v3h18v-3h6v-5h3v6h-5v4H35v-4h-5Z" fill={fur.shadow} stroke="none" />
        {parts.face === "tough" && (
          <path
            d="M29 46V36h6v-4h27v4h5v10h-6v-7H35v7Zm6-14v-3h5v-3h15v6Z"
            fill="#49373c"
            stroke="none"
          />
        )}
      </g>
      <BunnyFace face={parts.face} />
      <BunnyOutfit parts={parts} patternId={patternId} />
      <BunnyAccessory parts={parts} patternId={patternId} />
    </svg>
  );
}
