import { describe, expect, it } from "vitest";
import { requireSiteDetails } from "./site-details";

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
