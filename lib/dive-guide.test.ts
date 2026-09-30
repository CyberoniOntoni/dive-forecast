import { describe, expect, it } from "vitest";
import { atollForGuideCode, matchGuideSite, nameSimilarity, parseDepthRange, siteIdFor } from "./dive-guide";

describe("nameSimilarity", () => {
  it("treats spelling variants and kind words as the same site", () => {
    expect(nameSimilarity("Dhevana Kandu", "Devana Kandu")).toBe(1);
    expect(nameSimilarity("Fotteyo", "Fotteyo Kandu")).toBe(1);
    expect(nameSimilarity("Himendhoo Thila", "Himandhoo Thila")).toBeGreaterThan(0.72);
    expect(nameSimilarity("Rasdhoo-Madivaru", "Rasdhoo Madivaru")).toBe(1);
  });

  it("keeps different kinds of site on one reef apart", () => {
    expect(nameSimilarity("Kandooma Caves", "Kandooma Thila")).toBeLessThanOrEqual(0.5);
    expect(nameSimilarity("Embudhu Thila", "Embudhoo Express")).toBeLessThanOrEqual(0.5);
    expect(nameSimilarity("Vaadhoo Housereef", "Vaadhoo Caves")).toBeLessThanOrEqual(0.5);
    // An express is a kandu, so these are one site.
    expect(nameSimilarity("Embudhoo Kandu", "Embudhoo Express")).toBe(1);
    expect(nameSimilarity("Kuda Giri Wreck", "Kuda Giri")).toBe(1);
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

  it("prefers the seeded site with the same name when two match at the same spot", () => {
    const twins = [
      { id: "fesdhoo", name: "Fesdhoo", lat: 3.9994, lon: 72.786 },
      { id: "fesdu-wreck", name: "Fesdu Wreck", lat: 3.9995, lon: 72.7861 },
    ];
    expect(matchGuideSite({ name: "Fesdu Wreck", lat: 3.995, lon: 72.785 }, twins)).toMatchObject({
      kind: "match",
      siteId: "fesdu-wreck",
    });
  });

  it("calls anything else new", () => {
    expect(matchGuideSite({ name: "Fulidhoo Caves", lat: 3.683, lon: 73.416 }, seeded)).toEqual({ kind: "new" });
  });
});

describe("atollForGuideCode", () => {
  const ari = "https://www.openstreetmap.org/way/671807122";
  const atolls = [
    { id: "north-ari", rimSourceUrl: ari },
    { id: "south-ari", rimSourceUrl: ari },
    { id: "rasdhoo", rimSourceUrl: "https://www.openstreetmap.org/way/671807123" },
    { id: "vaavu", rimSourceUrl: "https://www.openstreetmap.org/way/671807115" },
  ];
  const byId = (id: string) => atolls.find((atoll) => atoll.id === id)!;

  it("lets the guide's code split the shared Ari outline", () => {
    expect(atollForGuideCode(byId("north-ari"), atolls, "ADh").id).toBe("south-ari");
    expect(atollForGuideCode(byId("south-ari"), atolls, "AA").id).toBe("north-ari");
    expect(atollForGuideCode(byId("north-ari"), atolls, "AA").id).toBe("north-ari");
  });

  it("never moves a site to an atoll with a different outline", () => {
    expect(atollForGuideCode(byId("rasdhoo"), atolls, "AA").id).toBe("rasdhoo");
    expect(atollForGuideCode(byId("vaavu"), atolls, "ADh").id).toBe("vaavu");
    expect(atollForGuideCode(byId("vaavu"), atolls, "V").id).toBe("vaavu");
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
