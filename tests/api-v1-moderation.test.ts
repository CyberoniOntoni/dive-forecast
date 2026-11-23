import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { PUT as rate } from "@/app/api/v1/sites/[id]/rating/route";
import { PUT as writeReview } from "@/app/api/v1/sites/[id]/review/route";
import { GET as getReviews } from "@/app/api/v1/sites/[id]/reviews/route";
import { DELETE as unblock, POST as block } from "@/app/api/v1/divers/[nickname]/block/route";
import { GET as getDiver } from "@/app/api/v1/divers/[nickname]/route";
import { POST as flag } from "@/app/api/v1/flags/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { POST as agree } from "@/app/api/v1/me/terms/route";
import { listOpenFlags, listRecentActivity, moderateContent, moderateFlag } from "@/lib/moderation-actions";
import { mutateStore, readStore, setStorePath } from "@/lib/store";

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

const diver = (nickname: string) => ({ params: Promise.resolve({ nickname }) });

async function review(token: string, text: string) {
  expect((await rate(call("/api/v1/sites/banana-reef/rating", { method: "PUT", body: { score: 2 }, token }), site("banana-reef"))).status).toBe(200);
  expect((await writeReview(call("/api/v1/sites/banana-reef/review", { method: "PUT", body: { text }, token }), site("banana-reef"))).status).toBe(200);
}

describe("API v1 reports, blocks and moderation", () => {
  it("reports a review, blocks its author, and a moderator bans them", async () => {
    vi.stubEnv("MODERATOR_EMAILS", "mod@example.com");
    const rude = await signInApp("rude@example.com", "Rude");
    await review(rude, "Offensive words");
    const ann = await signInApp("ann@example.com", "Ann");

    const report = { kind: "review", siteId: "banana-reef", nickname: "Rude", reason: "hate", note: "Insults" };
    const sentBefore = sent.length;
    expect((await flag(call("/api/v1/flags", { body: report, token: ann }))).status).toBe(201);
    // Moderators hear of it by email.
    await vi.waitFor(() => expect(sent.length).toBe(sentBefore + 1));
    expect(sent[sent.length - 1].get("to")).toBe("mod@example.com");
    expect((await flag(call("/api/v1/flags", { body: { ...report, reason: "nope" }, token: ann }))).status).toBe(400);
    expect((await flag(call("/api/v1/flags", { body: report, token: rude }))).status).toBe(400);
    expect((await flag(call("/api/v1/flags", { body: report }))).status).toBe(401);

    expect((await block(call("/api/v1/divers/Rude/block", { method: "POST", token: ann }), diver("Rude"))).status).toBe(200);
    const hidden = await (await getReviews(call("/api/v1/sites/banana-reef/reviews", { token: ann }), site("banana-reef"))).json();
    expect(JSON.stringify(hidden)).not.toContain("Offensive");
    expect(await (await getMe(call("/api/v1/me", { token: ann }))).json()).toMatchObject({ acceptedTerms: true, blocked: ["Rude"] });
    expect(await (await getDiver(call("/api/v1/divers/Rude", { token: ann }), diver("Rude"))).json()).toMatchObject({ blockedByMe: true });
    expect((await unblock(call("/api/v1/divers/Rude/block", { method: "DELETE", token: ann }), diver("Rude"))).status).toBe(200);
    const shown = await (await getReviews(call("/api/v1/sites/banana-reef/reviews", { token: ann }), site("banana-reef"))).json();
    expect(JSON.stringify(shown)).toContain("Offensive");

    // Only a moderator sees and acts on reports.
    call("/api/v1/me", { token: ann });
    expect(await listOpenFlags()).toBeNull();
    const mod = await signInApp("mod@example.com", "Mod");
    call("/api/v1/me", { token: mod });
    const open = await listOpenFlags();
    expect(open).toHaveLength(1);
    expect(open![0]).toMatchObject({ kind: "review", reason: "hate", review: { text: "Offensive words" }, diver: { nickname: "Rude" } });
    call("/api/v1/me", { token: ann });
    expect(await moderateFlag(open![0].id, "ban")).toMatchObject({ ok: false });
    call("/api/v1/me", { token: mod });
    expect(await moderateFlag(open![0].id, "ban")).toEqual({ ok: true, error: null });
    expect(await listOpenFlags()).toEqual([]);

    // Banned: signed out, the review gone, and no new sign-in.
    expect((await getMe(call("/api/v1/me", { token: rude }))).status).toBe(401);
    const after = await (await getReviews(call("/api/v1/sites/banana-reef/reviews"), site("banana-reef"))).json();
    expect(JSON.stringify(after)).not.toContain("Offensive");
    await requestCode(call("/api/v1/sign-in/code", { body: { email: "rude@example.com" } }));
    const again = await getToken(call("/api/v1/sign-in/token", { body: { email: "rude@example.com", code: codeFromEmail(), acceptTerms: true } }));
    expect(again.status).toBe(400);
    expect(readStore().users.find((user) => user.email === "rude@example.com")?.bannedAt).toBeTruthy();
  });

  it("asks for the content rules at sign-in, and lets a diver from before them agree", async () => {
    await requestCode(call("/api/v1/sign-in/code", { body: { email: "new@example.com" } }));
    const code = codeFromEmail();
    const refused = await getToken(call("/api/v1/sign-in/token", { body: { email: "new@example.com", code, nickname: "Newbie" } }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.code).toBe("needs_terms");

    const token = await signInApp("old@example.com", "Old");
    const store = readStore();
    delete store.users.find((user) => user.nickname === "Old")!.acceptedTermsAt;
    fs.writeFileSync(path.join(DATA_DIR, testFile), JSON.stringify(store));
    const blocked = await writeReview(call("/api/v1/sites/banana-reef/review", { method: "PUT", body: { text: "Nice" }, token }), site("banana-reef"));
    expect([400, 409]).toContain(blocked.status);
    expect((await agree(call("/api/v1/me/terms", { method: "POST", token }))).status).toBe(200);
    await review(token, "Nice");
  });

  it("shows moderators recent activity and lets them take a review down or ban without a report", async () => {
    vi.stubEnv("MODERATOR_EMAILS", "mod@example.com");
    const rude = await signInApp("rude@example.com", "Rude");
    await review(rude, "Offensive words");
    const ann = await signInApp("ann@example.com", "Ann");

    call("/api/v1/me", { token: ann });
    expect(await listRecentActivity()).toBeNull();
    expect(await moderateContent({ kind: "review", siteId: "banana-reef", userId: "x" }, "remove")).toMatchObject({ ok: false });

    const mod = await signInApp("mod@example.com", "Mod");
    call("/api/v1/me", { token: mod });
    const view = (await listRecentActivity())!;
    expect(view.counts).toMatchObject({ review: 1, signup: 3 });
    expect(view).toMatchObject({ page: 1, pages: 1 });
    expect(JSON.stringify(view)).not.toContain("@example.com");
    const written = view.items.find((item) => item.kind === "review")!;
    expect(written).toMatchObject({ text: "Offensive words", diver: { nickname: "Rude" }, site: { id: "banana-reef" } });
    expect((await listRecentActivity("divers"))!.items.map((item) => item.kind)).toEqual(["signup", "signup", "signup"]);

    const modId = readStore().users.find((user) => user.nickname === "Mod")!.id;
    expect(await moderateContent({ kind: "diver", userId: modId }, "ban")).toMatchObject({ ok: false, error: "You cannot ban yourself." });
    // The store-review account is never banned, even by a direct call.
    const annId = readStore().users.find((user) => user.nickname === "Ann")!.id;
    await mutateStore((store) => {
      store.users.find((user) => user.id === annId)!.storeReview = true;
    });
    expect(await moderateContent({ kind: "diver", userId: annId }, "ban")).toMatchObject({ ok: false, error: expect.stringContaining("store-review") });
    expect(readStore().users.find((user) => user.id === annId)?.bannedAt).toBeUndefined();
    expect(await moderateContent(written.removable, "remove")).toEqual({ ok: true, error: null });
    expect((await listRecentActivity("reviews"))!.items).toEqual([]);
    const rudeId = readStore().users.find((user) => user.nickname === "Rude")!.id;
    vi.setSystemTime(Date.now() + 1000);
    // Ban from an item with nothing to remove (their plain rating is gone, so use their sign-up's ban target).
    const signup = (await listRecentActivity("divers"))!.items.find((item) => item.diver?.userId === rudeId)!;
    expect(signup.banTarget).toEqual({ kind: "diver", userId: rudeId });
    expect((await listRecentActivity("all", Number.NaN))!.page).toBe(1);
    expect((await listRecentActivity("__proto__" as never))!.items.length).toBeGreaterThan(0);
    expect(await moderateContent(signup.banTarget, "ban")).toEqual({ ok: true, error: null });
    expect(readStore().users.find((user) => user.id === rudeId)?.bannedAt).toBeTruthy();
    expect((await getMe(call("/api/v1/me", { token: rude }))).status).toBe(401);
  });
});