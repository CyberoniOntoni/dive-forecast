import { describe, expect, it } from "vitest";
import { boardWords, monthLabel, reporterDetail, sinceLine, sitesUnit } from "./profile-words";

describe("profile words (web pages and the app's API alike)", () => {
  it("words each board, with the month only on this month's", () => {
    expect(boardWords("month").empty).toBe("No reports this month yet. Be the first: open a site after your dive and report the current.");
    expect(boardWords("all").empty).toBe("No reports yet. Be the first: open a site after your dive and report the current.");
    expect(boardWords("all").title).toBe("Current reporters");
    expect(boardWords("sites")).toMatchObject({ title: "Site scouts", empty: "No sites added yet. Know a site that is missing? Add it on the map." });
  });

  it("words a diver's line and counts", () => {
    expect(sinceLine("2026-10", 3)).toBe("Diving with us since Oct 2026 · #3 all time");
    expect(sinceLine("2026-10", null)).toBe("Diving with us since Oct 2026");
    expect(monthLabel("2026-13")).toBe("2026-13");
    expect(sitesUnit(1)).toBe("site");
    expect(sitesUnit(2)).toBe("sites");
    expect(reporterDetail({ reports: 2, sites: 1, ratings: 1, badges: 1 })).toBe("2 reports · 1 site · 1 rating · 1 ★");
  });
});
