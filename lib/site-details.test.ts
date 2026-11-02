import { describe, expect, it } from "vitest";
import { DIVER_SITE_TYPES, DIVER_SITE_TYPE_LABEL, requireSiteDetails } from "./site-details";
import { SITE_TYPES } from "./types";

describe("requireSiteDetails", () => {
  it("keeps a picked type, depths and notes", () => {
    expect(
      requireSiteDetails({ diverSiteType: "lagoon", diveTopM: "5", diveMaxM: 28.26, howToDive: "  Drop on the east side.\r\n\n\n\nHook in.  " }),
    ).toEqual({ diverSiteType: "lagoon", diveTopM: 5, diveMaxM: 28.3, howToDive: "Drop on the east side.\n\nHook in." });
  });

  it("leaves out what was not given", () => {
    expect(requireSiteDetails({ diverSiteType: "", diveTopM: "", howToDive: "   " })).toEqual({});
  });

  it("refuses a type the form does not offer, including the owner-set strait wall", () => {
    expect(() => requireSiteDetails({ diverSiteType: "wreck" })).toThrow(/type/);
    expect(() => requireSiteDetails({ diverSiteType: "strait-wall" })).toThrow(/type/);
  });

  it("refuses depths out of range or the wrong way round", () => {
    expect(() => requireSiteDetails({ diveMaxM: 140 })).toThrow(/0 to 100/);
    expect(() => requireSiteDetails({ diveTopM: -1 })).toThrow(/0 to 100/);
    expect(() => requireSiteDetails({ diveTopM: "abc" })).toThrow(/0 to 100/);
    expect(() => requireSiteDetails({ diveTopM: 30, diveMaxM: 10 })).toThrow(/shallowest/);
  });

  it("refuses notes over 1500 characters and drops control characters", () => {
    expect(() => requireSiteDetails({ howToDive: "a".repeat(1501) })).toThrow(/1500/);
    expect(requireSiteDetails({ howToDive: "a\u0000b\u0007c" }).howToDive).toBe("abc");
    expect(() => requireSiteDetails({ howToDive: 12 })).toThrow(/text/);
  });
});

describe("DIVER_SITE_TYPE_LABEL", () => {
  it("has a label for every site type, the form's own for the ones it offers", () => {
    for (const type of SITE_TYPES) expect(DIVER_SITE_TYPE_LABEL[type]).toBeTruthy();
    for (const option of DIVER_SITE_TYPES) expect(DIVER_SITE_TYPE_LABEL[option.type]).toBe(option.label);
  });
});

it("keeps a dive that starts at the surface", () => {
  expect(requireSiteDetails({ diveTopM: 0, diveMaxM: 12 })).toEqual({ diveTopM: 0, diveMaxM: 12 });
});
