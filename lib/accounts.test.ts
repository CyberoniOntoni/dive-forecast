import { describe, expect, it } from "vitest";
import { ABOUT_MAX, deleteAccountRecords, LOGIN_CODE_TTL_MS, LOGIN_MAX_ATTEMPTS, LOGIN_SENDS_PER_EMAIL, finishLogin, normalizeEmail, requireAbout, requireNickname, startLogin } from "./accounts";
import type { StoreData } from "./types";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const same = (a: string, b: string) => a === b;

function emptyStore(): StoreData {
  return { reports: [], ratings: [], sites: [], users: [], logins: [], plans: [], flags: [] };
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
    const missing = finishLogin(store, "a@b.co", "h1", NOW + 1000, undefined, same, true);
    expect(missing).toMatchObject({ ok: false, needsNickname: true });
    const done = finishLogin(store, "a@b.co", "h1", NOW + 2000, "Manta", same, true);
    expect(done).toMatchObject({ ok: true, user: { email: "a@b.co", nickname: "Manta" } });
    expect(store.users).toHaveLength(1);
    // The code is used up.
    expect(finishLogin(store, "a@b.co", "h1", NOW + 3000, "Manta", same, true).ok).toBe(false);
    expect(startLogin(store, "a@b.co", "h2", NOW + 4000)).toEqual({ newUser: false });
    expect(finishLogin(store, "a@b.co", "h2", NOW + 5000, undefined, same, true)).toMatchObject({ ok: true });
  });

  it("ends a code after too many wrong tries, after it expires, or when a new one is sent", () => {
    const store = emptyStore();
    startLogin(store, "a@b.co", "h1", NOW);
    for (let index = 0; index < LOGIN_MAX_ATTEMPTS; index += 1) {
      expect(finishLogin(store, "a@b.co", "wrong", NOW, "Manta", same, true).ok).toBe(false);
    }
    expect(finishLogin(store, "a@b.co", "h1", NOW, "Manta", same, true).ok).toBe(false);

    startLogin(store, "a@b.co", "h2", NOW);
    expect(finishLogin(store, "a@b.co", "h2", NOW + LOGIN_CODE_TTL_MS + 1, "Manta", same, true).ok).toBe(false);

    startLogin(store, "a@b.co", "h3", NOW);
    startLogin(store, "a@b.co", "h4", NOW);
    expect(finishLogin(store, "a@b.co", "h3", NOW, "Manta", same, true).ok).toBe(false);
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

describe("deleteAccountRecords", () => {
  it("drops the diver's rows and photos, and keeps their reports and sites without their id", () => {
    const store = emptyStore();
    const photo = (id: string, addedBy: string) => ({ id, addedBy, addedAt: "2026-11-01T00:00:00Z" });
    store.users = [
      { id: "u1", email: "a@b.co", nickname: "Ann", createdAt: "" },
      { id: "u2", email: "c@d.co", nickname: "Bob", createdAt: "" },
    ];
    store.logins = [{ email: "a@b.co", codeHash: "h", sentAt: "", expiresAt: "", attempts: 0 }];
    store.plans = [
      { id: "p1", ownerId: "u1", title: "Mine", boatSpeedKn: 10, days: [], createdAt: "", updatedAt: "" },
      { id: "p2", ownerId: "u2", title: "Bob's", boatSpeedKn: 10, days: [], createdAt: "", updatedAt: "" },
    ];
    store.ratings = [
      { siteId: "s1", score: 5, updatedAt: "", userId: "u1", review: "Great", photos: [photo("r1", "u1")] },
      { siteId: "s1", score: 3, updatedAt: "", userId: "u2" },
    ];
    store.reports = [
      { id: "a", siteId: "s1", time: "2026-11-01T08:00", direction: "incoming", strength: "mild", userId: "u1" },
      { id: "b", siteId: "s1", time: "2026-11-01T09:00", direction: "incoming", strength: "mild", userId: "u1" },
      { id: "c", siteId: "s1", time: "2026-11-01T09:00", direction: "incoming", strength: "mild", userId: "u2" },
    ];
    store.sites = [
      { id: "s1", name: "Pin", atollId: "x", lat: 4, lon: 73, sourceUrl: "user", addedBy: "u1", photos: [photo("p1", "u1")] },
    ];

    const photos = deleteAccountRecords(store, "u1");
    expect(photos?.map((item) => `${item.siteId}/${item.photo.id}`).sort()).toEqual(["s1/p1", "s1/r1"]);
    expect(store.users.map((user) => user.id)).toEqual(["u2"]);
    expect(store.logins).toEqual([]);
    expect(store.plans.map((plan) => plan.id)).toEqual(["p2"]);
    expect(store.ratings).toEqual([{ siteId: "s1", score: 3, updatedAt: "", userId: "u2" }]);
    expect(store.sites[0].addedBy).toBeUndefined();
    expect(store.sites[0].photos).toBeUndefined();
    // Still one diver to the forecast, and no longer the deleted one.
    const [a, b, c] = store.reports.map((report) => report.userId);
    expect(a).toMatch(/^deleted-/);
    expect(b).toBe(a);
    expect(c).toBe("u2");
    expect(JSON.stringify(store)).not.toContain("u1");

    expect(deleteAccountRecords(store, "u1")).toBeNull();
  });
});
