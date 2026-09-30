import { describe, expect, it } from "vitest";
import { matchGuideSite, nameSimilarity, parseDepthRange, siteIdFor } from "./dive-guide";

describe("nameSimilarity", () => {
  it("treats spelling variants and kind words as the same site", () => {
    expect(nameSimilarity("Dhevana Kandu", "Devana Kandu")).toBe(1);
    expect(nameSimilarity("Fotteyo", "Fotteyo Kandu")).toBe(1);
    expect(nameSimilarity("Himendhoo Thila", "Himandhoo Thila")).toBeGreaterThan(0.72);
    expect(nameSimilarity("Rasdhoo-Madivaru", "Rasdhoo Madivaru")).toBe(1);
  });

  it("keeps different places apart", () => {
    expect(nameSimilarity("Miyaru Kandu", "Alimatha house reef")).toBeLessThan(0.4);
    expect(nameSimilarity("Coral Garden", "Vaadhoo Caves")).toBeLessThan(0.4);
  });
});

describe("matchGuideSite", () => {
  const seeded = [
    { id: "miyaru-kandu", name: "Miyaru Kandu", lat: 3.583, lon: 73.508 },
    { id: "alimatha-house-reef", name: "Alimatha house reef", lat: 3.628, lon: 73.506 },
  ];

  it("matches the same site under another spelling", () => {
    const verdict = matchGuideSite({ name: "Miyaru Kandu", lat: 3.585, lon: 73.51 }, seeded);
    expect(verdict).toMatchObject({ kind: "match", siteId: "miyaru-kandu" });
  });

  it("asks a person when a different name sits on the same spot", () => {
    const verdict = matchGuideSite({ name: "Manta Point", lat: 3.629, lon: 73.506 }, seeded);
    expect(verdict).toMatchObject({ kind: "review", siteId: "alimatha-house-reef", reason: "different name, same spot" });
  });

  it("asks a person when a similar name is a few km away", () => {
    const verdict = matchGuideSite({ name: "Miyaru Kandu", lat: 3.61, lon: 73.508 }, seeded);
    expect(verdict).toMatchObject({ kind: "review", siteId: "miyaru-kandu", reason: "similar name, pins apart" });
  });

  it("calls anything else new", () => {
    expect(matchGuideSite({ name: "Fulidhoo Caves", lat: 3.683, lon: 73.416 }, seeded)).toEqual({ kind: "new" });
  });
});

describe("parseDepthRange", () => {
  it("reads the guide's formats", () => {
    expect(parseDepthRange("6m - 25m")).toEqual({ diveTopM: 6, diveMaxM: 25 });
    expect(parseDepthRange("25m - 40m")).toEqual({ diveTopM: 25, diveMaxM: 40 });
    expect(parseDepthRange("30m")).toEqual({ diveMaxM: 30 });
    expect(parseDepthRange(null)).toEqual({});
    expect(parseDepthRange("deep")).toEqual({});
  });
});

describe("siteIdFor", () => {
  it("makes a kebab-case id and avoids ids in use", () => {
    expect(siteIdFor("Fulidhoo Caves", new Set())).toBe("fulidhoo-caves");
    expect(siteIdFor("Manta Point", new Set(["manta-point"]))).toBe("manta-point-2");
  });
});
