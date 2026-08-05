export type Viewer = {
  admin: boolean;
  avatar: string | null;
  expires: number;
  id: string;
  name: string;
  permissions: string[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign", "verify"]);
}

export async function createSession(viewer: Omit<Viewer, "expires">, secret: string) {
  const body = encode(encoder.encode(JSON.stringify({ ...viewer, expires: Date.now() + 7 * 24 * 60 * 60 * 1_000 })));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}

export async function readSession(request: Request, secret: string): Promise<Viewer | null> {
  const token = readCookie(request, "bp_session");
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;

  try {
    const valid = await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(body));
    if (!valid) return null;
    const viewer = JSON.parse(decoder.decode(decode(body))) as Viewer;
    return viewer.expires > Date.now() ? viewer : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function sessionCookie(value: string, maxAge = 7 * 24 * 60 * 60, secure = true) {
  return `bp_session=${value}; Path=/; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=${maxAge}`;
}
