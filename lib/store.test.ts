import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addReport, addUserSite, readStore, saveRating, setStorePath } from "./store";
import type { Report, Site } from "./types";

const LIVE_STORE = path.join(process.cwd(), "data", "store.json");

let tempDir = "";
let liveSnapshot = "";

beforeEach(() => {
  liveSnapshot = fs.readFileSync(LIVE_STORE, "utf8");
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dive-store-"));
  setStorePath(path.join(tempDir, "store.json"));
});

afterEach(() => {
  setStorePath(LIVE_STORE);
  fs.rmSync(tempDir, { recursive: true, force: true });
  expect(fs.readFileSync(LIVE_STORE, "utf8")).toBe(liveSnapshot);
});

function sampleReport(id: string): Report {
  return {
    id,
    siteId: "banana-reef",
    time: "2026-09-23T10:00",
    direction: "incoming",
    strength: "mild",
  };
}

function sampleSite(id: string): Site {
  return {
    id,
    name: id,
    atollId: "north-male",
    lat: 4.3,
    lon: 73.5,
    sourceUrl: "user",
  };
}

function tmpLeftovers() {
  return fs.readdirSync(tempDir).filter((name) => /^\.store\..*\.tmp$/.test(name));
}

describe("readStore", () => {
  it("returns an empty store when the file is missing", () => {
    expect(readStore()).toEqual({ reports: [], ratings: [], sites: [] });
  });

  it("quarantines truncated JSON and returns an empty store", () => {
    const truncated = '{"reports":[{"id":"r1"';
    fs.writeFileSync(path.join(tempDir, "store.json"), truncated);
    expect(readStore()).toEqual({ reports: [], ratings: [], sites: [] });
    const corrupt = fs.readdirSync(tempDir).filter((name) => name.startsWith("store.json.corrupt."));
    expect(corrupt).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempDir, corrupt[0]), "utf8")).toBe(truncated);
    expect(fs.existsSync(path.join(tempDir, "store.json"))).toBe(false);
  });

  it("throws other IO errors", () => {
    fs.mkdirSync(path.join(tempDir, "store.json"));
    expect(() => readStore()).toThrow();
  });
});

describe("writeStore", () => {
  it("leaves no leftover .store.*.tmp after a write", async () => {
    await addReport(sampleReport("r1"));
    expect(tmpLeftovers()).toEqual([]);
    expect(fs.existsSync(path.join(tempDir, "store.json"))).toBe(true);
  });
});

describe("mutateStore", () => {
  it("keeps all 15 concurrent addReport calls", async () => {
    const ids = Array.from({ length: 15 }, (_, index) => `r${index}`);
    await Promise.all(ids.map((id) => addReport(sampleReport(id))));
    const stored = readStore()
      .reports.map((report) => report.id)
      .sort();
    expect(stored).toEqual([...ids].sort());
    expect(tmpLeftovers()).toEqual([]);
  });

  it("skips a duplicate user site id", async () => {
    const site = sampleSite("user-pass");
    await addUserSite(site);
    await addUserSite({ ...site, name: "Other" });
    expect(readStore().sites).toEqual([site]);
  });

  it("replaces a rating for the same site", async () => {
    await saveRating({ siteId: "banana-reef", score: 3, updatedAt: "2026-09-23T10:00:00.000Z" });
    await saveRating({ siteId: "banana-reef", score: 5, updatedAt: "2026-09-23T11:00:00.000Z" });
    expect(readStore().ratings).toEqual([
      { siteId: "banana-reef", score: 5, updatedAt: "2026-09-23T11:00:00.000Z" },
    ]);
  });
});
