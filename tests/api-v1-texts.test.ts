import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { GET as getTexts, POST as proposeTexts } from "@/app/api/v1/sites/[id]/texts/route";
import { DELETE as withdraw } from "@/app/api/v1/sites/[id]/texts/[editId]/route";
import { apiSiteTextsResult } from "@/lib/api-v1";
import { reviewEdit, revertEdit } from "@/lib/site-wiki";
import { EDIT_ALREADY_LOOKED_AT } from "@/lib/site-wiki-limits";
import { mutateStore, readStore, setStoreDir } from "@/lib/store";

/** A throwaway store folder: tests never write into data/. */
let storeDir = "";

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

let sent: URLSearchParams[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T00:00:00Z") });
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-texts-"));
  setStoreDir(storeDir);
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
  setStoreDir(null);
  fs.rmSync(storeDir, { recursive: true, force: true });
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

const SITE = "banana-reef";
const edit = (id: string, editId: string) => ({ params: Promise.resolve({ id, editId }) });

describe("API v1 site texts", () => {
  it("reads the form, proposes, changes and withdraws an edit, with no diver id in any answer", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const userId = readStore().users[0].id;

    const form = await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token }), site(SITE));
    expect(form.status).toBe(200);
    expect(form.headers.get("cache-control")).toBe("private, no-store");
    const first = await form.json();
    expect(first).toMatchObject({
      apiVersion: 1,
      siteId: SITE,
      canEdit: true,
      needsTerms: false,
      moderator: false,
      adderTextHidden: false,
      mine: null,
      live: false,
      limits: { description: 2000, howToDive: 1500, note: 300 },
    });

    const sent = await proposeTexts(
      call(`/api/v1/sites/${SITE}/texts`, {
        token,
        body: { texts: { description: "A sandy slope with a cleaning station." }, based: first.texts, note: "Dived it last week." },
      }),
      site(SITE),
    );
    expect(sent.status).toBe(200);
    const proposed = await sent.json();
    expect(proposed.mine).toMatchObject({ status: "pending", changes: { description: "A sandy slope with a cleaning station." }, note: "Dived it last week." });
    expect(proposed.texts).toEqual(first.texts);
    expect(JSON.stringify(proposed)).not.toContain(userId);

    // Sending again while it waits changes the same edit.
    const again = await proposeTexts(
      call(`/api/v1/sites/${SITE}/texts`, { token, body: { texts: { howToDive: "Drop on the north side." }, based: first.texts } }),
      site(SITE),
    );
    const changed = await again.json();
    expect(changed.mine.id).toBe(proposed.mine.id);
    expect(changed.mine.changes).toEqual({ description: "A sandy slope with a cleaning station.", howToDive: "Drop on the north side." });
    expect(readStore().siteEdits).toHaveLength(1);

    // An edit id on another site is not found there.
    const elsewhere = await withdraw(call(`/api/v1/sites/maaya-thila/texts/${proposed.mine.id}`, { method: "DELETE", token }), edit("maaya-thila", proposed.mine.id));
    expect(elsewhere.status).toBe(404);

    // Another diver cannot withdraw it, and is not told it exists.
    const other = await signInApp("c@example.com", "Cy");
    const theirs = await withdraw(call(`/api/v1/sites/${SITE}/texts/${proposed.mine.id}`, { method: "DELETE", token: other }), edit(SITE, proposed.mine.id));
    expect(theirs.status).toBe(404);
    expect(readStore().siteEdits).toHaveLength(1);

    const gone = await withdraw(call(`/api/v1/sites/${SITE}/texts/${proposed.mine.id}`, { method: "DELETE", token }), edit(SITE, proposed.mine.id));
    expect(gone.status).toBe(200);
    expect((await gone.json()).mine).toBeNull();
    expect(readStore().siteEdits).toHaveLength(0);

    const twice = await withdraw(call(`/api/v1/sites/${SITE}/texts/${proposed.mine.id}`, { method: "DELETE", token }), edit(SITE, proposed.mine.id));
    expect(twice.status).toBe(404);
  });

  it("needs a token, refuses with the form's words, and 404s an unknown site", async () => {
    expect((await getTexts(call(`/api/v1/sites/${SITE}/texts`), site(SITE))).status).toBe(401);
    expect((await proposeTexts(call(`/api/v1/sites/${SITE}/texts`, { body: { texts: { description: "x" } } }), site(SITE))).status).toBe(401);
    expect((await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token: "app1.nonsense" }), site(SITE))).status).toBe(401);

    const token = await signInApp("b@example.com", "Bob");
    expect((await getTexts(call("/api/v1/sites/no-such-site/texts", { token }), site("no-such-site"))).status).toBe(404);

    const empty = await proposeTexts(call(`/api/v1/sites/${SITE}/texts`, { token, body: { texts: {} } }), site(SITE));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { message: "Write something first." } });

    const long = await proposeTexts(call(`/api/v1/sites/${SITE}/texts`, { token, body: { texts: { description: "x".repeat(2001) } } }), site(SITE));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: { message: "About the site must be at most 2000 characters." } });
  });

  it("says whether an approved edit still stands, so the app promises credits only while it does", async () => {
    const token = await signInApp("d@example.com", "Dee");
    const first = await (await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token }), site(SITE))).json();
    const sent = await proposeTexts(
      call(`/api/v1/sites/${SITE}/texts`, { token, body: { texts: { description: "Bright soft corals on the east side." }, based: first.texts } }),
      site(SITE),
    );
    const id = (await sent.json()).mine.id;
    expect((await (await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token }), site(SITE))).json()).mine.standing).toBe(false);

    const original = { description: first.texts.description, howToDive: first.texts.howToDive };
    await mutateStore((store) => reviewEdit(store, id, "approve", "moderator-id", original, Date.now()));
    const approved = await (await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token }), site(SITE))).json();
    expect(approved.mine).toMatchObject({ status: "approved", standing: true });

    await mutateStore((store) => revertEdit(store, id, original, new Date().toISOString()));
    const takenBack = await (await getTexts(call(`/api/v1/sites/${SITE}/texts`, { token }), site(SITE))).json();
    expect(takenBack.mine).toMatchObject({ status: "approved", standing: false });
  });

  it("answers 404, not 400, when a moderator looked at the edit just before the withdraw landed", async () => {
    const raced = apiSiteTextsResult({ ok: false, error: EDIT_ALREADY_LOOKED_AT, wiki: null, live: false });
    expect(raced.status).toBe(404);
  });
});
