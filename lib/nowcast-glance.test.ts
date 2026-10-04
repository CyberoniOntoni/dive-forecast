import { describe, expect, it } from "vitest";
import {
  glanceColor,
  glanceRank,
  nowcastGlance,
  passArrowBearing,
  routeArrowBearing,
  routeDirectionLegend,
  routeWay,
} from "./nowcast-glance";
import type { SiteNowcast } from "./nowcast";
import type { Direction, Strength } from "./types";

function glanceFor(name: string, strength: Strength, direction: Direction) {
  const nowcast: SiteNowcast = {
    siteId: name,
    atollId: "atoll",
    inwardBearingDeg: 90,
    outgoingBearingDeg: null,
    forecastRoute: "channel",
    unavailable: false,
    hour: {
      time: "2026-09-23T10:00",
      direction,
      strength,
      confidence: "low",
      levelM: 0.1,
    },
  };
  return nowcastGlance(name, nowcast, true);
}

describe("glanceRank", () => {
  it("orders too strong, strong, mild, slack, then an empty glance", () => {
    const tooStrong = glanceFor("Too", "too_strong", "outgoing");
    const strong = glanceFor("Strong", "strong", "incoming");
    const mild = glanceFor("Mild", "mild", "outgoing");
    const slack = glanceFor("Slack", "slack", "incoming");
    const empty = nowcastGlance("Empty", undefined, true);

    const ranked = [slack, empty, mild, tooStrong, strong].sort(
      (left, right) => glanceRank(left) - glanceRank(right),
    );

    expect(ranked.map((glance) => glance.strength)).toEqual([
      "too_strong",
      "strong",
      "mild",
      "slack",
      null,
    ]);
    expect(glanceRank(tooStrong)).toBeLessThan(glanceRank(strong));
    expect(glanceRank(strong)).toBeLessThan(glanceRank(mild));
    expect(glanceRank(mild)).toBeLessThan(glanceRank(slack));
    expect(glanceRank(slack)).toBeLessThan(glanceRank(empty));
    expect(tooStrong.strength).toBe("too_strong");
    expect(tooStrong.color).toBe("var(--stop)");
    expect(tooStrong.color).toBe(glanceColor("outgoing", "too_strong"));
    expect(glanceColor("incoming", "too_strong")).toBe("var(--stop)");
    expect(strong.color).toBe("var(--incoming)");
    expect(glanceColor("outgoing", "strong")).toBe("var(--outgoing)");
    expect(mild.color).toBe("var(--outgoing)");
    expect(glanceColor("incoming", "mild")).toBe("var(--incoming)");
    expect(slack.color).toBe("var(--incoming)");
    expect(glanceColor("outgoing", "slack")).toBe("var(--outgoing)");
    expect(empty.strength).toBeNull();
    expect(empty.color).toBeNull();
    expect(tooStrong.color).not.toMatch(/#/);
    expect(strong.color).not.toMatch(/#/);
    expect(mild.color).not.toMatch(/#/);
  });
});

describe("passArrowBearing", () => {
  it("wraps outgoing 270 to 90, not 450", () => {
    // W5: outgoing is ((inwardBearingDeg + 180) % 360 + 360) % 360
    expect(passArrowBearing(270, "outgoing")).toBe(90);
    expect(passArrowBearing(270, "outgoing")).not.toBe(450);
    expect(passArrowBearing(90, "outgoing")).toBe(270);
    expect(passArrowBearing(270, "incoming")).toBe(270);
  });

  it("sets glance arrowBearing from the wrapped outgoing bearing", () => {
    const nowcast: SiteNowcast = {
      siteId: "West",
      atollId: "atoll",
      inwardBearingDeg: 270,
      outgoingBearingDeg: null,
      forecastRoute: "channel",
      unavailable: false,
      hour: {
        time: "2026-09-23T10:00",
        direction: "outgoing",
        strength: "mild",
        confidence: "low",
        levelM: 0.1,
      },
    };
    expect(nowcastGlance("West", nowcast, true).arrowBearing).toBe(90);
  });
});

describe("nowcastGlance heading trust", () => {
  const hour = {
    time: "2026-09-23T10:00",
    direction: "incoming" as const,
    strength: "mild" as const,
    confidence: "medium" as const,
    levelM: 0.1,
  };
  const base: SiteNowcast = { siteId: "s", atollId: "a", inwardBearingDeg: 90, outgoingBearingDeg: null, forecastRoute: "channel", unavailable: false, hour };

  it("marks a fallback heading as estimated in the spoken text", () => {
    const glance = nowcastGlance("Pin", { ...base, bearingSource: "fallback" }, true);
    expect(glance.estimatedHeading).toBe(true);
    expect(glance.spoken).toBe("Pin, incoming, mild, medium, heading estimated");
  });

  it("leaves measured and rim-derived headings unmarked", () => {
    for (const bearingSource of ["override", "rim-derived", null, undefined] as const) {
      const glance = nowcastGlance("Pin", { ...base, bearingSource }, true);
      expect(glance.estimatedHeading).toBe(false);
      expect(glance.spoken).toBe("Pin, incoming, mild, medium");
    }
  });

  it("draws no arrow when there is no bearing, even with an hour", () => {
    const glance = nowcastGlance("Pin", { ...base, inwardBearingDeg: null }, true);
    expect(glance.arrowBearing).toBeNull();
    expect(glance.label).toBeNull();
    expect(glance.estimatedHeading).toBe(false);
  });
});

describe("route words", () => {
  it("says incoming or outgoing on a channel, even with a stray heading", () => {
    expect(routeWay("channel", "incoming", null)).toEqual({ way: "incoming", spoken: "incoming" });
    expect(routeWay("channel", "outgoing", 90)).toEqual({ way: "outgoing", spoken: "outgoing" });
    expect(routeDirectionLegend("channel", null)).toBe("Incoming or outgoing");
  });

  it("calls a strait wall's flow along the reef, as at any wall", () => {
    expect(routeWay("strait", "incoming", 90)).toEqual({ way: "running E", spoken: "running E along the reef" });
    expect(routeWay("along-reef", "outgoing", 0)).toEqual({ way: "running S", spoken: "running S along the reef" });
    expect(routeDirectionLegend("strait", 90)).toBe("Which way along the reef");
    expect(routeDirectionLegend("along-reef", 0)).toBe("Which way along the reef");
  });

  it("does not call a lagoon site's flow a reef's", () => {
    expect(routeWay("lagoon", "incoming", 90)).toEqual({ way: "running E", spoken: "running E" });
    expect(routeDirectionLegend("lagoon", 90)).toBe("Which way it ran");
  });

  it("bends only a channel's outgoing arrow", () => {
    expect(routeArrowBearing("channel", "outgoing", 300, null, 150)).toBe(150);
    expect(routeArrowBearing("strait", "outgoing", 300, 90, 150)).toBe(270);
    expect(routeArrowBearing("lagoon", "incoming", 300, 45)).toBe(45);
  });
});
