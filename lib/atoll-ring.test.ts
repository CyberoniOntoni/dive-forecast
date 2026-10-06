import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { atollRing, clearRingMemo, ringSamples, RING_POINTS } from "./atoll-ring";
import { marineCacheDir } from "./marine";
import { rimForAtoll } from "./rim";
import type { Atoll, MarineHour } from "./types";

const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "sites.json"), "utf8")) as {
  atolls: Atoll[];
};
const atoll = catalog.atolls.find((item) => rimForAtoll(item) != null) as Atoll;

const HOURS: MarineHour[] = Array.from({ length: 72 }, (_, index) => ({
  time: `2026-09-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`,
  seaLevelM: 0.4 * Math.sin((2 * Math.PI * index) / 12.42),
  currentVelocityMs: 0,
  currentDirectionDeg: 0,
}));

function cacheFile(lat: number, lon: number): string {
  const name = `${lat.toFixed(4)}_${lon.toFixed(4)}.json`.replace(/[^0-9.+_-]/g, "");
  return path.join(marineCacheDir(), name);
}

function cachePoint(point: { lat: number; lon: number }): void {
  fs.mkdirSync(marineCacheDir(), { recursive: true });
  fs.writeFileSync(cacheFile(point.lat, point.lon), JSON.stringify({ fetchedAt: Date.now(), hours: HOURS }));
}

describe("atollRing", () => {
  afterEach(() => {
    clearRingMemo();
    for (const sample of ringSamples(rimForAtoll(atoll)!)) fs.rmSync(cacheFile(sample.seaward.lat, sample.seaward.lon), { force: true });
  });

  it("does not keep a ring whose points are still pending their first fetch", async () => {
    const samples = ringSamples(rimForAtoll(atoll)!);
    expect(samples).toHaveLength(RING_POINTS);
    samples.slice(0, 10).forEach((sample) => cachePoint(sample.seaward));

    const partial = await atollRing(atoll, { wait: false });
    expect(partial.pending).toBe(2);
    expect(partial.level.length).toBeGreaterThan(0);
    expect(partial.series.filter((series) => series == null)).toHaveLength(2);

    // The next load picks up the points that have arrived since, instead of the lopsided ring.
    samples.slice(10).forEach((sample) => cachePoint(sample.seaward));
    const full = await atollRing(atoll, { wait: false });
    expect(full.pending).toBe(0);
    expect(full.series.every((series) => series != null)).toBe(true);

    // A complete ring is kept.
    fs.rmSync(cacheFile(samples[0].seaward.lat, samples[0].seaward.lon));
    expect(await atollRing(atoll, { wait: false })).toBe(full);
  });
});
