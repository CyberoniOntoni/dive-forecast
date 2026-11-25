import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addReport, addUserSite, findSite, listMergedSites, mutateStore, readStore, saveRating, setStoreDir, setStorePath } from "./store";
import { UNSEEDED_ATOLL_ID, type Report, type Site } from "./types";

// The store under test lives in a fresh temp dir per test, never in data/ (CLAUDE.md § Tests layout).
let DATA_DIR = "";
let testFile = "";

beforeEach(() => {
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  testFile = `.store-test-${crypto.randomUUID()}.json`;
  setStoreDir(DATA_DIR);
  setStorePath(testFile);
});

afterEach(() => {
  setStorePath("store.json");
  setStoreDir(null);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
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
  return fs.readdirSync(DATA_DIR).filter((name) => /^\.store\..*\.tmp$/.test(name));
}

describe("readStore", () => {
  it("returns an empty store when the file is missing", () => {
    expect(readStore()).toEqual({ reports: [], ratings: [], sites: [], users: [], logins: [], plans: [], flags: [], siteEdits: [] });
  });

  it("quarantines truncated JSON and returns an empty store", () => {
    const truncated = '{"reports":[{"id":"r1"';
    fs.writeFileSync(path.join(DATA_DIR, testFile), truncated);
    expect(readStore()).toEqual({ reports: [], ratings: [], sites: [], users: [], logins: [], plans: [], flags: [], siteEdits: [] });
    const corrupt = fs.readdirSync(DATA_DIR).filter((name) => name.startsWith(`${testFile}.corrupt.`));
    expect(corrupt).toHaveLength(1);
    expect(fs.readFileSync(path.join(DATA_DIR, corrupt[0]), "utf8")).toBe(truncated);
    expect(fs.existsSync(path.join(DATA_DIR, testFile))).toBe(false);
  });

  it("returns empty store when quarantine rename fails", () => {
    const truncated = '{"reports":[{"id":"r1"';
    fs.writeFileSync(path.join(DATA_DIR, testFile), truncated);
    const renameError = new Error("rename failed");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw renameError;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readStore()).toEqual({ reports: [], ratings: [], sites: [], users: [], logins: [], plans: [], flags: [], siteEdits: [] });
      expect(errorSpy).toHaveBeenCalledWith("Failed to quarantine corrupt store file", renameError);
      expect(fs.existsSync(path.join(DATA_DIR, testFile))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("throws other IO errors", () => {
    fs.mkdirSync(path.join(DATA_DIR, testFile));
    expect(() => readStore()).toThrow();
  });
});

describe("writeStore", () => {
  it("leaves no leftover .store.*.tmp after a write", async () => {
    await addReport(sampleReport("r1"));
    expect(tmpLeftovers()).toEqual([]);
    expect(fs.existsSync(path.join(DATA_DIR, testFile))).toBe(true);
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

  it("replaces a rating for the same site, keeping when it was first given", async () => {
    await saveRating({ siteId: "banana-reef", score: 3, updatedAt: "2026-09-23T10:00:00.000Z" });
    await saveRating({ siteId: "banana-reef", score: 5, updatedAt: "2026-09-23T11:00:00.000Z" });
    expect(readStore().ratings).toEqual([
      { siteId: "banana-reef", score: 5, updatedAt: "2026-09-23T11:00:00.000Z", firstRatedAt: "2026-09-23T10:00:00.000Z" },
    ]);
  });
});

describe("listMergedSites atoll for app-added pins", () => {
  it("re-derives a stored pin's atoll from where it sits", async () => {
    const wrong = { ...sampleSite("pin-a"), atollId: "vaavu", lat: 4.2342, lon: 73.534, sourceUrl: "user" };
    // Haa Alif Atoll, which has no seeded outline.
    const far = { ...sampleSite("pin-b"), atollId: "vaavu", lat: 6.95, lon: 72.95, sourceUrl: "user" };
    await addUserSite(wrong);
    await addUserSite(far);
    const merged = listMergedSites();
    expect(merged.find((site) => site.id === "pin-a")?.atollId).toBe("north-male");
    expect(merged.find((site) => site.id === "pin-b")?.atollId).toBe(UNSEEDED_ATOLL_ID);
  });
});

describe("divers' site texts", () => {
  it("lays an approved edit over a catalog site, never a waiting one, and leaves the catalog record alone", async () => {
    const before = findSite("banana-reef")!;
    const edit = (id: string, status: "approved" | "pending", description: string) => ({
      id,
      siteId: "banana-reef",
      userId: "ann",
      createdAt: "2026-11-25T00:00:00Z",
      status,
      changes: { description },
      based: { description: "" },
      ...(status === "approved" ? { reviewedAt: "2026-11-25T01:00:00Z", reviewerId: "mod" } : {}),
    });
    await mutateStore((store) => {
      store.siteEdits.push(edit("e1", "approved", "A sheltered reef."), edit("e2", "pending", "Spam"));
    });
    const after = findSite("banana-reef")!;
    expect(after.description).toBe("A sheltered reef.");
    expect(after.howToDive).toBe(before.howToDive);
    expect(listMergedSites().filter((site) => site.description === "Spam")).toEqual([]);
  });
});
