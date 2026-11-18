import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteMe, GET as getMe } from "@/app/api/v1/me/route";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { POST as signOutEverywhere } from "@/app/api/v1/sign-out-everywhere/route";
import { GET as getReports, POST as postReport } from "@/app/api/v1/sites/[id]/reports/route";
import { completeSignIn, requestSignIn } from "@/lib/account-actions";
import { SESSION_COOKIE } from "@/lib/auth";
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
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

const site = (id: string) => ({ params: Promise.resolve({ id }) });

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

describe("API v1 sign-in", () => {
  it("trades an emailed code for a token, asking a new address for its nickname", async () => {
    const asked = await requestCode(call("/api/v1/sign-in/code", { body: { email: "Diver@Example.com" } }));
    expect(await asked.json()).toEqual({ apiVersion: 1, newUser: true });
    const code = codeFromEmail();
    // No web sign-in link: tapping it on the phone would use the code up in the browser.
    expect(sent[sent.length - 1].get("text")).not.toContain("/login?");

    const wrong = await getToken(call("/api/v1/sign-in/token", { body: { email: "diver@example.com", code: "000000" } }));
    expect(wrong.status).toBe(400);
    const noName = await getToken(call("/api/v1/sign-in/token", { body: { email: "diver@example.com", code, acceptTerms: true } }));
    expect(noName.status).toBe(400);
    expect((await noName.json()).error.code).toBe("needs_nickname");
    const ok = await getToken(call("/api/v1/sign-in/token", { body: { email: "diver@example.com", code, nickname: "Manta", acceptTerms: true } }));
    const { token } = await ok.json();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    // The diver's id is not readable from the token, encoded or not.
    const userId = readStore().users[0].id;
    expect(token).not.toContain(userId);
    expect(atob(token.slice(5).replace(/-/g, "+").replace(/_/g, "/"))).not.toContain(userId);

    const me = await getMe(call("/api/v1/me", { token }));
    const body = await me.json();
    expect(body).toMatchObject({ apiVersion: 1, nickname: "Manta", points: 0, reports: 0 });
    expect(JSON.stringify(body)).not.toContain("example.com");
    expect(JSON.stringify(body)).not.toContain(readStore().users[0].id);
  });

  it("refuses a bad email, a missing token and a forged one", async () => {
    const bad = await requestCode(call("/api/v1/sign-in/code", { body: { email: "not-an-email" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe("Enter a valid email address.");
    expect((await getMe(call("/api/v1/me"))).status).toBe(401);
    expect((await getMe(call("/api/v1/me", { token: "abc.def" }))).status).toBe(401);
  });

  it("only reads JSON bodies", async () => {
    const form = await requestCode(call("/api/v1/sign-in/code", { body: "email=a%40example.com", type: "text/plain" }));
    expect(form.status).toBe(415);
    const notObject = await requestCode(call("/api/v1/sign-in/code", { body: "[1]" }));
    expect(notObject.status).toBe(400);
  });

  it("ends the token when the diver signs out everywhere", async () => {
    const token = await signInApp("a@example.com", "Ann");
    vi.setSystemTime(new Date("2026-09-28T00:00:05Z"));
    expect((await signOutEverywhere(call("/api/v1/sign-out-everywhere", { body: {}, token }))).status).toBe(200);
    expect((await getMe(call("/api/v1/me", { token }))).status).toBe(401);
  });

  it("deletes the account with the app's token, and the token stops working", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const deleted = await deleteMe(call("/api/v1/me", { method: "DELETE", token }));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ apiVersion: 1, deleted: true });
    expect(readStore().users).toEqual([]);
    expect((await getMe(call("/api/v1/me", { token }))).status).toBe(401);
    expect((await deleteMe(call("/api/v1/me", { method: "DELETE", token }))).status).toBe(401);
    expect((await deleteMe(call("/api/v1/me", { method: "DELETE" }))).status).toBe(401);
  });
});

describe("API v1 reports", () => {
  it("files a report with the app's token and lists it, with the nickname only", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const saved = await postReport(
      call("/api/v1/sites/banana-reef/reports", {
        body: { time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" },
        token,
      }),
      site("banana-reef"),
    );
    expect(saved.status).toBe(201);
    const body = await saved.json();
    expect(body).toMatchObject({
      apiVersion: 1,
      report: { siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" },
      award: { points: expect.any(Number), reasons: expect.arrayContaining(["report"]), uncounted: null, line: expect.stringMatching(/^\+\d+ points: report 10/) },
    });
    expect(JSON.stringify(body)).not.toContain(readStore().users[0].id);

    const list = await getReports(call("/api/v1/sites/banana-reef/reports"), site("banana-reef"));
    const reports = await list.json();
    expect(reports.reports[0]).toMatchObject({ time: "2026-09-27T08:00", strength: "mild", by: "Ann" });
    expect(JSON.stringify(reports)).not.toContain(readStore().users[0].id);
  });

  it("refuses a report without a token, even from a signed-in browser", async () => {
    await requestSignIn("a@example.com");
    await completeSignIn({ email: "a@example.com", code: codeFromEmail(), nickname: "Ann", acceptTerms: true });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    const response = await postReport(
      call("/api/v1/sites/banana-reef/reports", { body: { time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" } }),
      site("banana-reef"),
    );
    expect(response.status).toBe(401);
    expect(readStore().reports.filter((report) => report.filedAt?.startsWith("2026-09-28"))).toEqual([]);
  });

  it("gives the form's own words for a bad report, and 404 for an unknown site", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const ahead = await postReport(
      call("/api/v1/sites/banana-reef/reports", { body: { time: "2026-10-05T08:00", direction: "outgoing", strength: "mild" }, token }),
      site("banana-reef"),
    );
    expect(ahead.status).toBe(400);
    expect((await ahead.json()).error.message).toEqual(expect.any(String));
    const unknown = await postReport(
      call("/api/v1/sites/nowhere/reports", { body: { time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" }, token }),
      site("nowhere"),
    );
    expect(unknown.status).toBe(404);
  });
});
