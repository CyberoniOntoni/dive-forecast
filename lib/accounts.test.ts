import { describe, expect, it } from "vitest";
import { ABOUT_MAX, LOGIN_CODE_TTL_MS, LOGIN_MAX_ATTEMPTS, LOGIN_SENDS_PER_EMAIL, finishLogin, normalizeEmail, requireAbout, requireNickname, startLogin } from "./accounts";
import type { StoreData } from "./types";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const same = (a: string, b: string) => a === b;

function emptyStore(): StoreData {
  return { reports: [], ratings: [], sites: [], users: [], logins: [] };
}

describe("normalizeEmail", () => {
  it("trims and lower-cases, and refuses what is not an address", () => {
    expect(normalizeEmail("  Diver@Example.COM ")).toBe("diver@example.com");
    expect(() => normalizeEmail("diver")).toThrow();
    expect(() => normalizeEmail(null)).toThrow();
  });
});

describe("requireNickname", () => {
  const users = [{ id: "u1", email: "a@b.co", nickname: "Manta", createdAt: "" }];

  it("accepts short names and collapses spaces", () => {
    expect(requireNickname("  Reef   Shark ", users)).toBe("Reef Shark");
    expect(requireNickname("Ната_1", users)).toBe("Ната_1");
  });

  it("refuses emails, too short or long, and a name taken in any case", () => {
    expect(() => requireNickname("a@b.co", users)).toThrow();
    expect(() => requireNickname("a", users)).toThrow();
    expect(() => requireNickname("x".repeat(21), users)).toThrow();
    expect(() => requireNickname("mANTA", users)).toThrow("taken");
    expect(requireNickname("MANTA", users, "u1")).toBe("MANTA");
  });
});

describe("sign-in codes", () => {
  it("signs a new address up with its nickname, once", () => {
    const store = emptyStore();
    expect(startLogin(store, "a@b.co", "h1", NOW)).toEqual({ newUser: true });
    const missing = finishLogin(store, "a@b.co", "h1", NOW + 1000, undefined, same);
    expect(missing).toMatchObject({ ok: false, needsNickname: true });
    const done = finishLogin(store, "a@b.co", "h1", NOW + 2000, "Manta", same);
    expect(done).toMatchObject({ ok: true, user: { email: "a@b.co", nickname: "Manta" } });
    expect(store.users).toHaveLength(1);
    // The code is used up.
    expect(finishLogin(store, "a@b.co", "h1", NOW + 3000, "Manta", same).ok).toBe(false);
    expect(startLogin(store, "a@b.co", "h2", NOW + 4000)).toEqual({ newUser: false });
    expect(finishLogin(store, "a@b.co", "h2", NOW + 5000, undefined, same)).toMatchObject({ ok: true });
  });

  it("ends a code after too many wrong tries, after it expires, or when a new one is sent", () => {
    const store = emptyStore();
    startLogin(store, "a@b.co", "h1", NOW);
    for (let index = 0; index < LOGIN_MAX_ATTEMPTS; index += 1) {
      expect(finishLogin(store, "a@b.co", "wrong", NOW, "Manta", same).ok).toBe(false);
    }
    expect(finishLogin(store, "a@b.co", "h1", NOW, "Manta", same).ok).toBe(false);

    startLogin(store, "a@b.co", "h2", NOW);
    expect(finishLogin(store, "a@b.co", "h2", NOW + LOGIN_CODE_TTL_MS + 1, "Manta", same).ok).toBe(false);

    startLogin(store, "a@b.co", "h3", NOW);
    startLogin(store, "a@b.co", "h4", NOW);
    expect(finishLogin(store, "a@b.co", "h3", NOW, "Manta", same).ok).toBe(false);
  });

  it("caps codes per address per hour", () => {
    const store = emptyStore();
    for (let index = 0; index < LOGIN_SENDS_PER_EMAIL; index += 1) startLogin(store, "a@b.co", `h${index}`, NOW);
    expect(() => startLogin(store, "a@b.co", "hx", NOW)).toThrow();
    expect(() => startLogin(store, "c@b.co", "hx", NOW)).not.toThrow();
    expect(() => startLogin(store, "a@b.co", "hy", NOW + 61 * 60 * 1000)).not.toThrow();
  });
});

describe("requireAbout", () => {
  it("keeps plain text, trims it, drops control characters and long gaps, and caps the length", () => {
    expect(requireAbout("  Dive guide in Maafushi.\r\n\n\n\nMantas!\u0007  ")).toBe("Dive guide in Maafushi.\n\nMantas!");
    expect(requireAbout("")).toBe("");
    expect(requireAbout(undefined)).toBe("");
    expect(() => requireAbout("x".repeat(ABOUT_MAX + 1))).toThrow(/characters/);
    expect(() => requireAbout(42)).toThrow();
  });
});
