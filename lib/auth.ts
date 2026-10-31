import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { appSetting } from "./cloudflare";
import type { MailgunConfig } from "./mailgun";
import { SIGN_IN_FIRST } from "./sign-in";
import { SESSION_MAX_AGE_S, signSession, verifySession, type Session } from "./session-token";

/**
 * Who is signed in, from the signed session cookie. Settings: AUTH_SECRET (any long random string; signing in is off
 * in production without it) and APP_URL (such as https://50bar.app, for the link in the email).
 */

export const SESSION_COOKIE = "dc_session";
/** Outside production only, so `next dev` and tests sign in without setup. */
const DEV_SECRET = "dev-only-auth-secret-not-for-production";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** The signing secret, or null when sign-in is not set up. */
export function authSecret(): string | null {
  return appSetting("AUTH_SECRET") ?? (isProduction() ? null : DEV_SECRET);
}

/** Mailgun's settings, or null when they are not set. */
export function mailgunConfig(): MailgunConfig | null {
  const apiKey = appSetting("MAILGUN_API_KEY");
  const domain = appSetting("MAILGUN_DOMAIN");
  if (!apiKey || !domain) return null;
  return {
    apiKey,
    domain,
    from: appSetting("MAILGUN_FROM") ?? `Dive current <login@${domain}>`,
    region: appSetting("MAILGUN_REGION")?.toLowerCase() === "eu" ? "eu" : "us",
  };
}

/**
 * A request-time API (cookies, headers), or null outside a request (scripts). Next's own errors are let through:
 * swallowing the one it throws while prerendering would leave a page static that reads the request at run time.
 */
async function fromRequest<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/**
 * The site's own address for the emailed link. In production only APP_URL is trusted (a request's Host header could
 * point the link at another site); without it the email carries the code alone.
 */
export async function appUrl(): Promise<string | null> {
  const configured = appSetting("APP_URL");
  if (configured) return configured.replace(/\/+$/, "");
  if (isProduction()) return null;
  const list = await fromRequest(headers);
  const host = list?.get("host");
  return list && host ? `${list.get("x-forwarded-proto") ?? "http"}://${host}` : null;
}

/**
 * This request's signed-in diver, or null. Null too outside a request (scripts) or when sign-in is not set up.
 *
 * The cookie is read even when sign-in is not set up, and Next's own errors are let through: the build has no
 * AUTH_SECRET, so a page that skipped the read (or swallowed the error Next throws to mark it per-request) was
 * prerendered as static, and then failed with a 500 on the worker, where the secret is set and the cookie is read.
 */
export async function currentSession(): Promise<Session | null> {
  const jar = await fromRequest(cookies);
  if (!jar) return null;
  const token = jar.get(SESSION_COOKIE)?.value;
  const secret = authSecret();
  if (!secret) return null;
  return token ? verifySession(token, secret) : null;
}

export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error(SIGN_IN_FIRST);
  return session;
}

/** Only from a server action. */
export async function setSessionCookie(userId: string, nickname: string): Promise<void> {
  const secret = authSecret();
  if (!secret) throw new Error("Signing in is not set up yet.");
  const token = await signSession({ userId, nickname, issuedAt: Date.now() }, secret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

/** Only from a server action. */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
