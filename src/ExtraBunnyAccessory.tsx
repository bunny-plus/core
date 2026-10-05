import type { ReactNode } from "react";
import type { TicketBunny } from "../shared/ticket-bunny";
import { ticketBunnyColours } from "./ticket-bunny-colours";
import { BunnyEarJewellery } from "./BunnyEarJewellery";

function Heart({ fill = "#cd86a0" }: { fill?: string }) {
  return <path d="M0-2c-7-9-16 2 0 11C16 0 7-11 0-2Z" fill={fill} />;
}
function Star({ fill = "#dfbb86" }: { fill?: string }) {
  return <path d="m0-8 2.5 5.5L9-2 4 2.5 5 9 0 6l-5 3 1-6.5L-9-2l6.5-.5Z" fill={fill} />;
}
function Daisy({ colour = "#fff9f3", centre = "#dfbb86" }: { colour?: string; centre?: string }) {
  return (
    <g>
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <ellipse
          key={angle}
          cy="-4"
          rx="2.5"
          ry="4"
          transform={`rotate(${angle})`}
          fill={colour}
          strokeWidth=".8"
        />
      ))}
      <circle r="2.7" fill={centre} strokeWidth=".8" />
    </g>
  );
}
function Cherries() {
  return (
    <g>
      <path d="M0-6q-2 8-6 10m6-10q7 7 6 12" fill="none" stroke="#8fa080" strokeWidth="1.4" />
      <path d="M0-6q6-7 10-3Q7-3 0-6Z" fill="#9dac8a" strokeWidth=".8" />
      <circle cx="-6" cy="5" r="4.5" fill="#b95d7f" />
      <circle cx="6" cy="7" r="4.5" fill="#cd86a0" />
      <path d="m-7 3 1-1m11 3 1-1" stroke="#f9dce4" strokeWidth="1" />
    </g>
  );
}
function HeldItem({ coat, children }: { coat: string; children: ReactNode }) {
  return (
    <g transform="translate(70 69) rotate(6)">
      {children}
      <path d="M1 20c-8-6-10 4-3 7l4-1" fill={coat} />
    </g>
  );
}

/** Additional named SVG parts; old accessory identifiers retain their artwork. */
export function ExtraBunnyAccessory({
  parts,
  patternId,
  coat,
}: {
  parts: TicketBunny;
  patternId: string;
  coat: string;
}) {
  const { accent, light, paper } = ticketBunnyColours[parts.palette];
  switch (parts.accessory) {
    case "monster":
      return (
        <HeldItem coat={coat}>
          <rect x="0" y="0" width="18" height="29" rx="3" fill="#292a30" />
          <ellipse cx="9" cy="1" rx="7.5" ry="2" fill="#b9bbc0" stroke="#eee6e7" strokeWidth=".7" />
          <ellipse cx="9" cy=".8" rx="2.4" ry="1" fill="#656871" stroke="none" />
          <path
            d="m4 7 3 2-1 7-2 4 1-9Zm4-1 3 3-1 8-2 5 1-11Zm4 0 3 3-1 9-2 4 1-12Z"
            fill="#a9d65e"
            stroke="none"
          />
          <path d="M4 25h10" stroke="#a9d65e" strokeWidth=".8" />
        </HeldItem>
      );
    case "redbull":
      return (
        <HeldItem coat={coat}>
          <rect x="1" y="-3" width="16" height="32" rx="2.5" fill="#dce1e8" />
          <path
            d="M3.5-2H9v16H2V.5q0-2.5 1.5-2.5ZM9 14h7v12q0 2-2 2H9Z"
            fill="#395ca5"
            stroke="none"
          />
          <path d="M3 1v25" stroke="#f5f5fa" strokeWidth=".7" opacity=".7" />
          <circle cx="9" cy="13" r="5.2" fill="#ebc766" stroke="none" />
          {[false, true].map((mirror) => (
            <g key={String(mirror)} transform={mirror ? "translate(18 0) scale(-1 1)" : undefined}>
              <path
                d="m8 12-1.5.2-1.2-1.4-2 .4-1.1-.7.5 2.3 1 .6-.2 2.3h1l.4-2 1.3.1 1.1 1.8.9-.5-1-2 1-.5Z"
                fill="#c8465d"
                stroke="none"
              />
              <path d="m7 12 .2-1.4 1 .5" fill="none" stroke="#c8465d" strokeWidth=".7" />
            </g>
          ))}
          <path d="M5 6h8m-7 2h6" stroke="#c8465d" strokeWidth="1" />
          <path d="M4 22h3m-3 2h3m4-2h3m-3 2h3" stroke="#f7f3e9" strokeWidth=".7" />
          <ellipse
            cx="9"
            cy="-2"
            rx="7"
            ry="1.8"
            fill="#b7c1d0"
            stroke="#f4f2f6"
            strokeWidth=".7"
          />
          <ellipse cx="9" cy="-2" rx="2.2" ry=".7" fill="#77889d" stroke="none" />
          <path d="M4 28h10" stroke="#a0aec0" strokeWidth=".8" />
        </HeldItem>
      );
    case "strawberrysoda":
      return (
        <HeldItem coat={coat}>
          <path d="M5 1h8v6l4 4v15q-8 4-16 0V11l4-4Z" fill="#e8a9be" />
          <rect x="4" y="-1" width="10" height="4" rx="1" fill="#cd86a0" />
          <rect x="2" y="12" width="14" height="11" rx="2" fill="#fff0e8" stroke="none" />
          <path d="M5 16q4-4 8 0-1 6-4 7-3-1-4-7" fill="#ca7494" stroke="none" />
          <path d="m5 16 4-3 4 3-4-1Z" fill="#96a58c" stroke="none" />
          <path d="m7 18 .2.2m3 .8.2.2" stroke="#fff2d5" strokeWidth="1" />
        </HeldItem>
      );
    case "bubbletea":
      return (
        <HeldItem coat={coat}>
          <path d="m1 6 2 23h14l2-23Z" fill="#dfc0a7" />
          <path d="m2 10 1 18h14l1-18Z" fill="#ecd3bc" stroke="none" />
          <path d="M11-4 9 10" stroke={accent} strokeWidth="3" />
          <ellipse cx="10" cy="6" rx="9.5" ry="2.5" fill="#fff0df" />
          <path d="M9 6 11-4" stroke={accent} strokeWidth="2.3" />
          <g fill="#876772" stroke="none">
            <circle cx="6" cy="24" r="2" />
            <circle cx="12" cy="25" r="2" />
            <circle cx="15" cy="21" r="2" />
            <circle cx="8" cy="19" r="2" />
          </g>
        </HeldItem>
      );
    case "icedmatcha":
      return (
        <HeldItem coat={coat}>
          <path d="m1 5 2 24h14l2-24Z" fill="#f7ecda" />
          <path d="m2 16 1 12h14l1-12q-7 4-16 0" fill="#a3b38b" stroke="none" />
          <path d="M13-5 10 6" stroke="#bfa0b1" strokeWidth="2" />
          <ellipse cx="10" cy="5" rx="9" ry="3" fill="#a8b797" />
          <g fill="#e5eddd" strokeWidth=".6">
            <rect x="4" y="7" width="5" height="5" rx="1" />
            <rect x="11" y="9" width="5" height="5" rx="1" />
          </g>
          <path d="M5 18v7" stroke="#f5f5e1" strokeWidth="1.3" />
        </HeldItem>
      );
    case "coffeecup":
      return (
        <HeldItem coat={coat}>
          <path d="m1 5 3 24h13l3-24Z" fill="#f4e8d5" />
          <path d="M1 13h18l-1 10H2Z" fill="#be967b" stroke="none" />
          <path d="M-1 5V2h4V0h14v2h4v4Z" fill="#8c6f73" />
          <g transform="translate(10 17) scale(.45)">
            <Heart fill="#f7e1db" />
          </g>
        </HeldItem>
      );
    case "ramune":
      return (
        <HeldItem coat={coat}>
          <path d="M6-2h8v5l-2 3 1 6 4 4v12q-7 3-14 0V16l4-4 1-6-2-3Z" fill="#a9c6c8" />
          <rect x="5" y="-3" width="10" height="4" rx="1.5" fill="#82aaa9" />
          <circle cx="10" cy="8" r="2.5" fill="#e5f2e9" strokeWidth=".6" />
          <path d="M4 18h12v7H4Z" fill="#eaf0df" stroke="none" />
          <circle cx="10" cy="21.5" r="2.5" fill="#cf99af" stroke="none" />
        </HeldItem>
      );
    case "juicebox":
      return (
        <HeldItem coat={coat}>
          <rect y="4" width="19" height="25" rx="2" fill="#e1b383" />
          <path d="M13 6V-2l6-2" fill="none" stroke="#b594ab" strokeWidth="2" />
          <path d="M1 10h17v13H1Z" fill="#f8ead4" stroke="none" />
          <path d="m8 13 5 3-8 8Z" fill="#d29769" strokeWidth=".8" />
          <path d="m10 14-2-5m2 5 4-5m-4 5 6-1" stroke="#91a080" strokeWidth="1.5" />
        </HeldItem>
      );
    case "milkcarton":
      return (
        <HeldItem coat={coat}>
          <path d="m0 6 4-7h11l4 7v23H0Z" fill="#f8e6df" />
          <path d="M4-1v7h15m-19 0h19M0 18h19v11H0" fill="#d894ad" />
          <path d="M7 10q3-3 6 0-1 6-3 7-3-2-3-7Z" fill="#c96b91" stroke="none" />
          <path d="m7 10 3-3 3 3" fill="#93a188" stroke="none" />
        </HeldItem>
      );
    case "lollipop":
      return (
        <HeldItem coat={coat}>
          <path d="M9 12v19" stroke="#dfc7b8" strokeWidth="3" />
          <circle cx="9" cy="6" r="10" fill="#f8dfeb" />
          <path
            d="M9 6c4-5 9 1 5 5-5 6-15-1-11-8 4-8 16-6 16 3"
            fill="none"
            stroke="#ce87a6"
            strokeWidth="2.5"
          />
          <path d="m8 18-6-3v7l6-2 7 3v-8Z" fill={accent} strokeWidth="1" />
        </HeldItem>
      );
    case "icecream":
      return (
        <HeldItem coat={coat}>
          <path d="m1 11 8 19 9-19Z" fill="#dfb789" />
          <path d="m5 15 8 7m-9-1 10-6m-7 10 7-6" stroke="#b89474" strokeWidth=".7" />
          <path d="M0 10C-3-2 21-3 20 9q-1 5-5 3-4 5-7 1-4 3-8-3Z" fill="#edc4d6" />
          <path d="M3 0C1-11 18-12 18 0q-3 4-7 1Q7 4 3 0Z" fill="#f8e8ce" />
          <circle cx="11" cy="-9" r="2.5" fill="#c66d8d" strokeWidth="1" />
        </HeldItem>
      );
    case "donut":
      return (
        <HeldItem coat={coat}>
          <path
            d="M9 1a12 12 0 1 0 0 24 12 12 0 1 0 0-24M9 9a4 4 0 1 1 0 8 4 4 0 1 1 0-8"
            fill="#dbaf83"
            fillRule="evenodd"
          />
          <path
            d="M9 3c-14 0-14 21 0 21s14-21 0-21M9 9a4 4 0 1 1 0 8 4 4 0 1 1 0-8"
            fill="#e2a6bc"
            fillRule="evenodd"
            stroke="none"
          />
          <path
            d="m4 7 2 1m9 0-1 2M0 14l2 1m13 5 2-2m-12 2 2 1"
            stroke="#fff1d5"
            strokeWidth="1.3"
          />
        </HeldItem>
      );
    case "cupcake":
      return (
        <HeldItem coat={coat}>
          <path d="m0 13 3 15h15l3-15Z" fill={accent} />
          <path d="m4 17 1 8m5-8v9m6-9-1 8" stroke={light} strokeWidth="1" />
          <path
            d="M-1 13q-2-5 4-7-1-5 5-6 2-7 6-2-1 5 4 5 6 1 4 6 5 6-3 7-4-3-7 0-4-3-7 0Z"
            fill="#f4d6e0"
          />
          <circle cx="11" cy="-3" r="3" fill="#c56887" strokeWidth="1" />
        </HeldItem>
      );
    case "cherryclip":
      return (
        <g transform="translate(70 43) rotate(-12)">
          <Cherries />
        </g>
      );
    case "starclip":
      return (
        <g transform="translate(69 44) rotate(-18)">
          <path d="M-11 0h24" stroke="#b2926c" strokeWidth="3" />
          <g transform="translate(-5 0) scale(.7)">
            <Star />
          </g>
          <g transform="translate(8 0) scale(.5)">
            <Star fill={light} />
          </g>
        </g>
      );
    case "butterflyclip":
      return (
        <g transform="translate(70 43) rotate(-12)">
          <path
            d="M0 0C-19-19-20 3-6 4c-14 9 0 15 6 2 6 13 20 7 6-2C20 3 19-19 0 0Z"
            fill={accent}
          />
          <path d="m0 0-8-4m8 4 8-4m-8 6-5 4m5-4 5 4" stroke={light} strokeWidth="1" />
          <path d="M0-3v11m0-10-3-4m3 4 3-4" stroke="#9b7994" strokeWidth="1.4" />
        </g>
      );
    case "daisyclips":
      return (
        <g>
          <g transform="translate(65 42)">
            <Daisy />
          </g>
          <g transform="translate(77 49) scale(.65)">
            <Daisy />
          </g>
        </g>
      );
    case "pearlclips":
      return (
        <g transform="translate(71 45) rotate(-25)">
          <path d="M-10-4h20M-8 3H9" stroke="#bc9b76" strokeWidth="2" />
          {[-8, -4, 0, 4, 8].map((x) => (
            <circle
              key={x}
              cx={x}
              cy="-4"
              r="2.4"
              fill="#fff1da"
              stroke="#d8c5b7"
              strokeWidth=".6"
            />
          ))}
          {[-6, -2, 2, 6].map((x) => (
            <circle key={x} cx={x} cy="3" r="2" fill="#fff1da" stroke="#d8c5b7" strokeWidth=".6" />
          ))}
        </g>
      );
    case "ribbonbraids":
      return (
        <g fill={accent}>
          {[26, 70].map((x) => (
            <g key={x} transform={`translate(${x} 44)`}>
              <path d="M-1 1c-12-12-15 3-2 2L-8 20l7-4 2-12 6 17 6-3L3 3c13 0 10-14-2-2Z" />
              <circle r="2.3" fill={light} />
              <path d="m-4 8-2 6m10-6 2 7" stroke={light} strokeWidth="1" />
            </g>
          ))}
        </g>
      );
    case "scrunchie":
      return (
        <g
          transform={
            parts.ears === "lop" ? "translate(17 55) rotate(15)" : "translate(31 32) rotate(-16)"
          }
        >
          <path
            d="M-9-3q-3-6 3-6 1-5 6-2 5-3 7 2 7-1 5 6 4 5-2 7-1 6-7 3-4 5-7 0-7 1-6-5-4-4 1-5Z"
            fill={accent}
          />
          <ellipse rx="5" ry="3" fill={coat} stroke={light} strokeWidth="2" />
          <path d="m-7-6 2 2m8-5-1 4m6 1-3 1m0 5-1-3m-9 3 2-3" stroke={light} strokeWidth="1" />
        </g>
      );
    case "lacebonnet":
      return (
        <g>
          <path d="M19 68C7 28 89 28 77 68" fill="none" stroke={accent} strokeWidth="7" />
          <path
            d="M17 66C5 22 91 22 79 66"
            fill="none"
            stroke={light}
            strokeWidth="5"
            strokeDasharray="1 4"
          />
          <path
            d="M20 68q3 13 21 18m35-18Q71 81 54 86"
            fill="none"
            stroke={accent}
            strokeWidth="2"
          />
          <path d="m47 87-9-5v10l9-3 10 3v-10Z" fill={accent} strokeWidth="1" />
        </g>
      );
    case "beret":
      return (
        <g>
          <path d="M26 42C13 29 43 19 66 29q17 10 2 16Z" fill={accent} />
          <path d="M26 42q18 8 42 3" stroke={light} strokeWidth="3" />
          <path d="m47 25 3-7" stroke={accent} strokeWidth="3" />
          <g transform="translate(59 35) scale(.45)">
            <Heart fill={light} />
          </g>
        </g>
      );
    case "buckethat":
      return (
        <g>
          <path d="m31 27-5 17-8 5q28 10 59 0l-8-5-5-17Z" fill={paper} />
          <path d="M26 44q20 6 43 0" fill="none" stroke={accent} strokeWidth="2" />
          <g transform="translate(50 36) scale(.65)">
            <Daisy />
          </g>
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M26 44C23 12 72 12 70 44Z" fill={accent} />
          <path
            d="M32 35q0-12 8-16m2 17V18m12 18V19m9 17q0-11-6-15"
            fill="none"
            stroke={light}
            strokeWidth="1"
          />
          <rect x="24" y="37" width="48" height="10" rx="4" fill={paper} />
          <circle cx="48" cy="15" r="6" fill={light} />
          <path d="m46 11 4 8m-7-4 10 1" stroke={paper} strokeWidth="2" />
        </g>
      );
    case "sailorhat":
      return (
        <g>
          <path d="M28 38C18 16 78 16 68 38Z" fill="#fff5e4" />
          <path d="M27 37h42v9H27Z" fill="#8ba4ba" />
          <path d="M31 41h34" stroke="#fff5e4" strokeWidth="1" />
          <path d="M48 30v8m-4-4q4 6 8 0m-7-2h6" fill="none" stroke="#b3956b" strokeWidth="1.2" />
        </g>
      );
    case "heartdrops":
    case "stardrops":
    case "cherrydrops":
    case "pearlstuds":
    case "earcuffs":
    case "safetypins":
      return <BunnyEarJewellery ears={parts.ears} kind={parts.accessory} />;
    case "choker":
      return (
        <g>
          <path d="M33 79q15 8 30 0v5q-15 8-30 0Z" fill="#6f5365" />
          <g transform="translate(48 86) scale(.6)">
            <Heart fill={accent} />
          </g>
        </g>
      );
    case "locket":
      return (
        <g>
          <path d="M31 77q17 26 34 0" fill="none" stroke="#c7a16e" strokeWidth="1.5" />
          <g transform="translate(48 89) scale(.7)">
            <Heart fill="#dfbb86" />
          </g>
          <path d="M48 89v5" stroke="#b8996f" strokeWidth=".8" />
        </g>
      );
    case "roundglasses":
      return (
        <g fill="none" stroke="#bb9e78" strokeWidth="1.6">
          <circle cx="35" cy="61" r="9" />
          <circle cx="61" cy="61" r="9" />
          <path d="M44 60q4-3 8 0m-26-2-5-1m49 1 5-1" />
          <path d="m30 56 3-1m24 1 3-1" stroke="#fff5e4" strokeWidth="1" />
        </g>
      );
    case "catglasses":
      return (
        <g fill={light} fillOpacity=".35" stroke={accent} strokeWidth="2">
          <path d="M23 53q8 7 20 5 1 14-10 11-8-2-10-16Zm50 0q-8 7-20 5-1 14 10 11 8-2 10-16Z" />
          <path d="M43 59h10" fill="none" />
          <path d="m27 55 1 .2m40 0 1-.2" stroke="#fff6e9" strokeWidth="2" />
        </g>
      );
    case "starshades":
      return (
        <g fill="#776072" stroke={accent} strokeWidth="2">
          <g transform="translate(34 61)">
            <Star fill="#776072" />
          </g>
          <g transform="translate(62 61)">
            <Star fill="#776072" />
          </g>
          <path d="M43 60h10m-28 0-5-2m51 2 5-2" fill="none" />
          <path d="m31 58 3 3m25-3 3 3" stroke={light} strokeWidth="1" />
        </g>
      );
    case "pixelshades":
      return (
        <g>
          <path
            d="M23 54h50v10h-4v4H56v-4h-4v-6h-8v6h-4v4H27v-4h-4Z"
            fill="#504753"
            stroke={light}
            strokeWidth="1"
          />
          <path
            d="M27 57h4v4h-4m5 5h4v-4h-4m24-5h4v4h-4m5 5h4v-4h-4"
            fill="#e7d8e1"
            stroke="none"
          />
        </g>
      );
    case "camera":
      return (
        <HeldItem coat={coat}>
          <path d="M-2 5h6l2-4h8l2 4h6v20H-2Z" fill={accent} />
          <circle cx="10" cy="15" r="7" fill="#eee2e6" />
          <circle cx="10" cy="15" r="4.5" fill="#786a80" stroke="none" />
          <circle cx="9" cy="14" r="1.5" fill="#e7dfea" stroke="none" />
          <rect x="0" y="8" width="5" height="3" rx=".5" fill="#fff2d5" stroke="none" />
          <path d="M21 8q6 11-2 20" fill="none" stroke="#c0a187" strokeWidth="1" />
        </HeldItem>
      );
    case "gameconsole":
      return (
        <HeldItem coat={coat}>
          <rect x="-1" y="-2" width="21" height="31" rx="4" fill={accent} />
          <rect
            x="2"
            y="1"
            width="15"
            height="13"
            rx="2"
            fill="#c1ceae"
            stroke="#877d86"
            strokeWidth="1"
          />
          <path d="M5 19v6m-3-3h6" stroke="#756173" strokeWidth="2" />
          <circle cx="13" cy="23" r="1.8" fill={light} stroke="none" />
          <circle cx="17" cy="19" r="1.8" fill={light} stroke="none" />
          <path d="m6 7 3 3 5-5" fill="none" stroke="#8fa17d" strokeWidth="1.2" />
        </HeldItem>
      );
    case "handbag":
      return (
        <HeldItem coat={coat}>
          <path d="M3 10C1-3 19-3 17 10" fill="none" stroke="#c3a07c" strokeWidth="2" />
          <rect x="-2" y="8" width="24" height="21" rx="4" fill={accent} />
          <path d="m0 12 16 16m-9-19 13 13M1 24l15-15M8 28l13-13" stroke={light} strokeWidth=".7" />
          <path d="M-1 9v8q11 9 22 0V9Z" fill={paper} />
          <rect x="8" y="18" width="4" height="4" rx="1" fill="#dfbb86" strokeWidth=".7" />
        </HeldItem>
      );
    case "leopardbag":
      return (
        <HeldItem coat={coat}>
          <path d="M1 15C-3-7 24-7 20 15" fill="none" stroke="#967184" strokeWidth="3" />
          <path d="M-2 12q11 4 24 0l-1 16q-11 4-22 0Z" fill={`url(#${patternId})`} />
          <path d="M-1 13q10 4 22 0" fill="none" stroke="#967184" strokeWidth="2" />
          <circle cx="11" cy="16" r="2" fill="#dfbb86" strokeWidth=".7" />
        </HeldItem>
      );
    case "heartbag":
      return (
        <HeldItem coat={coat}>
          <path d="M1 11C-4-6 25-6 20 11" fill="none" stroke="#c1a078" strokeWidth="1.5" />
          <path d="M10 10C-7-7-12 16 10 29 32 16 27-7 10 10Z" fill={accent} />
          <path d="M0 13q8-4 19 0" fill="none" stroke={light} strokeWidth="1" />
          <circle cx="17" cy="13" r="1.5" fill="#dfbb86" stroke="none" />
        </HeldItem>
      );
    case "teddy":
      return (
        <HeldItem coat={coat}>
          <g fill="#c7a184">
            <circle cx="2" cy="1" r="5" />
            <circle cx="18" cy="1" r="5" />
            <ellipse cx="10" cy="21" rx="9" ry="10" />
            <circle cx="0" cy="19" r="4" />
            <circle cx="20" cy="19" r="4" />
            <circle cx="5" cy="29" r="4" />
            <circle cx="16" cy="29" r="4" />
            <circle cx="10" cy="7" r="10" />
          </g>
          <ellipse cx="10" cy="10" rx="5" ry="4" fill="#efdbc3" stroke="none" />
          <path d="m5 5 .1.2m10-.2.1.2m-7 4 2 2 2-2" stroke="#806271" strokeWidth="1.5" />
          <path d="m9 17-6-3v6l6-2 7 2v-6Z" fill={accent} strokeWidth="1" />
        </HeldItem>
      );
    case "bunnyplush":
      return (
        <HeldItem coat={coat}>
          <g fill="#e8cad7">
            <ellipse cx="5" cy="1" rx="3.5" ry="9" />
            <ellipse cx="16" cy="1" rx="3.5" ry="9" />
            <ellipse cx="10" cy="23" rx="9" ry="8" />
            <ellipse cx="10" cy="11" rx="11" ry="9" />
          </g>
          <path d="M5-3v7m11-7v7" stroke="#fce5ee" strokeWidth="2" />
          <path d="m5 10 .1.2m10-.2.1.2m-6 3 1 1 1-1" stroke="#8b6278" strokeWidth="1.5" />
          <path d="m10 20-6-3v7l6-2 6 2v-7Z" fill={accent} strokeWidth=".8" />
        </HeldItem>
      );
    case "carrotplush":
      return (
        <HeldItem coat={coat}>
          <path d="M9 4C-2-6 4-13 10-1c-1-15 10-13 4 0 12-11 15-1 1 6Z" fill="#9dab8c" />
          <path d="M1 7c2-7 17-6 19 1 2 9-5 22-10 23C5 30-2 17 1 7Z" fill="#dda57a" />
          <path d="m5 13 .1.2m10-.2.1.2m-7 5q2 2 4 0m-8 5 3 1" stroke="#9f715e" strokeWidth="1.2" />
        </HeldItem>
      );
    case "heartwand":
      return (
        <HeldItem coat={coat}>
          <path d="M9 6v26" stroke="#c3a078" strokeWidth="2.5" />
          <g transform="translate(9 0)">
            <Heart fill={accent} />
          </g>
          <path
            d="m9 12-8-3 2 7 6-2 8 2 1-7Zm-2 4-4 10m9-10 4 8"
            fill={paper}
            stroke={light}
            strokeWidth="1"
          />
        </HeldItem>
      );
    case "starwand":
      return (
        <HeldItem coat={coat}>
          <path d="M9 5v27" stroke={accent} strokeWidth="2.5" />
          <g transform="translate(9 1)">
            <Star />
          </g>
          <path d="M9 12Q-1 17 5 25m5-13q11 6 7 14" fill="none" stroke={accent} strokeWidth="1.3" />
        </HeldItem>
      );
    case "moonwand":
      return (
        <HeldItem coat={coat}>
          <path d="M9 8v24" stroke={accent} strokeWidth="2.5" />
          <path d="M13-8C-10-10-10 16 13 14 1 9 0-3 13-8Z" fill="#dfbb86" />
          <g transform="translate(16 1) scale(.45)">
            <Star fill={light} />
          </g>
          <ellipse cx="9" cy="16" rx="4" ry="2" fill={paper} />
        </HeldItem>
      );
    case "sakura":
      return (
        <HeldItem coat={coat}>
          <path d="M5 31 12-5M8 16-2 7m12 0 11-9" fill="none" stroke="#b49580" strokeWidth="1.8" />
          <g transform="translate(11 0) scale(.75)">
            <Daisy colour="#e5afc5" />
          </g>
          <g transform="translate(-1 8) scale(.65)">
            <Daisy colour="#f1cad9" />
          </g>
          <g transform="translate(19 5) scale(.65)">
            <Daisy colour="#d79bb7" />
          </g>
          <path d="M7 20q8-9 11-6-2 7-11 6Z" fill="#9daa8a" strokeWidth=".8" />
        </HeldItem>
      );
    case "fan":
      return (
        <HeldItem coat={coat}>
          <path d="M9 27-7 7q16-21 32 0Z" fill={paper} />
          <path d="M-7 7q16-21 32 0" fill="none" stroke={accent} strokeWidth="4" />
          <path d="M9 27 0 4m9 23V0m0 27L18 4" fill="none" stroke="#bf9c7a" strokeWidth="1" />
          <g transform="translate(9 10) scale(.5)">
            <Daisy colour={accent} />
          </g>
        </HeldItem>
      );
    case "umbrella":
      return (
        <HeldItem coat={coat}>
          <path d="M9-8v37q0 6 4 3" fill="none" stroke="#b49379" strokeWidth="1.6" />
          <path d="M-7 6C-4-11 22-11 25 6q-5-4-8 0-8-5-16 0-4-4-8 0Z" fill={paper} />
          <path d="M9-7Q0-3 1 6m8-13q8 5 8 13" fill="none" stroke={accent} strokeWidth="1" />
          <path
            d="M-7 7q4-3 8 0 8-4 16 0 4-3 8 0"
            fill="none"
            stroke={light}
            strokeWidth="2.5"
            strokeDasharray="1 2"
          />
        </HeldItem>
      );
    case "bow":
    case "leopardbow":
    case "flower":
    case "tiara":
    case "headphones":
    case "heartshades":
    case "hoops":
    case "flipphone":
    case "chain":
      return null;
  }
  const unhandled: never = parts.accessory;
  return unhandled;
}
