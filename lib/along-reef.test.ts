import { describe, expect, it } from "vitest";
import { ALONG_REEF_TIDE_GAIN, alongReefHours, alongReefStrength } from "./forecast";
import { compassWord, nowcastGlance } from "./nowcast-glance";
import type { SiteNowcast } from "./nowcast";
import { alongReefHeading, flowsAlongReef } from "./site-type";
import type { MarineHour, Site } from "./types";

const M2 = 12.42;

/** Three days of hours: an M2 tide, and a current along north/south of `tide·sin + drift` m/s, plus an east part. */
function series(tideMs: number, driftMs: number, eastMs = 0): MarineHour[] {
  const hours: MarineHour[] = [];
  for (let index = 0; index < 72; index += 1) {
    const day = String(1 + Math.floor(index / 24)).padStart(2, "0");
    const clock = String(index % 24).padStart(2, "0");
    const phase = (2 * Math.PI * index) / M2;
    const north = tideMs * Math.sin(phase) + driftMs;
    hours.push({
      time: `2026-09-${day}T${clock}:00`,
      seaLevelM: 0.5 * Math.sin(phase),
      currentVelocityMs: Math.hypot(north, eastMs),
      currentDirectionDeg: ((Math.atan2(eastMs, north) * 180) / Math.PI + 360) % 360,
    });
  }
  return hours;
}

function turns(directions: readonly string[]): number {
  return directions.slice(1).filter((direction, index) => direction !== directions[index]).length;
}

describe("alongReefHours", () => {
  it("turns with a tidal stream along the reef: toward the heading, then the other way", () => {
    const hours = alongReefHours({ hours: series(0.1, 0), alongHeadingDeg: 0 });
    expect(hours.length).toBeGreaterThan(24);
    const directions = hours.map((hour) => hour.direction);
    expect(directions).toContain("incoming");
    expect(directions).toContain("outgoing");
    // An M2 stream turns about four times a day.
    expect(turns(directions) / (hours.length / 24)).toBeGreaterThan(3);
  });

  it("reads 'incoming' as toward the heading: a stream running south is incoming for a heading of 180", () => {
    const north = alongReefHours({ hours: series(0, 0.3), alongHeadingDeg: 0 });
    const south = alongReefHours({ hours: series(0, 0.3), alongHeadingDeg: 180 });
    expect(north.every((hour) => hour.direction === "incoming")).toBe(true);
    expect(south.every((hour) => hour.direction === "outgoing")).toBe(true);
  });

  it("gives slack for a current straight across the reef", () => {
    const hours = alongReefHours({ hours: series(0, 0, 0.8), alongHeadingDeg: 0 });
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((hour) => hour.strength === "slack")).toBe(true);
  });

  it("scales the tide, not the drift: a drift larger than the raw stream still lets it turn", () => {
    // Raw tide 0.1 m/s against 0.2 m/s of drift never turns; scaled by the gain it outruns the drift.
    expect(ALONG_REEF_TIDE_GAIN * 0.1).toBeGreaterThan(0.2);
    const hours = alongReefHours({ hours: series(0.1, 0.2), alongHeadingDeg: 0 });
    const directions = hours.map((hour) => hour.direction);
    expect(turns(directions)).toBeGreaterThan(0);
    // The drift lengthens the way it runs.
    const incoming = directions.filter((direction) => direction === "incoming").length;
    expect(incoming).toBeGreaterThan(directions.length / 2);
  });

  it("lets a drift stronger than the scaled tide hold one way", () => {
    const hours = alongReefHours({ hours: series(0.05, 0.4), alongHeadingDeg: 0 });
    expect(hours.every((hour) => hour.direction === "incoming")).toBe(true);
  });

  it("is always low confidence and keeps the tide level", () => {
    const hours = alongReefHours({ hours: series(0.1, 0), alongHeadingDeg: 0 });
    expect(hours.every((hour) => hour.confidence === "low")).toBe(true);
    expect(hours.some((hour) => hour.levelM > 0.3)).toBe(true);
  });
});

describe("alongReefStrength", () => {
  it("bands the along-reef index", () => {
    expect(alongReefStrength(0.1)).toBe("slack");
    expect(alongReefStrength(0.3)).toBe("mild");
    expect(alongReefStrength(0.7)).toBe("strong");
    expect(alongReefStrength(1.2)).toBe("too_strong");
  });
});

describe("flowsAlongReef", () => {
  const wall = { id: "wall", name: "Long Wall", siteType: "outer-reef" as const, atollId: "a", lat: 4, lon: 73.5 };
  const pass = (lat: number, atollId = "a"): Pick<Site, "id" | "siteType" | "atollId" | "lat" | "lon"> => ({
    id: `pass-${lat}-${atollId}`,
    siteType: "pass",
    atollId,
    lat,
    lon: 73.5,
  });

  it("takes outer walls, not corners, passes, thilas or lagoon sites", () => {
    expect(flowsAlongReef(wall)).toBe(true);
    expect(flowsAlongReef({ ...wall, name: "Cocoa Corner" })).toBe(false);
    expect(flowsAlongReef({ ...wall, siteType: "pass" })).toBe(false);
    expect(flowsAlongReef({ ...wall, siteType: "channel-thila" })).toBe(false);
    expect(flowsAlongReef({ ...wall, siteType: "lagoon" })).toBe(false);
    expect(flowsAlongReef({ ...wall, siteType: undefined })).toBe(false);
  });

  it("leaves a wall in a channel's funnel across the rim", () => {
    // 0.5 km from a pass in the same atoll: the channel's draw takes over.
    expect(flowsAlongReef(wall, [pass(4.0045)])).toBe(false);
    // 1.1 km away, or in another atoll, it is an open wall.
    expect(flowsAlongReef(wall, [pass(4.01)])).toBe(true);
    expect(flowsAlongReef(wall, [pass(4.0045, "b")])).toBe(true);
  });

  it("turns the inward bearing 90° clockwise for the reef heading", () => {
    expect(alongReefHeading(0)).toBe(90);
    expect(alongReefHeading(300)).toBe(30);
  });
});

describe("along-reef glance", () => {
  function glance(direction: "incoming" | "outgoing", strength: "mild" | "too_strong" = "mild") {
    const nowcast: SiteNowcast = {
      siteId: "wall",
      atollId: "a",
      inwardBearingDeg: 270,
      alongHeadingDeg: 0,
      unavailable: false,
      hour: { time: "2026-09-23T10:00", direction, strength, confidence: "low", levelM: 0.1 },
    };
    return nowcastGlance("Wall", nowcast, true);
  }

  it("names compass points", () => {
    expect(compassWord(0)).toBe("N");
    expect(compassWord(44)).toBe("NE");
    expect(compassWord(200)).toBe("S");
    expect(compassWord(-30)).toBe("NW");
  });

  it("points along the reef and says which way, in a neutral colour", () => {
    expect(glance("incoming").arrowBearing).toBe(0);
    expect(glance("incoming").way).toBe("running N");
    expect(glance("outgoing").arrowBearing).toBe(180);
    expect(glance("outgoing").spoken).toBe("Wall, running S along the reef, mild, low");
    expect(glance("incoming").color).toBe("var(--foam)");
    expect(glance("incoming", "too_strong").color).toBe("var(--stop)");
  });
});
