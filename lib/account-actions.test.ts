import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeNickname, completeSignIn, getAccount, getLeaderboard, getSiteScouts, requestSignIn, whoAmI } from "./account-actions";
import { addReport, addSite } from "./actions";
import { SESSION_COOKIE } from "./auth";
import { readStore, setStorePath } from "./store";

const DATA_DIR = path.join(process.cwd(), "data");

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

let testFile = "";
let sent: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
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
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name === testFile || /^\.store\..+\.tmp$/.test(name)) fs.rmSync(path.join(DATA_DIR, name), { force: true });
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
    expect(await completeSignIn({ email: "diver@example.com", code })).toMatchObject({ ok: false, needsNickname: true });
    expect(await completeSignIn({ email: "diver@example.com", code, nickname: "Manta" })).toEqual({ ok: true, error: null });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await whoAmI()).toEqual({ nickname: "Manta" });

    await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    const board = await getLeaderboard("all");
    expect(board).toEqual([{ rank: 1, nickname: "Manta", points: 20, reports: 1, sites: 1, badges: 2, isMe: true }]);
    expect(JSON.stringify(board)).not.toContain("example.com");
    expect(await getAccount()).toMatchObject({ nickname: "Manta", email: "diver@example.com", allRank: 1 });
  });

  it("signs a known diver straight in, and lets them rename", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann" });
    await requestSignIn("b@example.com");
    await completeSignIn({ email: "b@example.com", code: codeFromEmail(), nickname: "Bob" });
    expect(await changeNickname("ann")).toMatchObject({ ok: false, error: "That nickname is taken." });
    expect(await changeNickname("Bobby")).toMatchObject({ ok: true, nickname: "Bobby" });
    expect(await whoAmI()).toEqual({ nickname: "Bobby" });

    jar.clear();
    expect(await requestSignIn("a@example.com")).toMatchObject({ ok: true, newUser: false });
    expect(await completeSignIn({ email: "a@example.com", code: codeFromEmail() })).toEqual({ ok: true, error: null });
    expect(await whoAmI()).toEqual({ nickname: "Ann" });
  });

  it("puts divers who add sites on the public site board, newest site first", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann" });
    const first = await addSite({ name: "Ann Thila", lat: 4.3, lon: 73.5 });
    const second = await addSite({ name: "Ann Corner", lat: 4.31, lon: 73.51 });
    await requestSignIn("b@example.com");
    await completeSignIn({ email: "b@example.com", code: codeFromEmail(), nickname: "Bob" });
    await addReport({ siteId: first.id, time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });

    jar.clear();
    const board = await getSiteScouts();
    expect(board.scouts).toEqual([{ rank: 1, nickname: "Ann", sites: 2, reportedByOthers: 1, isMe: false }]);
    expect(board.newest).toEqual([
      { id: second.id, name: "Ann Corner", nickname: "Ann" },
      { id: first.id, name: "Ann Thila", nickname: "Ann" },
    ]);
    expect(JSON.stringify(board)).not.toContain("example.com");
  });

  it("says so when the email cannot be sent", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const result = await requestSignIn("a@example.com");
    expect(result).toMatchObject({ ok: false, error: "Could not send the email. Try again in a minute." });
  });
});
