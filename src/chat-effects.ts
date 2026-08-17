export const chatColors = [
  "yellow",
  "red",
  "green",
  "cyan",
  "purple",
  "white",
  "flash1",
  "flash2",
  "flash3",
  "glow1",
  "glow2",
  "glow3",
] as const;

export const chatMotions = ["wave", "wave2", "shake", "scroll", "slide"] as const;

export type ChatColor = (typeof chatColors)[number];
export type ChatMotion = (typeof chatMotions)[number];

export type ChatEffects = {
  color: ChatColor | null;
  motion: ChatMotion | null;
  text: string;
};

const colors = new Set<string>(chatColors);
const motions = new Set<string>(chatMotions);

function isChatColor(value: string): value is ChatColor {
  return colors.has(value);
}

function isChatMotion(value: string): value is ChatMotion {
  return motions.has(value);
}

function leadingCode(message: string) {
  const wrapped = message.match(/^:([a-z][a-z0-9]*):/i);
  if (wrapped) return { code: wrapped[1].toLowerCase(), length: wrapped[0].length };
  const classic = message.match(/^([a-z][a-z0-9]*):/i);
  return classic ? { code: classic[1].toLowerCase(), length: classic[0].length } : null;
}

export function parseChatEffects(message: string): ChatEffects {
  let color: ChatColor | null = null;
  let motion: ChatMotion | null = null;
  let remaining = message;

  while (true) {
    const prefix = leadingCode(remaining);
    if (!prefix) break;
    if (isChatColor(prefix.code)) {
      if (color) break;
      color = prefix.code;
    } else if (isChatMotion(prefix.code)) {
      if (motion) break;
      motion = prefix.code;
    } else {
      break;
    }
    remaining = remaining.slice(prefix.length);
  }

  return { color, motion, text: remaining.trimStart() };
}
