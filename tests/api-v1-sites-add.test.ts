import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { POST as addSite } from "@/app/api/v1/sites/route";
import { GET as getSite } from "@/app/api/v1/sites/[id]/route";
import { POST as addPhoto } from "@/app/api/v1/sites/[id]/photos/route";
import { GET as getReviews } from "@/app/api/v1/sites/[id]/reviews/route";
import { GET as getMe } from "@/app/api/v1/me/route";
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
  const response = await getToken(call("/api/v1/sign-in/token", { body: { email, code: codeFromEmail(), nickname } }));
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


const PIN = { lat: 4.25, lon: 73.45 };

describe("API v1 adding sites", () => {
  it("adds a site with its details and the adder's rating, then the adder's photos", async () => {
    expect((await addSite(call("/api/v1/sites", { body: { name: "Test Thila", ...PIN } }))).status).toBe(401);
    const token = await signInApp("a@example.com", "Ann");
    const added = await addSite(
      call("/api/v1/sites", {
        token,
        body: { name: " Test Thila ", ...PIN, diverSiteType: "lagoon", diveTopM: 8, diveMaxM: 25, howToDive: "Drop on the east side.", rating: 4 },
      }),
    );
    expect(added.status).toBe(201);
    expect(added.headers.get("cache-control")).toBe("private, no-store");
    const { site: saved } = await added.json();
    expect(saved).toMatchObject({ name: "Test Thila", userAdded: true, diveTopM: 8, diveMaxM: 25, howToDive: "Drop on the east side.", photoUrls: [] });
    expect(JSON.stringify(saved)).not.toMatch(/addedBy|example\.com/);
    // On the map and with its rating.
    const read = await getSite(call(`/api/v1/sites/${saved.id}`), site(saved.id));
    expect(read.status).toBe(200);
    // The answer reads the site as GET does: with the forecast's type, set by the pin's place.
    const asRead = await read.json();
    expect(saved.siteType).not.toBeNull();
    expect(saved).toEqual(asRead);
    expect(await (await getReviews(call(`/api/v1/sites/${saved.id}/reviews`), site(saved.id))).json()).toMatchObject({ summary: { count: 1, average: 4 } });
    // The app learns it may add photos there.
    expect((await (await getMe(call("/api/v1/me", { token }))).json()).addedSiteIds).toEqual([saved.id]);

    const photo = await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: tinyJpeg(), type: "image/jpeg", token }), site(saved.id));
    expect(photo.status).toBe(201);
    const withPhoto = (await photo.json()).site;
    expect(withPhoto.photoUrls).toHaveLength(1);
    expect(withPhoto.photoUrls[0]).toMatch(new RegExp(`^/site-photos/${saved.id}/[^/]+\\.jpg$`));

    // Only the adder adds photos, and never to a catalog site.
    const other = await signInApp("b@example.com", "Bo");
    const notHers = await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: tinyJpeg(), type: "image/jpeg", token: other }), site(saved.id));
    expect(notHers.status).toBe(403);
    const catalog = await addPhoto(call("/api/v1/sites/banana-reef/photos", { body: tinyJpeg(), type: "image/jpeg", token }), site("banana-reef"));
    expect(catalog.status).toBe(403);
    expect((await (await getMe(call("/api/v1/me", { token: other }))).json()).addedSiteIds).toEqual([]);
    expect(readStore().sites.find((item) => item.id === saved.id)?.photos).toHaveLength(1);
  });

  it("refuses a bad site, a bad body and a bad photo with the form's words", async () => {
    const token = await signInApp("a@example.com", "Ann");
    const noName = await addSite(call("/api/v1/sites", { token, body: { name: " ", ...PIN } }));
    expect(noName.status).toBe(400);
    expect((await noName.json()).error.message).toBe("Site name is required");
    const far = await addSite(call("/api/v1/sites", { token, body: { name: "Far", lat: 20, lon: 73 } }));
    expect((await far.json()).error.message).toMatch(/Maldives/);
    const depths = await addSite(call("/api/v1/sites", { token, body: { name: "Deep", ...PIN, diveTopM: 30, diveMaxM: 10 } }));
    expect((await depths.json()).error.message).toBe("The shallowest depth is deeper than the deepest.");
    expect((await addSite(call("/api/v1/sites", { token, body: "name=x", type: "application/x-www-form-urlencoded" }))).status).toBe(415);

    const { site: saved } = await (await addSite(call("/api/v1/sites", { token, body: { name: "Test Thila", ...PIN } }))).json();
    expect((await addPhoto(call("/api/v1/sites/nowhere/photos", { body: tinyJpeg(), type: "image/jpeg", token }), site("nowhere"))).status).toBe(404);
    expect((await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: tinyJpeg(), type: "image/png", token }), site(saved.id))).status).toBe(415);
    expect((await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: new Uint8Array(1_500_001), type: "image/jpeg", token }), site(saved.id))).status).toBe(413);
    const notJpeg = await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: new Uint8Array([1, 2, 3]), type: "image/jpeg", token }), site(saved.id));
    expect(notJpeg.status).toBe(400);
    expect((await notJpeg.json()).error.message).toBe("That photo is not a JPEG.");
    expect((await addPhoto(call(`/api/v1/sites/${saved.id}/photos`, { body: tinyJpeg(), type: "image/jpeg" }), site(saved.id))).status).toBe(401);
  });
});
