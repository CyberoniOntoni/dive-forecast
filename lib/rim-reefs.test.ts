import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRimReefs } from "./rim-reefs";

const RING = [7300000, 400000, 100, 0, 0, 100, -100, 0, 0, -100];

describe("parseRimReefs", () => {
  it("keeps each outline's shapes, outer ring then pools", () => {
    const reefs = parseRimReefs(JSON.stringify({ reefs: { "1": [[RING, RING]], "2": [] } }));
    expect(reefs.get("1")).toEqual([[RING, RING]]);
    expect(reefs.get("2")).toEqual([]);
  });

  it("throws on anything else, so a corrupt file never passes for no reefs", () => {
    expect(() => parseRimReefs("{")).toThrow();
    expect(() => parseRimReefs(JSON.stringify({ reefs: [] }))).toThrow(/not a map/);
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": {} } }))).toThrow(/not a list/);
    // A flat ring where a shape belongs (the file's older form), a short ring, an odd-length ring, a fraction.
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [RING] } }))).toThrow(/shape 0/);
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [[RING.slice(0, 6)]] } }))).toThrow(/shape 0/);
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [[RING.slice(0, 9)]] } }))).toThrow(/shape 0/);
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [[[...RING.slice(0, 9), 0.5]]] } }))).toThrow(/shape 0/);
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [[]] } }))).toThrow(/shape 0/);
    // A ring that does not come back to its first point.
    expect(() => parseRimReefs(JSON.stringify({ reefs: { "1": [[[...RING.slice(0, 8), 0, -99]]] } }))).toThrow(/shape 0/);
  });
});

describe("readRimReefs", () => {
  const cwd = process.cwd();
  let dir = "";
  afterEach(() => {
    process.chdir(cwd);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("reads no reefs from a missing file, so the flow layer walls every outline as before", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rim-reefs-"));
    process.chdir(dir);
    vi.resetModules();
    const { readRimReefs } = await import("./rim-reefs");
    expect(readRimReefs().size).toBe(0);
  });
});
