import type { Session } from "../shared/user";
import type { Env, RequestMetadata } from "./env";
import { readCookie, sessionCookie } from "./session";
import { discordBotViewer, discordViewer, exchangeDiscordToken } from "./discord";
import { viewerForRequest } from "./authentication";
import { isSecure, jsonObject } from "./http";
import { isString } from "../shared/json";
function redirectUri(request: Request, env: Env) {
  return `${(env.API_URL || new URL(request.url).origin).replace(/\/$/, "")}/auth/callback`;
}

function oauthCookie(value: string, request: Request, maxAge = 600) {
  return `bp_oauth=${value}; Path=/auth/callback; HttpOnly${isSecure(request) ? "; Secure" : ""}; SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location: string, cookie?: string) {
  const headers = new Headers({ Location: location });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { headers, status: 302 });
}

async function beginLogin(request: Request, env: Env) {
  const state = crypto.randomUUID();
  const authorization = new URL("https://discord.com/oauth2/authorize");
  authorization.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(request, env),
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
  }).toString();
  return redirect(authorization.toString(), oauthCookie(state, request));
}

async function finishLogin(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(request, "bp_oauth")) {
    return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=oauth`, oauthCookie("", request, 0));
  }

  try {
    const credentials = await exchangeDiscordToken(
      new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(request, env),
      }),
      env,
    );
    if (!credentials) throw new Error("Discord token exchange failed");
    const viewer = await discordViewer(credentials.accessToken, env);
    if (!viewer) {
      return redirect(
        `${env.APP_URL.replace(/\/$/, "")}/?error=not-a-member`,
        oauthCookie("", request, 0),
      );
    }

    if (!env.AUTH_SESSIONS) throw new Error("Session storage is unavailable");
    const previousToken = readCookie(request, "bp_session");
    if (previousToken) await env.AUTH_SESSIONS.revoke(previousToken);
    const session = await env.AUTH_SESSIONS.create(viewer, credentials);
    return redirect(env.APP_URL, sessionCookie(session, undefined, isSecure(request)));
  } catch {
    return redirect(`${env.APP_URL.replace(/\/$/, "")}/?error=oauth`, oauthCookie("", request, 0));
  }
}
async function redeemDiscordLogin(request: Request, env: Env) {
  const store = env.AUTH_SESSIONS;
  if (!store || !env.DISCORD_BOT_TOKEN)
    return Response.json(
      { error: "Discord login is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  const body = await jsonObject(request);
  if (!isString(body.token) || !/^[A-Za-z0-9_-]{43}$/.test(body.token))
    return Response.json(
      { error: "This login link is invalid. Run /login in Discord for a new one." },
      { status: 400 },
    );
  const userId = await store.loginUser(body.token);
  if (!userId)
    return Response.json(
      {
        error:
          "This login link has expired or was already used. Run /login in Discord for a new one.",
      },
      { status: 410 },
    );
  const viewer = await discordBotViewer(userId, env);
  if (!viewer) {
    await store.revokeLoginLink(body.token);
    return Response.json(
      { error: "Join Bunny's Discord and finish its membership checks before signing in." },
      { status: 403 },
    );
  }
  const session = await store.redeemLoginLink(body.token, viewer);
  if (!session)
    return Response.json(
      {
        error:
          "This login link has expired or was already used. Run /login in Discord for a new one.",
      },
      { status: 410 },
    );
  const previousToken = readCookie(request, "bp_session");
  if (previousToken) await store.revoke(previousToken);
  return Response.json(
    { ok: true },
    {
      headers: { "Set-Cookie": sessionCookie(session, undefined, isSecure(request)) },
    },
  );
}

export async function authRoutes(request: Request, env: Env, url: URL, metadata?: RequestMetadata) {
  if (url.pathname === "/auth/discord" && request.method === "GET") return beginLogin(request, env);
  if (url.pathname === "/auth/callback" && request.method === "GET")
    return finishLogin(request, env);
  if (url.pathname === "/api/login/discord" && request.method === "POST")
    return redeemDiscordLogin(request, env);

  if (url.pathname === "/api/session" && request.method === "GET") {
    const viewer = await viewerForRequest(request, env, metadata);
    if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const response = Response.json({
      user: {
        admin: viewer.admin,
        avatar: viewer.avatar,
        id: viewer.id,
        name: viewer.name,
        permissions: viewer.permissions,
      },
    } satisfies Session);
    const token = readCookie(request, "bp_session");
    if (token && (await env.AUTH_SESSIONS?.renew(token)))
      response.headers.set("Set-Cookie", sessionCookie(token, undefined, isSecure(request)));
    return response;
  }
  if (url.pathname === "/api/logout" && request.method === "POST") {
    const token = readCookie(request, "bp_session");
    if (token) await env.AUTH_SESSIONS?.revoke(token);
    return new Response(null, {
      headers: { "Set-Cookie": sessionCookie("", 0, isSecure(request)) },
      status: 204,
    });
  }
  return null;
}
