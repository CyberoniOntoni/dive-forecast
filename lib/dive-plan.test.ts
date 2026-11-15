import { describe, expect, it } from "vitest";
import {
  beyondOpensOn,
  bestWindow,
  canReportDive,
  dayLabel,
  diveHour,
  durationText,
  isPlanId,
  legMinutes,
  newPlanId,
  planDateSpan,
  requirePlanInput,
  stopOutlook,
  type SiteHours,
} from "./dive-plan";
import type { HourForecast, SeaStateHour, Strength } from "./types";

const known = (id: string) => ["kandooma-thila", "cocoa-corner", "banana-reef"].includes(id);

function day(date: string, pattern: (h: number) => [HourForecast["direction"], Strength]): HourForecast[] {
  return Array.from({ length: 24 }, (_, h) => {
    const [direction, strength] = pattern(h);
    return { time: `${date}T${String(h).padStart(2, "0")}:00`, direction, strength, confidence: "medium", levelM: 0 };
  });
}

function channel(hours: HourForecast[], sea: SeaStateHour[] | null = null): SiteHours {
  return { route: "channel", hours, sea, unavailable: false };
}

describe("plan ids", () => {
  it("are 16 unguessable letters and digits, and only those pass", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPlanId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(isPlanId(id)).toBe(true);
    }
    expect(isPlanId("../etc")).toBe(false);
    expect(isPlanId("short")).toBe(false);
    // Only what newPlanId makes: 16 of its letters, so no caller-picked id passes.
    expect(isPlanId("AbCdEfGhJkLmNpQrStUv")).toBe(false);
    expect(isPlanId("IlO0IlO0IlO0IlO0")).toBe(false);
    expect(isPlanId(42)).toBe(false);
  });
});

describe("requirePlanInput", () => {
  const base = {
    title: "  North Male   week ",
    notes: "Meet at 06:30\n\n\n\nBring a torch",
    boatSpeedKn: 8.25,
    days: [
      { date: "2026-11-21", stops: [{ siteId: "cocoa-corner", time: "14:30", want: "outgoing" }] },
      {
        date: "2026-11-20",
        stops: [
          { siteId: "banana-reef", time: "10:30", note: "Shallow end first" },
          { siteId: "kandooma-thila", time: "07:00", want: "sideways" },
        ],
      },
    ],
  };

  it("cleans text and puts days and dives in order", () => {
    const plan = requirePlanInput(base, known);
    expect(plan.title).toBe("North Male week");
    expect(plan.notes).toBe("Meet at 06:30\n\nBring a torch");
    expect(plan.boatSpeedKn).toBe(8.3);
    expect(plan.days.map((item) => item.date)).toEqual(["2026-11-20", "2026-11-21"]);
    expect(plan.days[0].stops.map((stop) => stop.time)).toEqual(["07:00", "10:30"]);
    // A want that is not a direction is dropped; a real one is kept.
    expect(plan.days[0].stops[0]).toEqual({ siteId: "kandooma-thila", time: "07:00" });
    expect(plan.days[1].stops[0].want).toBe("outgoing");
  });

  it("refuses what cannot be shown", () => {
    expect(() => requirePlanInput({ ...base, title: "  " }, known)).toThrow(/title/);
    expect(() => requirePlanInput({ ...base, boatSpeedKn: 90 }, known)).toThrow(/Boat speed/);
    expect(() => requirePlanInput({ ...base, days: [] }, known)).toThrow(/at least one day/);
    expect(() => requirePlanInput({ ...base, days: [{ date: "2026-02-30", stops: [] }] }, known)).toThrow(/date/);
    expect(() =>
      requirePlanInput({ ...base, days: [{ date: "2026-11-20", stops: [{ siteId: "nowhere", time: "09:00" }] }] }, known),
    ).toThrow(/Pick a dive site/);
    expect(() =>
      requirePlanInput({ ...base, days: [{ date: "2026-11-20", stops: [{ siteId: "banana-reef", time: "25:00" }] }] }, known),
    ).toThrow(/time/);
    expect(() =>
      requirePlanInput({ ...base, days: [{ date: "2026-11-20", stops: [] }, { date: "2026-11-20", stops: [] }] }, known),
    ).toThrow(/twice/);
    const many = Array.from({ length: 7 }, () => ({ siteId: "banana-reef", time: "09:00" }));
    expect(() => requirePlanInput({ ...base, days: [{ date: "2026-11-20", stops: many }] }, known)).toThrow(/more than 6/);
  });
});

describe("dates and times", () => {
  it("labels days and spans", () => {
    expect(dayLabel("2026-11-17")).toBe("Tue 17 Nov");
    expect(planDateSpan([{ date: "2026-11-17" }])).toBe("17 Nov 2026");
    expect(planDateSpan([{ date: "2026-11-17" }, { date: "2026-11-23" }])).toBe("17–23 Nov 2026");
    expect(planDateSpan([{ date: "2026-11-30" }, { date: "2026-12-02" }])).toBe("30 Nov – 2 Dec 2026");
    expect(planDateSpan([{ date: "2026-12-30" }, { date: "2027-01-02" }])).toBe("30 Dec 2026 – 2 Jan 2027");
  });

  it("rounds a dive to its nearest forecast hour, across midnight too", () => {
    expect(diveHour("2026-11-20", "10:29")).toBe("2026-11-20T10:00");
    expect(diveHour("2026-11-20", "10:30")).toBe("2026-11-20T11:00");
    expect(diveHour("2026-11-20", "23:45")).toBe("2026-11-21T00:00");
  });

  it("asks for a report an hour after the dive, for 14 days", () => {
    expect(canReportDive("2026-11-20", "09:00", "2026-11-20T09:30")).toBe(false);
    expect(canReportDive("2026-11-20", "09:00", "2026-11-20T10:00")).toBe(true);
    expect(canReportDive("2026-11-20", "09:00", "2026-12-04T09:00")).toBe(true);
    expect(canReportDive("2026-11-20", "09:00", "2026-12-04T09:01")).toBe(false);
  });

  it("times a boat leg at the plan's speed", () => {
    expect(legMinutes(18.52, 10)).toBeCloseTo(60);
    expect(durationText(47)).toBe("45 min");
    expect(durationText(82)).toBe("1 h 20 min");
    expect(durationText(120)).toBe("2 h");
    expect(durationText(0.4)).toBe("5 min");
  });
});

describe("stopOutlook", () => {
  // Incoming mild in the morning, very strong around midday, outgoing mild from 14:00.
  const hours = [
    ...day("2026-11-20", (h) => (h < 11 ? ["incoming", "mild"] : h < 14 ? ["incoming", "too_strong"] : ["outgoing", "mild"])),
    ...day("2026-11-21", () => ["incoming", "strong"]),
  ];

  it("reads the dive hour with no warning on a good slot", () => {
    const outlook = stopOutlook(channel(hours), "2026-11-20", { time: "08:00" }, "2026-11-20");
    expect(outlook.status).toBe("forecast");
    if (outlook.status !== "forecast") return;
    expect(outlook.hour.time).toBe("2026-11-20T08:00");
    expect(outlook.warnings).toEqual([]);
    expect(outlook.better).toBeNull();
  });

  it("warns when the hour after the dive turns very strong, and offers the earlier window", () => {
    const outlook = stopOutlook(channel(hours), "2026-11-20", { time: "10:00" }, "2026-11-20");
    if (outlook.status !== "forecast") throw new Error(outlook.status);
    expect(outlook.warnings).toEqual([{ kind: "very-strong", time: "2026-11-20T11:00" }]);
    // 10:00 itself is out (11:00 is very strong); 14:00–17:00 outgoing mild is later; the morning run scores the same
    // and comes first.
    expect(outlook.better).toMatchObject({ from: "2026-11-20T06:00", to: "2026-11-20T09:00" });
  });

  it("warns on the wrong way at a channel, and finds the window running the wanted way", () => {
    const outlook = stopOutlook(channel(hours), "2026-11-20", { time: "15:00", want: "incoming" }, "2026-11-20");
    if (outlook.status !== "forecast") throw new Error(outlook.status);
    expect(outlook.warnings).toEqual([{ kind: "wrong-way", want: "incoming", direction: "outgoing" }]);
    expect(outlook.better).toMatchObject({ from: "2026-11-20T06:00", to: "2026-11-20T09:00" });
  });

  it("ignores the wanted way away from a channel", () => {
    const wall: SiteHours = { route: "along-reef", hours, sea: null, unavailable: false };
    const outlook = stopOutlook(wall, "2026-11-20", { time: "15:00", want: "incoming" }, "2026-11-20");
    if (outlook.status !== "forecast") throw new Error(outlook.status);
    expect(outlook.warnings).toEqual([]);
  });

  it("warns on a rough sea", () => {
    const sea: SeaStateHour[] = [
      {
        time: "2026-11-21T09:00",
        band: "rough",
        feltM: 1.8,
        swell: null,
        windWaveM: 0.5,
        wind: null,
        againstCurrent: false,
      },
    ];
    const outlook = stopOutlook(channel(hours, sea), "2026-11-21", { time: "09:00" }, "2026-11-20");
    if (outlook.status !== "forecast") throw new Error(outlook.status);
    expect(outlook.warnings).toEqual([{ kind: "rough", band: "rough" }]);
  });

  it("says when the dive is past or beyond the forecast, or the site has none", () => {
    expect(stopOutlook(channel(hours), "2026-11-19", { time: "09:00" }, "2026-11-20").status).toBe("past");
    expect(stopOutlook(channel(hours), "2026-11-25", { time: "09:00" }, "2026-11-20")).toEqual({
      status: "beyond",
      opensOn: "2026-11-24",
    });
    expect(stopOutlook({ ...channel(hours), unavailable: true }, "2026-11-20", { time: "09:00" }, "2026-11-20").status).toBe("unavailable");
  });
});

describe("beyondOpensOn", () => {
  it("opens six days ahead for a dive by 11:00, five for a later one, as the series ends at 11:00", () => {
    expect(beyondOpensOn("2026-11-30", "07:00")).toBe("2026-11-24");
    expect(beyondOpensOn("2026-11-30", "11:20")).toBe("2026-11-24");
    expect(beyondOpensOn("2026-11-30", "11:40")).toBe("2026-11-25");
    expect(beyondOpensOn("2026-11-30", "15:00")).toBe("2026-11-25");
    // 23:40 is read at 00:00 the next day.
    expect(beyondOpensOn("2026-11-30", "23:40")).toBe("2026-11-25");
  });
});

describe("bestWindow", () => {
  it("is null when every daylight hour has a warning", () => {
    const hours = day("2026-11-20", () => ["incoming", "too_strong"]);
    expect(bestWindow(channel(hours), "2026-11-20", undefined)).toBeNull();
  });

  it("prefers a mild hour over a strong or slack one", () => {
    const hours = day("2026-11-20", (h) => (h === 12 ? ["incoming", "mild"] : h < 12 ? ["incoming", "slack"] : ["outgoing", "strong"]));
    const window = bestWindow(channel(hours), "2026-11-20", undefined);
    expect(window?.best.time).toBe("2026-11-20T12:00");
    expect(window).toMatchObject({ from: "2026-11-20T06:00", to: "2026-11-20T17:00" });
  });
});
