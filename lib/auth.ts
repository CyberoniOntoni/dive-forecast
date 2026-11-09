import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { appSetting } from "./cloudflare";
import { SENDER_NAME } from "./login-email";
import type { MailgunConfig } from "./mailgun";
import { SIGN_IN_FIRST } from "./sign-in";
import { hashLoginCode, SESSION_MAX_AGE_S, signSession, verifySession, type Session } from "./session-token";
import { peekStore } from "./store";

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
    from: appSetting("MAILGUN_FROM") ?? `${SENDER_NAME} <login@${domain}>`,
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
  const session = token ? await verifySession(token, secret) : null;
  return session && !signedOutSince(session) ? session : null;
}

/**
 * Whether the diver chose "Sign out everywhere" after this cookie was issued. Read from the store when this request
 * has loaded it (every server action has, by ready()); a page that has not is checked again by the action it calls.
 */
function signedOutSince(session: Session): boolean {
  const user = peekStore()?.users.find((item) => item.id === session.userId);
  return user?.sessionsValidFrom != null && session.issuedAt < user.sessionsValidFrom;
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

/**
 * The request's IP address as an HMAC with the app secret, for the per-IP sign-in limit: the address itself is never
 * stored. Cloudflare sets CF-Connecting-IP; elsewhere the first X-Forwarded-For hop is used. Null when neither is set.
 */
export async function requestIpKey(secret: string): Promise<string | null> {
  const list = await fromRequest(headers);
  const ip = list?.get("cf-connecting-ip") ?? list?.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return null;
  return (await hashLoginCode("ip", ipGroup(ip), secret)).slice(0, 22);
}

/**
 * The address a limit counts by: an IPv4 address as it is, an IPv6 address by its /64 (the first four groups), since
 * one device or home gets a whole /64 and can pick a new address in it at will.
 */
export function ipGroup(ip: string): string {
  if (!ip.includes(":")) return ip;
  // An IPv4 address written as IPv6 (::ffff:203.0.113.5) is that IPv4 address.
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((group) => String(parseInt(group || "0", 16) || 0))
    .join(":")}::/64`;
}
