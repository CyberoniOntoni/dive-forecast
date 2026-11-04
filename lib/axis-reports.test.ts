import { describe, expect, it } from "vitest";
import { applyAxisReports } from "./axis-reports";
import type { Direction, HourForecast, Report, Strength } from "./types";

/** Twelve hours from 00:00: incoming mild to 05:00, outgoing mild from 06:00. */
function stream(): HourForecast[] {
  return Array.from({ length: 12 }, (_, index) => ({
    time: `2026-11-03T${String(index).padStart(2, "0")}:00`,
    direction: index < 6 ? "incoming" : "outgoing",
    strength: "mild",
    confidence: "low",
    levelM: 0,
  }));
}

function report(id: string, time: string, direction: Direction, strength: Strength): Report {
  return { id, siteId: "wall", time, direction, strength };
}

const asFiled = (item: Report) => item.direction;

describe("applyAxisReports", () => {
  it("changes nothing with no reports, or none it can read", () => {
    expect(applyAxisReports(stream(), [], asFiled)).toEqual(stream());
    const unread = [report("a", "2026-11-03T01:00", "outgoing", "strong")];
    expect(applyAxisReports(stream(), unread, () => null)).toEqual(stream());
  });

  it("pulls the hours after a contradicting report, fading, and stops where the model turns", () => {
    const pulled = applyAxisReports(stream(), [report("a", "2026-11-03T02:00", "outgoing", "mild")], asFiled);
    // Before the report the model stands.
    expect(pulled[1].direction).toBe("incoming");
    // From the report's hour to the turn, the diver's direction wins and confidence is low (it contradicts the model).
    for (const index of [2, 3, 4, 5]) {
      expect(pulled[index].direction).toBe("outgoing");
      expect(pulled[index].confidence).toBe("low");
    }
    // The model turns at 06:00, so the pull stops there.
    expect(pulled[6].direction).toBe("outgoing");
    expect(pulled[7]).toEqual({ ...stream()[7], confidence: "low" });
  });

  it("moves strength by how far the report was from the model at its own hour", () => {
    const agreeing = applyAxisReports(stream(), [report("a", "2026-11-03T01:00", "incoming", "mild")], asFiled);
    expect(agreeing.map((hour) => hour.strength)).toEqual(stream().map((hour) => hour.strength));
    const stronger = applyAxisReports(stream(), [report("a", "2026-11-03T01:00", "incoming", "strong")], asFiled);
    expect(stronger[1].strength).toBe("strong");
    expect(stronger[2].strength).toBe("strong");
    // Past the turn the report no longer pulls.
    expect(stronger[6].strength).toBe("mild");
  });

  it("reaches medium, never high, when reports on the same run agree with the model", () => {
    const agreeing = [
      report("a", "2026-11-03T00:00", "incoming", "mild"),
      report("b", "2026-11-03T01:00", "incoming", "mild"),
    ];
    const hours = applyAxisReports(stream(), agreeing, asFiled);
    expect(hours[4].confidence).toBe("medium");
    // On the other run the reports are no track record yet.
    expect(hours[9].confidence).toBe("low");
    expect(hours.some((hour) => hour.confidence === "high")).toBe(false);
  });

  it("stays low when the reports on that run disagree with the model, or one within three hours says otherwise", () => {
    const split = [
      report("a", "2026-11-03T00:00", "incoming", "mild"),
      report("b", "2026-11-03T01:00", "outgoing", "mild"),
    ];
    expect(applyAxisReports(stream(), split, asFiled)[5].confidence).toBe("low");
    const late = [
      report("a", "2026-11-03T00:00", "incoming", "mild"),
      report("b", "2026-11-03T01:00", "incoming", "mild"),
      report("c", "2026-11-03T09:00", "incoming", "mild"),
    ];
    // 09:00 saw incoming on the outgoing run: three hours either side of it cannot be sure.
    expect(applyAxisReports(stream(), late, asFiled)[11].confidence).toBe("low");
  });

  it("ignores reports outside the series and reads each along today's axis", () => {
    const old = [report("a", "2026-10-01T02:00", "outgoing", "strong")];
    expect(applyAxisReports(stream(), old, asFiled)).toEqual(stream());
    // A report filed on a flipped heading reads the other way along today's axis.
    const flipped = applyAxisReports(stream(), [report("a", "2026-11-03T02:00", "outgoing", "mild")], () => "incoming");
    expect(flipped[3].direction).toBe("incoming");
  });

  it("needs two directional reports for medium: a slack report does not count toward them", () => {
    const one = [
      report("a", "2026-11-03T00:00", "incoming", "mild"),
      report("b", "2026-11-03T01:00", "incoming", "slack"),
    ];
    expect(applyAxisReports(stream(), one, asFiled)[4].confidence).toBe("low");
  });

  it("lets a slack report pull strength but not direction", () => {
    const slack = applyAxisReports(stream(), [report("a", "2026-11-03T02:00", "outgoing", "slack")], asFiled);
    expect(slack[3].direction).toBe("incoming");
    expect(slack[2].strength).toBe("slack");
  });
});
