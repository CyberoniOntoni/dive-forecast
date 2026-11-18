import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { POST as addSite } from "@/app/api/v1/sites/route";
import { PUT as rate } from "@/app/api/v1/sites/[id]/rating/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { PUT as putAbout } from "@/app/api/v1/me/about/route";
import { PUT as putNickname } from "@/app/api/v1/me/nickname/route";
import { GET as getScoreboard } from "@/app/api/v1/scoreboard/route";
import { GET as getDiver } from "@/app/api/v1/divers/[nickname]/route";
import { readStore, setStorePath } from "@/lib/store";

const DATA_DIR = path.join(process.cwd(), "data");

/** The request's cookies and headers, as next/headers reads them in a route handler. */
const jar = vi.hoisted(() => new Map<string, string>());
const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => incoming.headers,
}));

let testFile = "";
let sent: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T00:00:00Z") });
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStorePath(testFile);
  jar.clear();
  incoming.headers = new Headers();
  sent = [];
  vi.stubEnv("MAILGUN_API_KEY", "key-test");
  vi.stubEnv("MAILGUN_DOMAIN", "mg.example.com");
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(init.body as URLSearchParams);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name === testFile || (name.startsWith(`.store.${process.pid}.`) && name.endsWith(".tmp"))) {
      fs.rmSync(path.join(DATA_DIR, name), { force: true });
    }
  }
  setStorePath("store.json");
});

/** A request as the app sends it; next/headers sees the same headers, as in a real route handler. */
function call(url: string, init: { method?: string; body?: unknown; token?: string; type?: string } = {}): Request {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", init.type ?? "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  incoming.headers = headers;
  return new Request(`https://50bar.app${url}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string" || init.body instanceof Uint8Array
          ? (init.body as BodyInit)
          : JSON.stringify(init.body),
  });
}

const site = (id: string) => ({ params: Promise.resolve({ id }) });
const diver = (nickname: string) => ({ params: Promise.resolve({ nickname }) });

function codeFromEmail(): string {
  return /code is (\d{6})/.exec(sent[sent.length - 1].get("text") ?? "")![1];
}

async function signInApp(email: string, nickname: string): Promise<string> {
  const asked = await requestCode(call("/api/v1/sign-in/code", { body: { email } }));
  expect(asked.status).toBe(200);
  const response = await getToken(call("/api/v1/sign-in/token", { body: { email, code: codeFromEmail(), nickname, acceptTerms: true } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ apiVersion: 1, nickname, token: expect.any(String), expiresAt: expect.any(Number) });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return body.token;
}


async function annWithPoints(): Promise<string> {
  const token = await signInApp("a@example.com", "Ann");
  expect((await rate(call("/api/v1/sites/banana-reef/rating", { method: "PUT", body: { score: 4 }, token }), site("banana-reef"))).status).toBe(200);
  return token;
}

describe("API v1 scoreboard, divers' pages and the account", () => {
  it("shows the boards by nickname, marking the diver's own row only with their token", async () => {
    const token = await annWithPoints();
    const open = await getScoreboard(call("/api/v1/scoreboard?board=all"));
    expect(open.status).toBe(200);
    expect(open.headers.get("cache-control")).toBe("private, max-age=60");
    const board = await open.json();
    expect(board).toMatchObject({ board: "all", title: "Current reporters", newest: [] });
    expect(board.rows).toEqual([{ rank: 1, nickname: "Ann", detail: "1 rating", score: 3, unit: null, isMe: false }]);
    expect(JSON.stringify(board)).not.toMatch(/userId|example\.com/);

    const mine = await getScoreboard(call("/api/v1/scoreboard?board=all", { token }));
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect((await mine.json()).rows[0].isMe).toBe(true);
    expect((await getScoreboard(call("/api/v1/scoreboard", { token: "not-a-token" }))).status).toBe(401);

    const { site: added } = await (await addSite(call("/api/v1/sites", { token, body: { name: "Test Thila", lat: 4.25, lon: 73.45 } }))).json();
    const sites = await (await getScoreboard(call("/api/v1/scoreboard?board=sites"))).json();
    expect(sites).toMatchObject({ board: "sites", title: "Site scouts" });
    expect(sites.rows).toEqual([{ rank: 1, nickname: "Ann", detail: "0 reported by other divers", score: 1, unit: "site", isMe: false }]);
    expect(sites.newest).toEqual([{ siteId: added.id, name: "Test Thila", nickname: "Ann" }]);
  });

  it("opens a diver's page by nickname, in any case, without their id or email", async () => {
    const token = await annWithPoints();
    const page = await getDiver(call("/api/v1/divers/ann"), diver("ann"));
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body).toMatchObject({ nickname: "Ann", about: "", points: 3, ratings: 1, sitesAdded: 0, allRank: 1, isMe: false });
    expect(body.sinceLine).toBe("Diving with us since Sep 2026 · #1 all time");
    expect(JSON.stringify(body)).not.toMatch(/userId|"id":"user|example\.com/);
    expect((await (await getDiver(call("/api/v1/divers/Ann", { token }), diver("Ann"))).json()).isMe).toBe(true);
    expect((await getDiver(call("/api/v1/divers/nobody"), diver("nobody"))).status).toBe(404);
    await signInApp("c@example.com", "Big Manta");
    expect((await (await getDiver(call("/api/v1/divers/Big%20Manta"), diver("Big%20Manta"))).json()).nickname).toBe("Big Manta");
    expect((await getDiver(call("/api/v1/divers/big manta"), diver("big manta"))).status).toBe(200);
  });

  it("saves About me and a new nickname, as the web's account page does", async () => {
    const token = await annWithPoints();
    expect((await putAbout(call("/api/v1/me/about", { method: "PUT", body: { about: "Hi" } }))).status).toBe(401);
    const saved = await putAbout(call("/api/v1/me/about", { method: "PUT", token, body: { about: "  Guide on a liveaboard.  " } }));
    expect(await saved.json()).toEqual({ apiVersion: 1, about: "Guide on a liveaboard." });
    const long = await putAbout(call("/api/v1/me/about", { method: "PUT", token, body: { about: "x".repeat(301) } }));
    expect((await long.json()).error.message).toBe("Keep it to 300 characters.");

    const me = await (await getMe(call("/api/v1/me", { token }))).json();
    expect(me).toMatchObject({ nickname: "Ann", about: "Guide on a liveaboard.", ratings: 1, aboutMaxChars: 300 });
    expect(me.badges.length).toBeGreaterThan(5);
    expect(me.badges.find((badge: { id: string }) => badge.id === "first-report")).toMatchObject({ earned: false });
    expect(me.pointsRules[0]).toMatch(/points for each current report/);

    jar.clear();
    const renamed = await putNickname(call("/api/v1/me/nickname", { method: "PUT", token, body: { nickname: "Annie" } }));
    expect(await renamed.json()).toEqual({ apiVersion: 1, nickname: "Annie" });
    // The app's token keeps working; no web cookie is set on an API answer.
    expect(jar.size).toBe(0);
    expect((await (await getMe(call("/api/v1/me", { token }))).json()).nickname).toBe("Annie");
    expect((await getDiver(call("/api/v1/divers/ann"), diver("ann"))).status).toBe(404);
    expect((await (await getDiver(call("/api/v1/divers/annie"), diver("annie"))).json()).about).toBe("Guide on a liveaboard.");

    const bo = await signInApp("b@example.com", "Bo");
    const taken = await putNickname(call("/api/v1/me/nickname", { method: "PUT", token: bo, body: { nickname: "annie" } }));
    expect(taken.status).toBe(400);
    expect((await taken.json()).error.message).toBe("That nickname is taken.");
  });
});
