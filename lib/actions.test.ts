import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addReport, addReportAction, addSite, rateSite } from "./actions";
import { inwardBearingDeg } from "./bearing";
import { FORECAST_MODEL_VERSION } from "./forecast";
import { marineCacheDir, seawardPoint } from "./marine";
import { seawardKmFor } from "./seaward-floor";
import { rimForAtoll } from "./rim";
import { readCatalog, setStorePath } from "./store";
import { UNSEEDED_ATOLL_ID } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const LIVE_STORE = path.join(DATA_DIR, "store.json");

let testFile = "";
let liveSnapshot = "";

beforeEach(() => {
  liveSnapshot = fs.readFileSync(LIVE_STORE, "utf8");
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStorePath(testFile);
});

afterEach(() => {
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
    // Laamu Atoll: about 90 km from Meemu, the nearest seeded atoll.
    const site = await addSite({ name: "Laamu Test", lat: 1.95, lon: 73.45 });
    expect(site.atollId).toBe(UNSEEDED_ATOLL_ID);
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

  it("refuses a dive time more than an hour ahead of the site's clock", async () => {
    // Two hours ahead of now in the Maldives: almost always a time entered in the diver's own zone.
    const ahead = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await expect(
      addReport({ siteId: "banana-reef", time: ahead, direction: "outgoing", strength: "mild" }),
    ).rejects.toThrow("still ahead in the Maldives");
  });
});
