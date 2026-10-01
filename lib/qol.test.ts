import { describe, expect, it } from "vitest";
import { ARROW_LENGTH, ARROW_WIDTH, arrowPath, arrowSvgBody } from "./arrow-shape";
import { loadMapView, loadSheetOpen, parseMapView, saveMapView, saveSheetOpen } from "./map-view";
import { recentReportRows } from "./recent-reports";
import { STRENGTHS, type Report } from "./types";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const blocked: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("recentReportRows", () => {
  const report = (time: string, extra: Partial<Report> = {}): Report => ({
    id: time,
    siteId: "s",
    time,
    direction: "incoming",
    strength: "strong",
    ...extra,
  });
  const now = "2026-10-01T12:00";

  it("lists the newest first, at most ten", () => {
    const reports = Array.from({ length: 12 }, (_, day) => report(`2026-09-${String(day + 10).padStart(2, "0")}T09:00`));
    const rows = recentReportRows(reports, { nowWall: now, siteOnAxis: false });
    expect(rows).toHaveLength(10);
    expect(rows[0].time).toBe("2026-09-21T09:00");
    expect(rows[9].time).toBe("2026-09-12T09:00");
  });

  it("gives the Maldives wall time and how long ago", () => {
    const [row] = recentReportRows([report("2026-09-30T09:00")], { nowWall: now, siteOnAxis: false });
    expect(row.when).toBe("Wed 30 Sep 09:00");
    expect(row.ago).toBe("1 day ago");
    const [recent] = recentReportRows([report("2026-10-01T09:00")], { nowWall: now, siteOnAxis: false });
    expect(recent.ago).toBe("3 hours ago");
  });

  it("says incoming or outgoing at a channel, and very strong for the top band", () => {
    const [row] = recentReportRows([report("2026-09-30T09:00", { direction: "outgoing", strength: "too_strong" })], {
      nowWall: now,
      siteOnAxis: false,
    });
    expect(row.way).toBe("Outgoing");
    expect(row.strength).toBe("very strong");
    expect(row.beforeAxis).toBe(false);
  });

  it("reads a wall or lagoon report, and its forecast, as compass directions from the saved heading", () => {
    const [row] = recentReportRows(
      [
        report("2026-09-30T09:00", {
          direction: "outgoing",
          alongHeadingDeg: 45,
          predicted: {
            modelVersion: "x/12",
            nudge: "drift",
            issuedAt: null,
            stale: false,
            bearingDeg: 315,
            bearingSource: "rim-derived",
            shown: { direction: "incoming", strength: "mild", confidence: "low" },
            modelOnly: null,
          },
        }),
      ],
      { nowWall: now, siteOnAxis: true },
    );
    expect(row.way).toBe("Running SW");
    expect(row.forecast).toEqual({ way: "Running NE", strength: "mild", match: "miss" });
    expect(row.beforeAxis).toBe(false);
  });

  it("marks a wall or lagoon report filed before the site had an axis", () => {
    const [row] = recentReportRows([report("2026-09-30T09:00")], { nowWall: now, siteOnAxis: true });
    expect(row.way).toBe("Incoming");
    expect(row.beforeAxis).toBe(true);
    expect(row.forecast).toBeNull();
  });

  it("calls a forecast a match, close or a miss", () => {
    const withForecast = (strength: Report["strength"], shown: { direction: Report["direction"]; strength: Report["strength"] }) =>
      recentReportRows(
        [
          report("2026-09-30T09:00", {
            strength,
            predicted: {
              modelVersion: "x/12",
              nudge: "drift",
              issuedAt: null,
              stale: false,
              bearingDeg: 90,
              bearingSource: "override",
              shown: { ...shown, confidence: "low" },
              modelOnly: null,
            },
          }),
        ],
        { nowWall: now, siteOnAxis: false },
      )[0].forecast?.match;
    expect(withForecast("strong", { direction: "incoming", strength: "mild" })).toBe("match");
    expect(withForecast("too_strong", { direction: "incoming", strength: "mild" })).toBe("close");
    expect(withForecast("strong", { direction: "outgoing", strength: "strong" })).toBe("miss");
    // Slack has no direction to compare.
    expect(withForecast("slack", { direction: "outgoing", strength: "mild" })).toBe("match");
  });
});

describe("saved map view", () => {
  it("round-trips the view and the phone list's state", () => {
    const storage = memoryStorage();
    expect(loadMapView(storage)).toBeNull();
    saveMapView({ lat: 4.2, lon: 73.5, zoom: 12 }, storage);
    expect(loadMapView(storage)).toEqual({ lat: 4.2, lon: 73.5, zoom: 12 });
    expect(loadSheetOpen(storage)).toBe(false);
    saveSheetOpen(true, storage);
    expect(loadSheetOpen(storage)).toBe(true);
  });

  it("ignores a damaged or impossible view", () => {
    expect(parseMapView("not json")).toBeNull();
    expect(parseMapView(JSON.stringify({ lat: 4, lon: 73 }))).toBeNull();
    expect(parseMapView(JSON.stringify({ lat: 400, lon: 73, zoom: 10 }))).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    expect(() => saveMapView({ lat: 4, lon: 73, zoom: 10 }, blocked)).not.toThrow();
    expect(loadMapView(blocked)).toBeNull();
    expect(() => saveSheetOpen(true, blocked)).not.toThrow();
    expect(loadSheetOpen(blocked)).toBe(false);
  });
});

describe("arrow shape", () => {
  it("grows longer with strength", () => {
    const lengths = STRENGTHS.map((strength) => ARROW_LENGTH[strength]);
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
    expect(new Set(lengths).size).toBe(STRENGTHS.length);
  });

  it("draws a closed path from the tip at the top centre to the tail at the bottom", () => {
    const path = arrowPath(ARROW_LENGTH.strong);
    expect(path.startsWith(`M${ARROW_WIDTH / 2} 0`)).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).not.toMatch(/NaN|undefined/);
    const ys = [...path.matchAll(/[ML] ?[\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(ARROW_LENGTH.strong);
  });

  it("is solid for a known heading and see-through with an edge for an estimate", () => {
    expect(arrowSvgBody("mild", false)).toContain('fill="currentColor"');
    expect(arrowSvgBody("mild", false)).not.toContain("fill-opacity");
    const estimated = arrowSvgBody("mild", true);
    expect(estimated).toContain('fill-opacity="0.22"');
    expect(estimated).toContain('stroke="currentColor"');
  });
});
