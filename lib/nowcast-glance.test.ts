import { describe, expect, it } from "vitest";
import { glanceColor, glanceRank, nowcastGlance, passArrowBearing } from "./nowcast-glance";
import type { SiteNowcast } from "./nowcast";
import type { Direction, Strength } from "./types";

function glanceFor(name: string, strength: Strength, direction: Direction) {
  const nowcast: SiteNowcast = {
    siteId: name,
    atollId: "atoll",
    inwardBearingDeg: 90,
    outgoingBearingDeg: null,
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
  const base: SiteNowcast = { siteId: "s", atollId: "a", inwardBearingDeg: 90, outgoingBearingDeg: null, unavailable: false, hour };

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
