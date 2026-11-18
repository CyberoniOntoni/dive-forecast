import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeAbout,
  changeNickname,
  completeSignIn,
  deleteAccount,
  getAccount,
  getDiverProfile,
  getLeaderboard,
  getSiteScouts,
  requestSignIn,
  signOutEverywhere,
  whoAmI,
} from "./account-actions";
import { addReport, addSite, getRating, getRecentReports, rateSite } from "./actions";
import { SESSION_COOKIE } from "./auth";
import { forecastReportsForSite, mutateStore, readStore, setStorePath } from "./store";
import { TERMS_FIRST } from "./moderation";

const DATA_DIR = path.join(process.cwd(), "data");

const jar = vi.hoisted(() => new Map<string, string>());
/** The connection's address as Cloudflare would give it; empty for none. */
const client = vi.hoisted(() => ({ ip: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ host: "localhost:3000", ...(client.ip ? { "cf-connecting-ip": client.ip } : {}) }),
}));

let testFile = "";
let sent: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  // The day after the fixture reports' dives, so they are inside the reporting window.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T00:00:00Z") });
  client.ip = "";
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStorePath(testFile);
  jar.clear();
  sent = [];
  vi.stubEnv("MAILGUN_API_KEY", "key-test");
  vi.stubEnv("MAILGUN_DOMAIN", "mg.example.com");
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    sent.push(init.body as URLSearchParams);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  for (const name of fs.readdirSync(DATA_DIR)) {
    // Only this process's temp files: another test file's worker may be mid-write to its own.
    if (name === testFile || (name.startsWith(`.store.${process.pid}.`) && name.endsWith(".tmp"))) {
      fs.rmSync(path.join(DATA_DIR, name), { force: true });
    }
  }
  setStorePath("store.json");
});

function codeFromEmail(index = sent.length - 1): string {
  return /code is (\d{6})/.exec(sent[index].get("text") ?? "")![1];
}

describe("sign in by email code", () => {
  it("emails a code and a link, signs a new diver up with a nickname, and never shows the email publicly", async () => {
    expect(await requestSignIn(" Diver@Example.com ", "/sites/banana-reef")).toEqual({ ok: true, error: null, newUser: true });
    expect(sent[0].get("to")).toBe("diver@example.com");
    const code = codeFromEmail();
    expect(sent[0].get("text")).toContain(
      `http://localhost:3000/login?email=diver%40example.com&code=${code}&next=%2Fsites%2Fbanana-reef`,
    );
    expect(JSON.stringify(readStore().logins)).not.toContain(code);

    expect(await completeSignIn({ email: "diver@example.com", code: "000000" })).toMatchObject({ ok: false });
    expect(await completeSignIn({ email: "diver@example.com", code, acceptTerms: true })).toMatchObject({ ok: false, needsNickname: true });
    expect(await completeSignIn({ email: "diver@example.com", code, nickname: "Manta", acceptTerms: true })).toEqual({ ok: true, error: null });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await whoAmI()).toEqual({ nickname: "Manta" });

    await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    const board = await getLeaderboard("all");
    expect(board).toEqual([{ userId: expect.any(String), rank: 1, nickname: "Manta", points: 20, reports: 1, ratings: 0, sites: 1, badges: 2, isMe: true }]);
    expect(JSON.stringify(board)).not.toContain("example.com");
    await rateSite("banana-reef", 5);
    expect((await getLeaderboard("all"))[0]).toMatchObject({ points: 23, ratings: 1 });
    expect(await getAccount()).toMatchObject({ nickname: "Manta", email: "diver@example.com", allRank: 1 });
  });

  it("signs the store-review address in with its fixed code, sends no email, and never makes it a moderator", async () => {
    vi.stubEnv("REVIEW_EMAIL", "Review@50bar.app");
    vi.stubEnv("REVIEW_CODE", "246810");
    vi.stubEnv("MODERATOR_EMAILS", "review@50bar.app");
    expect(await requestSignIn("review@50bar.app")).toMatchObject({ ok: true, newUser: true });
    expect(sent).toHaveLength(0);
    expect(await completeSignIn({ email: "review@50bar.app", code: "135791", nickname: "Play Review", acceptTerms: true })).toMatchObject({
      ok: false,
      error: "That code is not right.",
    });
    expect(await completeSignIn({ email: "review@50bar.app", code: "246810", nickname: "Play Review", acceptTerms: true })).toEqual({
      ok: true,
      error: null,
    });
    expect(await getAccount()).toMatchObject({ nickname: "Play Review", moderator: false });

    // A reviewer trying the report form: the report is saved, but it does not teach the forecast, earn points or
    // put the account on the public scoreboard.
    const reviewer = (await getAccount())!.userId;
    expect(await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" })).toMatchObject({
      userId: reviewer,
    });
    expect(forecastReportsForSite("banana-reef").some((item) => item.userId === reviewer)).toBe(false);
    expect((await getAccount())?.stats.points).toBe(0);
    await rateSite("banana-reef", 1);
    expect(await getRating("banana-reef")).toMatchObject({ count: 1, mine: 1 });
    expect((await getRecentReports("banana-reef", "channel")).map((row) => row.by)).toEqual(["Play Review"]);
    expect(await getLeaderboard("all")).toEqual([]);

    // Moving the review account to another address, or turning it off, never lets its old reports back in.
    vi.stubEnv("REVIEW_EMAIL", "review-other@50bar.app");
    expect(forecastReportsForSite("banana-reef").some((item) => item.userId === reviewer)).toBe(false);
    vi.stubEnv("REVIEW_EMAIL", "Review@50bar.app");

    // Any other address still gets a fresh emailed code, never the review one; and a real diver reporting after the
    // reviewer at the same site still earns the full points (the reviewer's report took no bonus from them).
    jar.clear();
    await requestSignIn("other@example.com");
    expect(sent).toHaveLength(1);
    expect(codeFromEmail()).not.toBe("246810");
    await completeSignIn({ email: "other@example.com", code: codeFromEmail(), nickname: "Bob", acceptTerms: true });
    await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    expect(await getLeaderboard("all")).toMatchObject([{ nickname: "Bob", points: 20, reports: 1 }]);
    // Divers never see the reviewer's made-up report or rating; the reviewer sees its own.
    expect((await getRecentReports("banana-reef", "channel")).map((row) => row.by)).toEqual(["Bob"]);
    expect(await getRating("banana-reef")).toMatchObject({ count: 0 });
    expect(await getDiverProfile(reviewer)).toBeNull();

    // A reviewer trying "Delete account" takes its test reports with it, rather than leaving them anonymised.
    jar.clear();
    await requestSignIn("review@50bar.app");
    await completeSignIn({ email: "review@50bar.app", code: "246810" });
    expect((await getAccount())!.userId).toBe(reviewer);
    expect(await getDiverProfile(reviewer)).toMatchObject({ nickname: "Play Review" });
    const testSite = await addSite({ name: "Review Thila", lat: 4.3, lon: 73.5 });
    expect(await deleteAccount()).toEqual({ ok: true, error: null });
    expect(readStore().sites.find((site) => site.id === testSite.id)).toMatchObject({ hidden: true });
    expect(readStore().reports.filter((item) => item.siteId === "banana-reef").map((item) => item.userId)).not.toContain(reviewer);
    expect(readStore().reports.filter((item) => item.siteId === "banana-reef")).toHaveLength(1);

    // Turned off by removing the code: the review address is then an ordinary address.
    vi.stubEnv("REVIEW_CODE", "");
    await requestSignIn("review@50bar.app");
    expect(sent).toHaveLength(2);
  });

  it("signs a known diver straight in, and lets them rename", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    await requestSignIn("b@example.com");
    await completeSignIn({ email: "b@example.com", code: codeFromEmail(), nickname: "Bob", acceptTerms: true });
    expect(await changeNickname("ann")).toMatchObject({ ok: false, error: "That nickname is taken." });
    // A diver from before the content rules agrees to them before renaming.
    await mutateStore((store) => {
      delete store.users.find((user) => user.nickname === "Bob")!.acceptedTermsAt;
    });
    expect(await changeNickname("Bobby")).toMatchObject({ ok: false, error: TERMS_FIRST });
    await mutateStore((store) => {
      store.users.find((user) => user.nickname === "Bob")!.acceptedTermsAt = "2026-11-18T00:00:00Z";
    });
    expect(await changeNickname("Bobby")).toMatchObject({ ok: true, nickname: "Bobby" });
    expect(await whoAmI()).toEqual({ nickname: "Bobby" });

    jar.clear();
    expect(await requestSignIn("a@example.com")).toMatchObject({ ok: true, newUser: false });
    expect(await completeSignIn({ email: "a@example.com", code: codeFromEmail(), acceptTerms: true })).toEqual({ ok: true, error: null });
    expect(await whoAmI()).toEqual({ nickname: "Ann" });
  });

  it("puts divers who add sites on the public site board, newest site first", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    const first = await addSite({ name: "Ann Thila", lat: 4.3, lon: 73.5 });
    const second = await addSite({ name: "Ann Corner", lat: 4.31, lon: 73.51 });
    await requestSignIn("b@example.com");
    await completeSignIn({ email: "b@example.com", code: codeFromEmail(), nickname: "Bob", acceptTerms: true });
    await addReport({ siteId: first.id, time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });

    jar.clear();
    const board = await getSiteScouts();
    expect(board.scouts).toEqual([{ userId: expect.any(String), rank: 1, nickname: "Ann", sites: 2, reportedByOthers: 1, isMe: false }]);
    expect(board.newest).toEqual([
      { id: second.id, name: "Ann Corner", userId: board.scouts[0].userId, nickname: "Ann" },
      { id: first.id, name: "Ann Thila", userId: board.scouts[0].userId, nickname: "Ann" },
    ]);
    expect(JSON.stringify(board)).not.toContain("example.com");
  });

  it("shows a diver's About me and numbers on their public page, never the email", async () => {
    expect(await changeAbout("Hi")).toMatchObject({ ok: false });
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    expect(await changeAbout("  Guide in Maafushi, mantas please.  ")).toEqual({
      ok: true,
      error: null,
      about: "Guide in Maafushi, mantas please.",
    });
    await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    const userId = (await getAccount())!.userId;

    jar.clear();
    const profile = await getDiverProfile(userId);
    expect(profile).toMatchObject({
      nickname: "Ann",
      about: "Guide in Maafushi, mantas please.",
      stats: { reports: 1, points: 20 },
      allRank: 1,
      isMe: false,
    });
    expect(profile!.badges.map((badge) => badge.id)).toContain("first-report");
    expect(JSON.stringify(profile)).not.toContain("example.com");
    expect(await getDiverProfile("nobody")).toBeNull();
  });

  it("says so when the email cannot be sent", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const result = await requestSignIn("a@example.com");
    expect(result).toMatchObject({ ok: false, error: "Could not send the email. Try again in a minute." });
  });
});

describe("deleting an account", () => {
  it("removes the diver, keeps their reports without a name, and ends every session", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    const otherDevice = jar.get(SESSION_COOKIE)!;
    const userId = (await getAccount())!.userId;
    await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    await rateSite("banana-reef", 5);

    expect(await deleteAccount()).toEqual({ ok: true, error: null });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const store = readStore();
    expect(JSON.stringify(store)).not.toContain("a@example.com");
    expect(JSON.stringify(store)).not.toContain(userId);
    expect(store.users).toEqual([]);
    expect(store.ratings).toEqual([]);
    expect(store.reports).toHaveLength(1);
    expect(store.reports[0].userId).toMatch(/^deleted-/);
    expect(await getLeaderboard("all")).toEqual([]);

    // A copy of the cookie from before no longer signs anyone in.
    jar.set(SESSION_COOKIE, otherDevice);
    expect(await getAccount()).toBeNull();
    expect(await deleteAccount()).toMatchObject({ ok: false });
    await expect(rateSite("banana-reef", 4)).rejects.toThrow("Sign in first.");

    // The address can sign up again, as a new diver.
    jar.clear();
    expect(await requestSignIn("a@example.com")).toMatchObject({ ok: true, newUser: true });
  });
});

describe("sign-in limits and sessions", () => {
  it("caps the codes one connection can ask for in an hour, whatever the address", async () => {
    client.ip = "203.0.113.5";
    for (let index = 0; index < 30; index += 1) {
      expect(await requestSignIn(`diver${index}@example.com`)).toMatchObject({ ok: true });
    }
    expect(await requestSignIn("another@example.com")).toMatchObject({ ok: false, error: expect.stringContaining("this connection") });
    // The address itself is never kept, only its HMAC.
    expect(JSON.stringify(readStore().logins)).not.toContain("203.0.113.5");
    client.ip = "198.51.100.7";
    expect(await requestSignIn("another@example.com")).toMatchObject({ ok: true });
  });

  it("signs a diver out on every device, and a new sign-in works again", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    const otherDevice = jar.get(SESSION_COOKIE)!;
    vi.setSystemTime(new Date("2026-09-28T00:00:01Z"));
    expect(await signOutEverywhere()).toEqual({ ok: true, error: null });
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    jar.set(SESSION_COOKIE, otherDevice);
    expect(await getAccount()).toBeNull();
    await expect(rateSite("banana-reef", 4)).rejects.toThrow("Sign in first.");

    vi.setSystemTime(new Date("2026-09-28T00:00:02Z"));
    jar.clear();
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), acceptTerms: true });
    expect(await getAccount()).toMatchObject({ nickname: "Ann" });
  });
});
