import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { DELETE as unrate, PUT as rate } from "@/app/api/v1/sites/[id]/rating/route";
import { PUT as writeReview } from "@/app/api/v1/sites/[id]/review/route";
import { POST as addPhoto } from "@/app/api/v1/sites/[id]/review/photos/route";
import { DELETE as dropPhoto } from "@/app/api/v1/sites/[id]/review/photos/[photoId]/route";
import { GET as getReviews } from "@/app/api/v1/sites/[id]/reviews/route";
import { setSessionCookie } from "@/lib/auth";
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

/** The smallest JPEG cleanJpeg takes, with an EXIF block it strips. */
function tinyJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66,
    0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0,
    0x12, 0x34,
    0xff, 0xd9,
  ]);
}

const SITE = "banana-reef";
const photo = (id: string, photoId: string) => ({ params: Promise.resolve({ id, photoId }) });

describe("API v1 ratings and reviews", () => {
  it("rates, writes, adds and removes a photo, and removes the rating, answering with the card each time", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const userId = readStore().users[0].id;

    const empty = await getReviews(call(`/api/v1/sites/${SITE}/reviews`), site(SITE));
    expect(empty.headers.get("cache-control")).toBe("private, max-age=60");
    expect(await empty.json()).toMatchObject({
      apiVersion: 1,
      siteId: SITE,
      summary: { average: null, count: 0, mine: null },
      summaryLine: "No ratings yet",
      reviews: [],
      mine: null,
      ratingPoints: 3,
      reviewMaxChars: 1500,
      maxPhotos: 6,
    });

    // A review before a rating is refused in the web form's words.
    const early = await writeReview(call(`/api/v1/sites/${SITE}/review`, { method: "PUT", body: { text: "Lovely" }, token }), site(SITE));
    expect(early.status).toBe(400);
    expect((await early.json()).error.message).toBe("Rate the site first, then write your review.");

    const rated = await rate(call(`/api/v1/sites/${SITE}/rating`, { method: "PUT", body: { score: 4 }, token }), site(SITE));
    expect(rated.status).toBe(200);
    expect(rated.headers.get("cache-control")).toBe("private, no-store");
    expect(await rated.json()).toMatchObject({ summary: { average: 4, count: 1, mine: 4 }, summaryLine: "4 from 1 diver", mine: { nickname: "Ann", score: 4 } });

    const written = await writeReview(call(`/api/v1/sites/${SITE}/review`, { method: "PUT", body: { text: "  Mantas at 20 m  " }, token }), site(SITE));
    expect((await written.json()).mine).toMatchObject({ review: "Mantas at 20 m", date: "28 Sept 2026" });

    const added = await addPhoto(call(`/api/v1/sites/${SITE}/review/photos`, { body: tinyJpeg(), type: "image/jpeg", token }), site(SITE));
    expect(added.status).toBe(201);
    const card = await added.json();
    expect(card.mine.photos).toHaveLength(1);
    const [{ id: photoId, url }] = card.mine.photos;
    expect(url).toBe(`/site-photos/${SITE}/${photoId}.jpg`);
    // No diver id anywhere, only the nickname.
    expect(JSON.stringify(card)).not.toContain(userId);

    // Signed in, the card holds the diver's own and is never kept.
    const own = await getReviews(call(`/api/v1/sites/${SITE}/reviews`, { token }), site(SITE));
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect((await own.json()).mine.score).toBe(4);
    // Another diver sees it in the list.
    const other = await signInApp("b@example.com", "Bo");
    const seen = await (await getReviews(call(`/api/v1/sites/${SITE}/reviews`, { token: other }), site(SITE))).json();
    expect(seen.mine).toBeNull();
    expect(seen.reviews).toMatchObject([{ nickname: "Ann", score: 4, review: "Mantas at 20 m" }]);
    // Bo cannot delete Ann's photo.
    const notHers = await dropPhoto(call(`/api/v1/sites/${SITE}/review/photos/${photoId}`, { method: "DELETE", token: other }), photo(SITE, photoId));
    expect(notHers.status).toBe(400);

    const dropped = await dropPhoto(call(`/api/v1/sites/${SITE}/review/photos/${photoId}`, { method: "DELETE", token }), photo(SITE, photoId));
    expect((await dropped.json()).mine.photos).toEqual([]);

    const removed = await unrate(call(`/api/v1/sites/${SITE}/rating`, { method: "DELETE", token }), site(SITE));
    expect(await removed.json()).toMatchObject({ summary: { count: 0, mine: null }, mine: null });
  });

  it("ignores the web's cookie, and answers 401 to a token it turns down", async () => {
    const token = await signInApp("a@example.com", "Ann");
    expect((await rate(call(`/api/v1/sites/${SITE}/rating`, { method: "PUT", body: { score: 4 }, token }), site(SITE))).status).toBe(200);
    const ann = readStore().users.find((user) => user.nickname === "Ann")!;
    await setSessionCookie(ann.id, ann.nickname);
    // Only the cookie: the card anyone sees, kept a minute, without Ann's own.
    const cookieOnly = await getReviews(call(`/api/v1/sites/${SITE}/reviews`), site(SITE));
    expect(cookieOnly.headers.get("cache-control")).toBe("private, max-age=60");
    expect(await cookieOnly.json()).toMatchObject({ summary: { count: 1, mine: null }, mine: null });
    // A token the server cannot open is not rescued by the cookie.
    const dead = await getReviews(call(`/api/v1/sites/${SITE}/reviews`, { token: "not-a-token" }), site(SITE));
    expect(dead.status).toBe(401);
    expect(dead.headers.get("cache-control")).toBe("no-store");
  });

  it("needs the token, a known site, a 1 to 5 score and a JPEG body", async () => {
    expect((await rate(call(`/api/v1/sites/${SITE}/rating`, { method: "PUT", body: { score: 4 } }), site(SITE))).status).toBe(401);
    const token = await signInApp("a@example.com", "Ann");
    expect((await rate(call("/api/v1/sites/nowhere/rating", { method: "PUT", body: { score: 4 }, token }), site("nowhere"))).status).toBe(404);
    expect((await getReviews(call("/api/v1/sites/nowhere/reviews"), site("nowhere"))).status).toBe(404);
    const six = await rate(call(`/api/v1/sites/${SITE}/rating`, { method: "PUT", body: { score: 6 }, token }), site(SITE));
    expect(six.status).toBe(400);
    expect((await six.json()).error.message).toBe("Pick a rating from 1 to 5.");
    const text = await addPhoto(call(`/api/v1/sites/${SITE}/review/photos`, { body: "not a photo", type: "text/plain", token }), site(SITE));
    expect(text.status).toBe(415);
    const big = await addPhoto(call(`/api/v1/sites/${SITE}/review/photos`, { body: new Uint8Array(1_500_001), type: "image/jpeg", token }), site(SITE));
    expect(big.status).toBe(413);
    const unrated = await addPhoto(call(`/api/v1/sites/${SITE}/review/photos`, { body: tinyJpeg(), type: "image/jpeg", token }), site(SITE));
    expect((await unrated.json()).error.message).toBe("Rate the site first, then add your photos.");
  });
});
