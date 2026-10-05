import type { JsonValue } from "../server/upstream";

// Persist these named parts, not a random seed: existing tickets keep their design
// when more parts are added. Version 1's drawings are kept in TicketBunny.tsx.
export const bunnyFurs = ["cream", "biscuit", "cocoa", "smoke", "ink"] as const;
export const bunnyEars = ["upright", "floppy", "lop", "short"] as const;
export const bunnyFaces = ["sparkle", "wink", "dreamy", "tough"] as const;
export const bunnyOutfits = ["leopard", "camisole", "sailor", "action"] as const;
export const bunnyAccessories = [
  "bow",
  "leopardbow",
  "flower",
  "tiara",
  "headphones",
  "heartshades",
  "hoops",
  "flipphone",
  "chain",
] as const;
export const bunnyPalettes = ["rose", "lilac", "mint", "honey", "sky"] as const;

export type TicketBunny = {
  version: 1;
  fur: (typeof bunnyFurs)[number];
  ears: (typeof bunnyEars)[number];
  face: (typeof bunnyFaces)[number];
  outfit: (typeof bunnyOutfits)[number];
  accessory: (typeof bunnyAccessories)[number];
  palette: (typeof bunnyPalettes)[number];
};

export const maDongSeokBunny: TicketBunny = {
  version: 1,
  fur: "biscuit",
  ears: "short",
  face: "tough",
  outfit: "action",
  accessory: "chain",
  palette: "sky",
};

function isPart<T extends string>(options: readonly T[], value: JsonValue | undefined): value is T {
  return options.some((option) => option === value);
}

export function isTicketBunny(value: JsonValue | undefined): value is TicketBunny {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    "version" in value &&
    value.version === 1 &&
    "fur" in value &&
    isPart(bunnyFurs, value.fur) &&
    "ears" in value &&
    isPart(bunnyEars, value.ears) &&
    "face" in value &&
    isPart(bunnyFaces, value.face) &&
    "outfit" in value &&
    isPart(bunnyOutfits, value.outfit) &&
    "accessory" in value &&
    isPart(bunnyAccessories, value.accessory) &&
    "palette" in value &&
    isPart(bunnyPalettes, value.palette) &&
    Object.keys(value).length === 7
  );
}

export function generateTicketBunny(seed: string): TicketBunny {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  function pick<T>(options: readonly T[]): T {
    state += 0x6d2b79f5;
    let hash = Math.imul(state ^ (state >>> 15), 1 | state);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), 61 | hash);
    return options[((hash ^ (hash >>> 14)) >>> 0) % options.length];
  }
  return {
    version: 1,
    fur: pick(bunnyFurs),
    ears: pick(bunnyEars),
    face: pick(bunnyFaces),
    outfit: pick(bunnyOutfits),
    accessory: pick(bunnyAccessories),
    palette: pick(bunnyPalettes),
  };
}
