import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addReportAction, addSite, rateSite } from "./actions";
import { setStorePath } from "./store";

const LIVE_STORE = path.join(process.cwd(), "data", "store.json");

let tempDir = "";
let liveSnapshot = "";

beforeEach(() => {
  liveSnapshot = fs.readFileSync(LIVE_STORE, "utf8");
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dive-actions-"));
  setStorePath(path.join(tempDir, "store.json"));
});

afterEach(() => {
  setStorePath(LIVE_STORE);
  fs.rmSync(tempDir, { recursive: true, force: true });
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

describe("rateSite", () => {
  it("rejects 3.5, 6, and 0 for banana-reef", async () => {
    // C4
    await expect(rateSite("banana-reef", 3.5)).rejects.toThrow();
    await expect(rateSite("banana-reef", 6)).rejects.toThrow();
    await expect(rateSite("banana-reef", 0)).rejects.toThrow();
  });
});

describe("addReportAction", () => {
  it("returns an error state instead of throwing", async () => {
    const state = await addReportAction("", new FormData());
    expect(state).toEqual({ success: false, error: expect.any(String) });
    expect(state.error).toBeTruthy();
  });
});
