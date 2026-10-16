import { describe, expect, it } from "vitest";
import { parseOpenings } from "./openings";

const MOUTH = { atollIds: ["addu"], wayId: "671807083", lat: -0.6, lon: 73.2, widthM: 400, alongM: 300, reefFlatBridges: false, sites: [] };

describe("parseOpenings", () => {
  it("reads mouths with their outline and atolls", () => {
    const [mouth] = parseOpenings(JSON.stringify({ openings: [MOUTH] }));
    expect(mouth).toEqual({ lat: -0.6, lon: 73.2, widthM: 400, wayId: "671807083", atollIds: ["addu"], reefFlatBridges: false });
  });

  it("throws on a corrupt file rather than reading it as no gaps", () => {
    expect(() => parseOpenings('{"openings": [')).toThrow();
    expect(() => parseOpenings(JSON.stringify({ mouths: [] }))).toThrow(/openings is not a list/);
    expect(() => parseOpenings(JSON.stringify({ openings: [{ ...MOUTH, widthM: "400" }] }))).toThrow(/opening 0 has no positive widthM/);
    expect(() => parseOpenings(JSON.stringify({ openings: [{ ...MOUTH, wayId: undefined }] }))).toThrow(/wayId/);
    expect(() => parseOpenings(JSON.stringify({ openings: [{ ...MOUTH, atollIds: [] }] }))).toThrow(/atollIds/);
    expect(() => parseOpenings(JSON.stringify({ openings: [{ ...MOUTH, lat: 200 }] }))).toThrow(/lat/);
  });
});
