import { useId } from "react";

import {
  bunnyAccessories,
  bunnyEars,
  bunnyFaces,
  bunnyFurs,
  bunnyOutfits,
  bunnyPalettes,
  bowBunny,
  generateTicketBunny,
  maDongSeokBunny,
  type TicketBunny,
} from "../shared/ticket-bunny";
import { UiIcon } from "./Icons";
import { ticketBunnyColours } from "./ticket-bunny-colours";
import { bunnyAccessoryDetails, bunnyAccessoryGroups } from "./ticket-bunny-accessories";

function PartSelect<T extends string>({
  label,
  options,
  labels,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <label className="ticket-bunny-part" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((part) => part === event.target.value);
          if (next) onChange(next);
        }}
      >
        {options.map((part) => (
          <option key={part} value={part}>
            {labels[part]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TicketBunnyEditor({
  value,
  disabled,
  onChange,
}: {
  value: TicketBunny;
  disabled: boolean;
  onChange: (parts: TicketBunny) => void;
}) {
  return (
    <fieldset className="ticket-bunny-editor" disabled={disabled}>
      <legend>Make your bunny</legend>
      <div className="ticket-bunny-presets">
        <button
          type="button"
          className="ticket-bunny-shuffle"
          onClick={() => onChange({ ...bowBunny })}
        >
          <UiIcon name="heart" /> Bow bunny
        </button>
        <button
          type="button"
          className="ticket-bunny-shuffle"
          onClick={() => onChange({ ...maDongSeokBunny })}
        >
          <UiIcon name="heart" /> Ma Dong-seok
        </button>
        <button
          className="ticket-bunny-shuffle"
          type="button"
          onClick={() => onChange(generateTicketBunny(crypto.randomUUID()))}
        >
          <UiIcon name="sparkle" /> Shuffle bunny
        </button>
      </div>
      <div className="ticket-bunny-parts">
        <PartSelect
          label="Fur"
          options={bunnyFurs}
          labels={{
            cream: "Vanilla",
            biscuit: "Biscuit",
            cocoa: "Cocoa",
            smoke: "Silver",
            ink: "Licorice",
            blush: "Blush pink",
          }}
          value={value.fur}
          disabled={disabled}
          onChange={(fur) => onChange({ ...value, fur })}
        />
        <PartSelect
          label="Ears"
          options={bunnyEars}
          labels={{
            upright: "Upright",
            floppy: "One floppy",
            lop: "Lop ears",
            short: "Short ears",
          }}
          value={value.ears}
          disabled={disabled}
          onChange={(ears) => onChange({ ...value, ears })}
        />
        <PartSelect
          label="Expression"
          options={bunnyFaces}
          labels={{
            sparkle: "Bright eyes",
            wink: "Wink",
            dreamy: "Daydream",
            tough: "Action hero",
          }}
          value={value.face}
          disabled={disabled}
          onChange={(face) => onChange({ ...value, face })}
        />
        <PartSelect
          label="Outfit"
          options={bunnyOutfits}
          labels={{
            leopard: "Leopard",
            camisole: "Lace & pearls",
            sailor: "Sailor collar",
            action: "Black tee & fists",
          }}
          value={value.outfit}
          disabled={disabled}
          onChange={(outfit) => onChange({ ...value, outfit })}
        />
        <label className="ticket-bunny-part">
          <span>Accessory</span>
          <select
            value={value.accessory}
            disabled={disabled}
            onChange={(event) => {
              const accessory = bunnyAccessories.find((part) => part === event.target.value);
              if (accessory) onChange({ ...value, accessory });
            }}
          >
            {bunnyAccessoryGroups.map((group) => (
              <optgroup key={group} label={group}>
                {bunnyAccessories
                  .filter((part) => bunnyAccessoryDetails[part].group === group)
                  .map((part) => (
                    <option key={part} value={part}>
                      {bunnyAccessoryDetails[part].label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <fieldset className="ticket-bunny-palette">
          <legend>Colour</legend>
          {bunnyPalettes.map((palette) => (
            <button
              key={palette}
              type="button"
              style={{ background: ticketBunnyColours[palette].paper }}
              aria-label={`${palette} palette`}
              aria-pressed={value.palette === palette}
              title={palette}
              onClick={() => onChange({ ...value, palette })}
            >
              {value.palette === palette ? "✓" : ""}
            </button>
          ))}
        </fieldset>
      </div>
    </fieldset>
  );
}
