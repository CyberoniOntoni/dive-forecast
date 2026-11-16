import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPlans, POST as createPlan } from "@/app/api/v1/plans/route";
import { GET as getEditable } from "@/app/api/v1/plans/[id]/edit/route";
import { DELETE as deletePlanRoute, GET as getPlan, PUT as updatePlan } from "@/app/api/v1/plans/[id]/route";
import { GET as getPlanSites } from "@/app/api/v1/plan-sites/route";
import { apiPlanLegs } from "@/lib/api-v1";
import { legWords } from "@/lib/plan-words";
import { GET as getLegs } from "@/app/api/v1/plans/[id]/days/[day]/legs/route";
import { POST as requestCode } from "@/app/api/v1/sign-in/code/route";
import { POST as getToken } from "@/app/api/v1/sign-in/token/route";
import { completeSignIn, requestSignIn } from "@/lib/account-actions";
import { savePlan } from "@/lib/plan-actions";
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


const planParams = (id: string) => ({ params: Promise.resolve({ id }) });
const dayParams = (id: string, day: string) => ({ params: Promise.resolve({ id, day }) });

/** Ann's plan, made on the web: two dives today (no forecast offline) and one well past the forecast's reach. */
async function annPlan(): Promise<{ id: string; token: string }> {
  const token = await signInApp("a@example.com", "Ann");
  await requestSignIn("a@example.com");
  await completeSignIn({ email: "a@example.com", code: codeFromEmail() });
  const saved = await savePlan(null, {
    title: "North Malé week",
    boatSpeedKn: 8,
    days: [
      {
        date: "2026-09-27",
        stops: [
          { siteId: "furana-south", time: "09:00", want: "incoming", note: "Hook in on the corner." },
          { siteId: "banana-reef", time: "11:30" },
        ],
      },
      { date: "2026-10-20", stops: [{ siteId: "banana-reef", time: "08:00" }] },
    ],
  });
  if (!saved.ok) throw new Error(saved.error);
  jar.clear();
  return { id: saved.id, token };
}

describe("API v1 plans", () => {
  it("reads a shared plan in the plan page's words, with no diver id", async () => {
    const { id } = await annPlan();
    const response = await getPlan(call(`/api/v1/plans/${id}`), planParams(id));
    expect(response.status).toBe(200);
    const plan = await response.json();
    expect(plan).toMatchObject({
      apiVersion: 1,
      id,
      title: "North Malé week",
      ownerNickname: "Ann",
      isOwner: false,
      webPath: `/plans/${id}`,
      boatSpeedKn: 8,
    });
    expect(plan.days[0]).toMatchObject({ date: "2026-09-27", label: "Sun 27 Sep", past: true, today: false });
    expect(plan.days[0].stops[0]).toMatchObject({
      siteId: "furana-south",
      time: "09:00",
      note: "Hook in on the corner.",
      status: expect.any(String),
      tone: "none",
      reportTime: "2026-09-27T09:00",
    });
    expect(plan.days[1].stops[0]).toMatchObject({
      status: "beyond",
      message: expect.stringMatching(/^The forecast reaches this dive/),
      veryStrong: false,
      confidenceLabel: null,
    });
    expect(JSON.stringify(plan)).not.toContain(readStore().users[0].id);
    expect(plan).not.toHaveProperty("ownerId");
  });

  it("tells the owner it is theirs, and lists their plans", async () => {
    const { id, token } = await annPlan();
    const mine = await getPlan(call(`/api/v1/plans/${id}`, { token }), planParams(id));
    expect((await mine.json()).isOwner).toBe(true);
    expect(mine.headers.get("cache-control")).toBe("private, max-age=60");

    const list = await getPlans(call("/api/v1/plans", { token }));
    expect(await list.json()).toEqual({
      apiVersion: 1,
      limits: expect.objectContaining({ plansMax: 40 }),
      plans: [
        {
          id,
          title: "North Malé week",
          span: "27 Sep – 20 Oct 2026",
          size: "2 days · 3 dives",
          first: "2026-09-27",
          last: "2026-10-20",
          updatedAt: expect.any(String),
        },
      ],
    });
    expect((await getPlans(call("/api/v1/plans"))).status).toBe(401);
  });

  it("gives a day's boat legs with leave-by words", async () => {
    const { id } = await annPlan();
    const response = await getLegs(call(`/api/v1/plans/${id}/days/0/legs`), dayParams(id, "0"));
    const body = await response.json();
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0]).toMatchObject({ from: 0, text: expect.stringMatching(/nm · about .* at 8 kn$/), leaveBy: expect.stringMatching(/^Leave by \d\d:\d\d$/) });
    expect(body.legs[0].points.length).toBeGreaterThanOrEqual(2);
    expect((await getLegs(call(`/api/v1/plans/${id}/days/5/legs`), dayParams(id, "5"))).status).toBe(404);
    expect((await getLegs(call(`/api/v1/plans/${id}/days/x/legs`), dayParams(id, "x"))).status).toBe(404);
  });

  it("answers 404 for an unknown or malformed plan id", async () => {
    expect((await getPlan(call("/api/v1/plans/abcdefghijklmnop"), planParams("abcdefghijklmnop"))).status).toBe(404);
    expect((await getPlan(call("/api/v1/plans/../x"), planParams("../x"))).status).toBe(404);
  });

  it("words each leg from the dive times it carries, not from a recount of the stops", () => {
    const leg = { from: 1, fromTime: "09:00", toTime: "11:30", points: [[4.3, 73.5], [4.31, 73.51]] as [number, number][], lengthKm: 3.704, routed: true, minutes: 15 };
    const body = apiPlanLegs("Kq7vHtmWpdNrcXfa", 0, [leg], 8);
    const words = legWords(leg, 8, "09:00", "11:30");
    expect(words.leaveBy).toMatch(/^Leave by \d\d:\d\d$/);
    expect(body.legs[0]).toMatchObject({ from: 1, ...words });
    expect(body.legs[0]).not.toHaveProperty("fromTime");
  });

  describe("the editor", () => {
    const body = {
      title: "Ari weekend",
      notes: null,
      boatSpeedKn: 10,
      days: [
        {
          date: "2026-10-03",
          stops: [
            { siteId: "banana-reef", time: "14:00", note: null, want: null },
            { siteId: "furana-south", time: "09:00", note: "Early slack", want: "incoming" },
          ],
        },
      ],
    };

    it("makes a plan from the app, in the editor's order, and lists it", async () => {
      const token = await signInApp("a@example.com", "Ann");
      const response = await createPlan(call("/api/v1/plans", { token, body }));
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const { id } = await response.json();
      expect(id).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);

      const editable = await (await getEditable(call(`/api/v1/plans/${id}/edit`, { token }), planParams(id))).json();
      expect(editable).toMatchObject({
        apiVersion: 1,
        id,
        title: "Ari weekend",
        notes: null,
        boatSpeedKn: 10,
        days: [
          {
            date: "2026-10-03",
            stops: [
              { siteId: "furana-south", time: "09:00", note: "Early slack", want: "incoming" },
              { siteId: "banana-reef", time: "14:00", note: null, want: null },
            ],
          },
        ],
        limits: { titleMax: 80, divesPerDayMax: 6, boatSpeedDefaultKn: 8, yearMin: 2020, yearMax: 2100 },
      });
      expect(editable).not.toHaveProperty("ownerId");

      const list = await (await getPlans(call("/api/v1/plans", { token }))).json();
      expect(list.plans.map((plan: { id: string }) => plan.id)).toEqual([id]);
      expect(list.limits.daysMax).toBe(16);
    });

    it("needs the app's token and JSON, and answers in the editor's words", async () => {
      const token = await signInApp("a@example.com", "Ann");
      expect((await createPlan(call("/api/v1/plans", { body }))).status).toBe(401);
      expect((await createPlan(call("/api/v1/plans", { token, body: "x", type: "text/plain" }))).status).toBe(415);
      const refused = await createPlan(call("/api/v1/plans", { token, body: { ...body, title: " " } }));
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: { code: "bad_request", message: "Give the plan a title" } });
      expect(readStore().plans).toHaveLength(0);
    });

    it("lets only the owner read, change and delete it", async () => {
      const { id, token } = await annPlan();
      const ben = await signInApp("b@example.com", "Ben");

      expect((await getEditable(call(`/api/v1/plans/${id}/edit`), planParams(id))).status).toBe(401);
      expect((await getEditable(call(`/api/v1/plans/${id}/edit`, { token: ben }), planParams(id))).status).toBe(404);
      const taken = await updatePlan(call(`/api/v1/plans/${id}`, { method: "PUT", token: ben, body }), planParams(id));
      expect(taken.status).toBe(403);
      expect((await deletePlanRoute(call(`/api/v1/plans/${id}`, { method: "DELETE", token: ben }), planParams(id))).status).toBe(404);
      expect(readStore().plans[0].title).toBe("North Malé week");

      const changed = await updatePlan(call(`/api/v1/plans/${id}`, { method: "PUT", token, body }), planParams(id));
      expect(changed.status).toBe(200);
      expect(await changed.json()).toEqual({ apiVersion: 1, id });
      expect(readStore().plans[0]).toMatchObject({ id, title: "Ari weekend", boatSpeedKn: 10 });

      const gone = await deletePlanRoute(call(`/api/v1/plans/${id}`, { method: "DELETE", token }), planParams(id));
      expect(await gone.json()).toEqual({ apiVersion: 1, id, deleted: true });
      expect((await getPlan(call(`/api/v1/plans/${id}`), planParams(id))).status).toBe(404);
      const again = await updatePlan(call(`/api/v1/plans/${id}`, { method: "PUT", token, body }), planParams(id));
      expect(again.status).toBe(404);
      expect((await updatePlan(call("/api/v1/plans/new", { method: "PUT", token, body }), planParams("new"))).status).toBe(404);
    });
  });

  it("gives the editor's site picker with channels marked and today's Maldives date", async () => {
    const response = await getPlanSites();
    const body = await response.json();
    expect(body.today).toBe("2026-09-28");
    expect(body.sites.length).toBeGreaterThan(100);
    expect(body.sites.find((site: { id: string }) => site.id === "furana-south")).toMatchObject({ channel: true, atoll: expect.any(String) });
    expect(body.sites.find((site: { id: string }) => site.id === "banana-reef")).toMatchObject({ channel: false });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
