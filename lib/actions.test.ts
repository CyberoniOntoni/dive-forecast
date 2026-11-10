import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addReport,
  addReportAction,
  addReviewPhoto,
  addSite,
  addSitePhoto,
  getBoatRoute,
  getRating,
  getSiteReviews,
  rateSite,
  removeMyRating,
  removeReviewPhoto,
  saveReview,
  submitRating,
  submitSite,
} from "./actions";
import { authSecret, SESSION_COOKIE } from "./auth";
import { signSession } from "./session-token";
import { inwardBearingDeg } from "./bearing";
import { FORECAST_MODEL_VERSION } from "./forecast";
import { marineCacheDir, seawardPoint } from "./marine";
import { seawardKmFor } from "./seaward-floor";
import { rimForAtoll } from "./rim";
import { findSite, mutateStore, readCatalog, readStore, setStorePath } from "./store";
import { readPhotoBytes } from "./site-photos";
import { UNSEEDED_ATOLL_ID } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const LIVE_STORE = path.join(DATA_DIR, "store.json");

/** The request's cookies, as next/headers would read them. */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

async function signInAs(userId: string, nickname = userId) {
  jar.set(SESSION_COOKIE, await signSession({ userId, nickname, issuedAt: Date.now() }, authSecret()!));
}

let testFile = "";
let liveSnapshot = "";

beforeEach(async () => {
  // The day after the fixture reports' dives, so they are inside the reporting window (REPORT_MAX_AGE_DAYS).
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-28T00:00:00Z") });
  liveSnapshot = fs.readFileSync(LIVE_STORE, "utf8");
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStorePath(testFile);
  jar.clear();
  await signInAs("diver-1");
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name === testFile || name.startsWith(`${testFile}.corrupt.`) || /^\.store\..+\.tmp$/.test(name)) {
      fs.rmSync(path.join(DATA_DIR, name), { recursive: true, force: true });
    }
  }
  setStorePath("store.json");
  expect(fs.readFileSync(LIVE_STORE, "utf8")).toBe(liveSnapshot);
});

function addSiteUnknown(input: unknown) {
  return addSite(input as { name: string; lat: number; lon: number });
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("addSite", () => {
  it("rejects null and an empty object without TypeError", async () => {
    // C4
    const fromNull = await rejection(addSiteUnknown(null));
    const fromEmpty = await rejection(addSiteUnknown({}));
    expect(fromNull).toBeInstanceOf(Error);
    expect(fromNull).not.toBeInstanceOf(TypeError);
    expect(fromEmpty).toBeInstanceOf(Error);
    expect(fromEmpty).not.toBeInstanceOf(TypeError);
  });

  it("rejects a 5000-character name", async () => {
    // C4
    await expect(addSite({ name: "n".repeat(5000), lat: 4.3, lon: 73.5 })).rejects.toThrow();
  });

  it("rejects latitude 85 and longitude 150 with Maldives-bounds wording", async () => {
    // C4
    await expect(addSite({ name: "North", lat: 85, lon: 73.5 })).rejects.toThrow(/Maldives.*bounds/i);
    await expect(addSite({ name: "East", lat: 4.3, lon: 150 })).rejects.toThrow(/Maldives.*bounds/i);
  });
});

describe("addSite atoll matching", () => {
  it("puts a pin on a seeded reef in that atoll", async () => {
    const site = await addSite({ name: "Test Reef", lat: 4.2342, lon: 73.534 });
    expect(site.atollId).toBe("north-male");
  });

  it("marks a pin in an unseeded atoll instead of assigning a far atoll", async () => {
    // Haa Alif Atoll: over 100 km from Raa, the nearest seeded atoll.
    const site = await addSite({ name: "Haa Alif Test", lat: 6.95, lon: 72.95 });
    expect(site.atollId).toBe(UNSEEDED_ATOLL_ID);
  });
});

/** The smallest byte string cleanJpeg takes, with an EXIF segment for it to drop. */
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

function photoForm(bytes: Uint8Array = tinyJpeg()): FormData {
  const form = new FormData();
  form.append("photo", new Blob([bytes as BlobPart], { type: "image/jpeg" }), "photo.jpg");
  return form;
}

describe("addSite details", () => {
  it("saves the diver's kind, depths and notes on the pin, and their rating, without setting the forecast's type", async () => {
    const site = await addSite({
      name: "Detail Thila",
      lat: 4.2342,
      lon: 73.534,
      diverSiteType: "lagoon",
      diveTopM: "8",
      diveMaxM: "24",
      howToDive: "Drop on the north side.",
      rating: 4,
    });
    expect(site).toMatchObject({ diverSiteType: "lagoon", diveTopM: 8, diveMaxM: 24, howToDive: "Drop on the north side." });
    expect(site.siteType).toBeUndefined();
    expect(findSite(site.id)?.howToDive).toBe("Drop on the north side.");
    expect(await getRating(site.id)).toEqual({ average: 4, count: 1, mine: 4 });
  });

  it("saves nothing when a detail or the rating is bad, and submitSite says why", async () => {
    const result = await submitSite({ name: "Bad Depth", lat: 4.2342, lon: 73.534, diveTopM: 30, diveMaxM: 10 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/shallowest/) });
    await expect(addSite({ name: "Bad Rating", lat: 4.2342, lon: 73.534, rating: 6 })).rejects.toThrow(/Rating/);
    expect(readStoreSites()).toEqual([]);
  });
});

function readStoreSites(): unknown[] {
  const file = path.join(DATA_DIR, testFile);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).sites : [];
}

describe("addSitePhoto", () => {
  it("saves a JPEG for the adder without its EXIF, and lists it on the site", async () => {
    const site = await addSite({ name: "Photo Reef", lat: 4.2342, lon: 73.534 });
    const result = await addSitePhoto(site.id, photoForm());
    if (!result.ok) throw new Error(result.error);
    expect(result.url).toBe(`/site-photos/${site.id}/${result.photo.id}.jpg`);
    expect(findSite(site.id)?.photos).toEqual([result.photo]);
    const saved = await readPhotoBytes(site.id, result.photo.id);
    expect(saved?.length).toBe(tinyJpeg().length - 8);
  });

  it("refuses another diver, a catalog site, a non-JPEG and a seventh photo", async () => {
    const site = await addSite({ name: "Busy Reef", lat: 4.2342, lon: 73.534 });
    expect(await addSitePhoto(site.id, photoForm(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).toEqual({
      ok: false,
      error: "That photo is not a JPEG.",
    });
    const catalogId = readCatalog().sites[0].id;
    expect((await addSitePhoto(catalogId, photoForm())).ok).toBe(false);
    for (let index = 0; index < 6; index += 1) expect((await addSitePhoto(site.id, photoForm())).ok).toBe(true);
    expect(await addSitePhoto(site.id, photoForm())).toEqual({ ok: false, error: "A site can have at most 6 photos." });

    await signInAs("diver-2");
    const other = await addSitePhoto(site.id, photoForm());
    expect(other).toEqual({ ok: false, error: "Only the diver who added this site can add photos." });
  });
});

describe("rateSite", () => {
  it("rejects 3.5, 6, and 0 for banana-reef", async () => {
    // C4
    await expect(rateSite("banana-reef", 3.5)).rejects.toThrow();
    await expect(rateSite("banana-reef", 6)).rejects.toThrow();
    await expect(rateSite("banana-reef", 0)).rejects.toThrow();
  });
});

describe("addReport", () => {
  it("rejects null with Error and not TypeError", async () => {
    const fromNull = await rejection(addReport(null));
    expect(fromNull).toBeInstanceOf(Error);
    expect(fromNull).not.toBeInstanceOf(TypeError);
  });
});

/** Puts a site's committed benchmark fixture in the test marine cache, under the name the cache reader looks for. */
function seedMarineCache(siteId: string): void {
  const catalog = readCatalog();
  const site = catalog.sites.find((item) => item.id === siteId)!;
  const atoll = catalog.atolls.find((item) => item.id === site.atollId)!;
  const bearing = inwardBearingDeg(site, catalog.sites, { lat: atoll.oceanLat, lon: atoll.oceanLon }, rimForAtoll(atoll));
  const point = seawardPoint(site.lat, site.lon, bearing, seawardKmFor(site.id));
  const fixtureName = `${point.lat.toFixed(4)}_${point.lon.toFixed(4)}.json`;
  const fixture = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "benchmark-marine-cache", fixtureName), "utf8"),
  ) as { hours: unknown[] };
  fs.mkdirSync(marineCacheDir(), { recursive: true });
  // The live cache reader strips letters from its file names, so its files have no extension.
  fs.writeFileSync(
    path.join(marineCacheDir(), fixtureName.replace(/[^0-9.+_-]/g, "")),
    JSON.stringify({ fetchedAt: Date.now(), hours: fixture.hours }),
  );
}

describe("addReport saves the prediction", () => {
  it("stores what the page showed and what the model alone said for the report hour", async () => {
    seedMarineCache("kandooma-thila");
    const report = await addReport({
      siteId: "kandooma-thila",
      time: "2026-09-27T08:00",
      direction: "incoming",
      strength: "strong",
    });
    expect(report.predicted).toBeDefined();
    expect(report.predicted?.modelVersion).toBe(FORECAST_MODEL_VERSION);
    expect(report.predicted?.bearingDeg).toBe(285);
    expect(report.predicted?.bearingSource).toBe("override");
    expect(report.predicted?.shown.direction).toMatch(/^(incoming|outgoing)$/);
    expect(report.predicted?.modelOnly).not.toBeNull();
    expect(report.predicted?.issuedAt).toEqual(expect.any(Number));
    // The day's tide range is saved beside the slope window, so the report can be graded after it leaves the series.
    expect(report.slopeWindowM).toHaveLength(13);
    expect(report.rangeM).toEqual(expect.any(Number));
    expect(report.throughflowM).toEqual(expect.any(Number));
  });

  it("the modelOnly prediction ignores earlier reports; the shown one may not", async () => {
    seedMarineCache("kandooma-thila");
    const first = await addReport({ siteId: "kandooma-thila", time: "2026-09-27T08:00", direction: "incoming", strength: "strong" });
    // A second diver at the same hour: not the same report filed twice, which is refused.
    const second = await addReport({ siteId: "kandooma-thila", time: "2026-09-27T08:00", direction: "incoming", strength: "mild" });
    expect(second.predicted?.modelOnly).toEqual(first.predicted?.modelOnly);
  });

  it("a back-dated report's shown prediction uses only reports from before its dive", async () => {
    seedMarineCache("kandooma-thila");
    // Later dives filed first. They must not tune the forecast for an earlier dive filed after them.
    for (let index = 0; index < 3; index += 1) {
      // Three divers a minute apart; the identical report filed again would be refused as a double submission.
      await addReport({ siteId: "kandooma-thila", time: `2026-09-27T14:0${index}`, direction: "outgoing", strength: "too_strong" });
    }
    const backDated = await addReport({ siteId: "kandooma-thila", time: "2026-09-27T06:00", direction: "incoming", strength: "mild" });
    expect(backDated.predicted?.modelOnly).not.toBeNull();
    expect(backDated.predicted?.shown).toEqual({ ...backDated.predicted!.modelOnly, confidence: "low" });
  });

  it("still saves the report when there is no ocean data, just without a prediction", async () => {
    // Nothing seeds Banana Reef's cache in this file, and the test setup blocks the network.
    const report = await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    expect(report.id).toBeTruthy();
    expect(report.predicted).toBeUndefined();
  });
});

describe("addReportAction", () => {
  it("returns an error state instead of throwing", async () => {
    const state = await addReportAction("", new FormData());
    expect(state).toEqual({ success: false, error: expect.any(String) });
    expect(state.error).toBeTruthy();
  });

  it("returns the points the report earned", async () => {
    const form = new FormData();
    form.set("time", "2026-09-27T08:00");
    form.set("direction", "incoming");
    form.set("strength", "mild");
    const state = await addReportAction("banana-reef", form);
    expect(state.success).toBe(true);
    // Filed long after the dive, at a site nobody had reported: no fresh bonus, a pathfinder one.
    expect(state.award).toMatchObject({ points: 20, reasons: ["report", "pathfinder"] });
  });
});

describe("signing in gates writes", () => {
  it("refuses reports, ratings and new sites from a signed-out visitor", async () => {
    jar.clear();
    const report = { siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" };
    await expect(addReport(report)).rejects.toThrow("Sign in first.");
    await expect(rateSite("banana-reef", 4)).rejects.toThrow("Sign in first.");
    await expect(addSite({ name: "Test Reef", lat: 4.2342, lon: 73.534 })).rejects.toThrow("Sign in first.");
    const state = await addReportAction("banana-reef", new FormData());
    expect(state.error).toBe("Sign in first.");
  });

  it("refuses a cookie signed with another secret", async () => {
    jar.set(SESSION_COOKIE, await signSession({ userId: "x", nickname: "x", issuedAt: Date.now() }, "other-secret"));
    await expect(rateSite("banana-reef", 4)).rejects.toThrow("Sign in first.");
  });

  it("stamps reports and added sites with the diver", async () => {
    const report = await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    expect(report.userId).toBe("diver-1");
    const site = await addSite({ name: "Test Reef", lat: 4.2342, lon: 73.534 });
    expect(site.addedBy).toBe("diver-1");
  });

  it("keeps one rating per diver and averages them", async () => {
    await rateSite("banana-reef", 4);
    await rateSite("banana-reef", 2);
    await signInAs("diver-2");
    const summary = await rateSite("banana-reef", 5);
    expect(summary).toEqual({ average: 3.5, count: 2, mine: 5 });
    await signInAs("diver-1");
    expect(await getRating("banana-reef")).toEqual({ average: 3.5, count: 2, mine: 2 });
    jar.clear();
    expect(await getRating("banana-reef")).toEqual({ average: 3.5, count: 2, mine: null });
  });
});

describe("reviews on any site", () => {
  const siteId = "banana-reef";

  async function withDivers() {
    await mutateStore((store) => {
      for (const id of ["diver-1", "diver-2"]) {
        store.users.push({ id, email: `${id}@example.com`, nickname: id.replace("diver-", "Diver "), createdAt: "2026-09-01T00:00:00Z" });
      }
    });
  }

  it("lets a diver rate, write, add photos to and remove a review of a catalog site", async () => {
    await withDivers();
    expect(await saveReview(siteId, "Lovely")).toEqual({ ok: false, error: "Rate the site first, then write your review." });
    expect(await addReviewPhoto(siteId, photoForm())).toEqual({ ok: false, error: "Rate the site first, then add your photos." });

    const rated = await submitRating(siteId, 4);
    if (!rated.ok) throw new Error(rated.error);
    expect(rated.reviews.mine).toMatchObject({ score: 4, review: null, photos: [] });

    const written = await saveReview(siteId, "  Sharks at the corner on incoming.\r\n\n\n\nGood vis.  ");
    if (!written.ok) throw new Error(written.error);
    expect(written.reviews.mine?.review).toBe("Sharks at the corner on incoming.\n\nGood vis.");

    const photo = await addReviewPhoto(siteId, photoForm());
    if (!photo.ok) throw new Error(photo.error);
    expect(await readPhotoBytes(siteId, photo.photo.id)).not.toBeNull();

    // A new score keeps the text and photos.
    const changed = await submitRating(siteId, 5);
    if (!changed.ok) throw new Error(changed.error);
    expect(changed.reviews.mine).toMatchObject({ score: 5, review: "Sharks at the corner on incoming.\n\nGood vis." });
    expect(changed.reviews.mine?.photos.map((item) => item.id)).toEqual([photo.photo.id]);

    // Another diver sees it in the list, with the nickname, not the email.
    await signInAs("diver-2");
    const seen = await getSiteReviews(siteId);
    expect(seen.mine).toBeNull();
    expect(seen.reviews).toHaveLength(1);
    expect(seen.reviews[0]).toMatchObject({ nickname: "Diver 1", score: 5 });
    expect(JSON.stringify(seen)).not.toContain("example.com");
    // and cannot take its photo off.
    expect(await removeReviewPhoto(siteId, photo.photo.id)).toEqual({ ok: false, error: "That photo is not on your review." });

    await signInAs("diver-1");
    const removed = await removeMyRating(siteId);
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.reviews.mine).toBeNull();
    expect(removed.reviews.summary).toEqual({ average: null, count: 0, mine: null });
    expect(await readPhotoBytes(siteId, photo.photo.id)).toBeNull();
    expect(await removeMyRating(siteId)).toEqual({ ok: false, error: "You have not rated this site." });
    expect(await getRating(siteId)).toEqual({ average: null, count: 0, mine: null });
  });

  it("keeps the first rating's day through remove and re-rate, with no review carried back", async () => {
    await withDivers();
    await submitRating(siteId, 3);
    await saveReview(siteId, "Meh");
    const first = readStore().ratings.find((rating) => rating.userId === "diver-1")!.firstRatedAt;
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    await removeMyRating(siteId);
    const again = await submitRating(siteId, 5);
    if (!again.ok) throw new Error(again.error);
    expect(again.reviews.mine).toMatchObject({ score: 5, review: null, photos: [] });
    const row = readStore().ratings.find((rating) => rating.userId === "diver-1")!;
    expect(row.firstRatedAt).toBe(first);
    expect(row.removedAt).toBeUndefined();
  });

  it("lets a diver delete one of their photos, and caps photos per review", async () => {
    await withDivers();
    await submitRating(siteId, 4);
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await addReviewPhoto(siteId, photoForm());
      if (!result.ok) throw new Error(result.error);
      ids.push(result.photo.id);
    }
    expect(await addReviewPhoto(siteId, photoForm())).toEqual({ ok: false, error: "A review can have at most 6 photos." });
    const dropped = await removeReviewPhoto(siteId, ids[0]);
    if (!dropped.ok) throw new Error(dropped.error);
    expect(dropped.reviews.mine?.photos.map((photo) => photo.id)).toEqual(ids.slice(1));
    expect(await readPhotoBytes(siteId, ids[0])).toBeNull();
    expect(await removeReviewPhoto(siteId, "../../etc")).toEqual({ ok: false, error: "Unknown photo." });
  });

  it("refuses a signed-out visitor, a bad score, an unknown site and an overlong review", async () => {
    await withDivers();
    expect(await submitRating(siteId, 6)).toEqual({ ok: false, error: "Pick a rating from 1 to 5." });
    expect(await submitRating("no-such-site", 4)).toEqual({ ok: false, error: "Unknown site." });
    await submitRating(siteId, 4);
    expect(await saveReview(siteId, "x".repeat(1501))).toEqual({ ok: false, error: "A review must be at most 1500 characters." });
    jar.clear();
    expect(await submitRating(siteId, 4)).toEqual({ ok: false, error: "Sign in first." });
    expect(await removeMyRating(siteId)).toEqual({ ok: false, error: "Sign in first." });
    expect(await addReviewPhoto(siteId, photoForm())).toEqual({ ok: false, error: "Sign in first." });
  });
});

describe("addReport guards", () => {
  it("saves when the report was filed", async () => {
    const report = await addReport({ siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" });
    expect(Date.parse(report.filedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
  });

  it("refuses the same report filed again, but not a different one", async () => {
    const report = { siteId: "banana-reef", time: "2026-09-27T08:00", direction: "outgoing", strength: "mild" };
    await addReport(report);
    await expect(addReport(report)).rejects.toThrow("already saved");
    await expect(addReport({ ...report, strength: "strong" })).resolves.toBeTruthy();
  });

  it("accepts the same report again once the double-submission window has passed", async () => {
    const report = { siteId: "banana-reef", time: "2026-09-27T09:00", direction: "outgoing", strength: "mild" };
    await addReport(report);
    // Age the saved report past the 30-minute window.
    const file = path.join(DATA_DIR, testFile);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as { reports: { filedAt?: string }[] };
    for (const item of stored.reports) item.filedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(stored));
    await expect(addReport(report)).resolves.toBeTruthy();
  });

  it("refuses a dive older than the reporting window, and a time not written the normal way", async () => {
    const report = { siteId: "banana-reef", direction: "outgoing", strength: "mild" };
    await expect(addReport({ ...report, time: "2026-09-13T04:00" })).rejects.toThrow("last 14 days");
    await expect(addReport({ ...report, time: "2026-09-14T06:00" })).resolves.toBeTruthy();
    // Both roll over to real hours, but would be kept as typed, each with a day of its own.
    await expect(addReport({ ...report, time: "2026-09-26T32:00" })).rejects.toThrow("Bad time");
    await expect(addReport({ ...report, time: "2026-08-58T08:00" })).rejects.toThrow("Bad time");
    await expect(addReport({ ...report, time: 5 })).rejects.toThrow("Bad time");
  });

  it("refuses a dive time more than an hour ahead of the site's clock", async () => {
    // Two hours ahead of now in the Maldives: almost always a time entered in the diver's own zone.
    const ahead = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await expect(
      addReport({ siteId: "banana-reef", time: ahead, direction: "outgoing", strength: "mild" }),
    ).rejects.toThrow("still ahead in the Maldives");
  });
});

describe("limits on public and gated actions", () => {
  it("lets a diver add up to 10 sites a day", async () => {
    for (let index = 0; index < 10; index += 1) {
      await addSite({ name: `Reef ${index}`, lat: 4.2342 + index / 1000, lon: 73.534 });
    }
    expect((await submitSite({ name: "Reef 11", lat: 4.25, lon: 73.534 })) as { error?: string }).toMatchObject({
      ok: false,
      error: expect.stringContaining("10 sites a day"),
    });
    vi.setSystemTime(new Date("2026-09-29T00:00:01Z"));
    await expect(addSite({ name: "Reef 11", lat: 4.25, lon: 73.534 })).resolves.toBeTruthy();
  });

  it("leaves a site the owner hid out of every list", async () => {
    const site = await addSite({ name: "Spam Reef", lat: 4.2342, lon: 73.534 });
    expect(findSite(site.id)).not.toBeNull();
    await mutateStore((store) => {
      store.sites.find((item) => item.id === site.id)!.hidden = true;
    });
    expect(findSite(site.id)).toBeNull();
  });

  it("plans boat routes only from and to the Maldives", async () => {
    await expect(getBoatRoute({ lat: 51.5, lon: -0.1 }, "banana-reef")).rejects.toThrow("Routes start in the Maldives");
    await expect(getBoatRoute({ lat: 4.2, lon: 73.5 }, "40.7,-74")).rejects.toThrow("Bad destination");
  });
});
