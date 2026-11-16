import { describe, expect, it } from "vitest";
import {
  hashLoginCode,
  newLoginCode,
  openSession,
  sealSession,
  SESSION_MAX_AGE_S,
  signSession,
  verifySession,
} from "./session-token";

const SECRET = "test-secret";

describe("session token", () => {
  it("round-trips a session, including a nickname outside ASCII", async () => {
    const session = { userId: "u1", nickname: "Мантa 🐟", issuedAt: Date.now() };
    expect(await verifySession(await signSession(session, SECRET), SECRET)).toEqual(session);
  });

  it("refuses another secret, a changed payload, and an expired token", async () => {
    const now = Date.now();
    const token = await signSession({ userId: "u1", nickname: "a", issuedAt: now }, SECRET);
    expect(await verifySession(token, "other")).toBeNull();
    const [, signature] = token.split(".");
    const forged = `${btoa(JSON.stringify({ u: "admin", n: "a", t: now })).replace(/=+$/, "")}.${signature}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
    expect(await verifySession(token, SECRET, now + (SESSION_MAX_AGE_S + 1) * 1000)).toBeNull();
    expect(await verifySession("garbage", SECRET)).toBeNull();
    expect(await verifySession(`${token}.extra`, SECRET)).toBeNull();
  });

  it("hashes a code per address", async () => {
    expect(await hashLoginCode("a@b.co", "123456", SECRET)).toBe(await hashLoginCode("a@b.co", "123456", SECRET));
    expect(await hashLoginCode("a@b.co", "123456", SECRET)).not.toBe(await hashLoginCode("c@b.co", "123456", SECRET));
  });

  it("makes six-digit codes", () => {
    for (let index = 0; index < 50; index += 1) expect(newLoginCode()).toMatch(/^\d{6}$/);
  });
});

describe("app token", () => {
  it("round-trips a session without showing the diver's id", async () => {
    const session = { userId: "user-3f9a", nickname: "Manta", issuedAt: Date.now() };
    const token = await sealSession(session, SECRET);
    expect(token.startsWith("app1.")).toBe(true);
    const decoded = atob(token.slice(5).replace(/-/g, "+").replace(/_/g, "/"));
    expect(decoded).not.toContain("user-3f9a");
    expect(decoded).not.toContain("Manta");
    expect(await openSession(token, SECRET)).toEqual(session);
  });

  it("refuses another secret, a changed byte, a cookie value, and an expired token", async () => {
    const now = Date.now();
    const session = { userId: "u1", nickname: "a", issuedAt: now };
    const token = await sealSession(session, SECRET);
    expect(await openSession(token, "other")).toBeNull();
    // A middle character: the last one can carry only padding bits.
    const at = 20;
    const changed = token.slice(0, at) + (token[at] === "A" ? "B" : "A") + token.slice(at + 1);
    expect(await openSession(changed, SECRET)).toBeNull();
    expect(await openSession(await signSession(session, SECRET), SECRET)).toBeNull();
    expect(await verifySession(token, SECRET)).toBeNull();
    expect(await openSession(token, SECRET, now + (SESSION_MAX_AGE_S + 1) * 1000)).toBeNull();
    expect(await openSession("app1.", SECRET)).toBeNull();
    expect(await openSession("app1.!!", SECRET)).toBeNull();
  });
});
