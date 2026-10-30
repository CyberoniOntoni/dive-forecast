/**
 * The signed-in cookie and sign-in code hashes: HMAC-SHA256 with the app's AUTH_SECRET, by Web Crypto, so the same
 * code runs on Node and on a worker. No session is stored anywhere: the cookie carries who you are, signed.
 */

/** A session cookie is good for this long after sign-in. */
export const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;

export type Session = { userId: string; nickname: string; issuedAt: number };

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Same length and same bytes, in time that does not depend on where they first differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** "payload.signature", both base64url. */
export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ u: session.userId, n: session.nickname, t: session.issuedAt })),
  );
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}

/** The session in a cookie value, or null when it is malformed, signed with another secret, or too old. */
export async function verifySession(token: string, secret: string, nowMs: number = Date.now()): Promise<Session | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!sameText(signature, toBase64Url(await hmac(secret, payload)))) return null;
  try {
    const bytes = fromBase64Url(payload);
    if (!bytes) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { u?: unknown; n?: unknown; t?: unknown };
    if (typeof parsed.u !== "string" || typeof parsed.n !== "string" || typeof parsed.t !== "number") return null;
    if (nowMs - parsed.t > SESSION_MAX_AGE_S * 1000 || parsed.t - nowMs > 60_000) return null;
    return { userId: parsed.u, nickname: parsed.n, issuedAt: parsed.t };
  } catch {
    return null;
  }
}

/** A sign-in code's stored form: tied to the email, so a hash from one address never opens another. */
export async function hashLoginCode(email: string, code: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(secret, `login:${email}:${code}`));
}

/** Six random digits. */
export function newLoginCode(): string {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, "0");
}
