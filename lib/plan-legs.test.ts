import { describe, expect, it } from "vitest";
import { durationText, legDeparture, legMinutes, moveStopKeepingTimes } from "./plan-legs";

describe("leg times", () => {
  it("times a boat leg at the plan's speed and shows it rounded up to 5 minutes", () => {
    expect(legMinutes(18.52, 10)).toBeCloseTo(60);
    expect(durationText(42)).toBe("45 min");
    expect(durationText(45)).toBe("45 min");
    expect(durationText(82)).toBe("1 h 25 min");
    expect(durationText(120)).toBe("2 h");
    expect(durationText(0.4)).toBe("5 min");
  });
});

describe("moveStopKeepingTimes", () => {
  const stops = [
    { siteId: "a", time: "07:00", note: "first" },
    { siteId: "b", time: "10:30" },
    { siteId: "c", time: "14:00" },
  ];

  it("swaps the sites and keeps each row's time", () => {
    expect(moveStopKeepingTimes(stops, 1, 1)).toEqual([
      { siteId: "a", time: "07:00", note: "first" },
      { siteId: "c", time: "10:30" },
      { siteId: "b", time: "14:00" },
    ]);
    expect(moveStopKeepingTimes(stops, 0, 1)[1]).toEqual({ siteId: "a", time: "10:30", note: "first" });
  });

  it("changes nothing past either end", () => {
    expect(moveStopKeepingTimes(stops, 0, -1)).toEqual(stops);
    expect(moveStopKeepingTimes(stops, 2, 1)).toEqual(stops);
  });
});

describe("legDeparture", () => {
  it("is the next entry less the boat time, rounded down to 5 minutes", () => {
    expect(legDeparture("07:00", "10:30", 40)).toEqual({ leaveBy: "09:50", tight: false });
    // 42 minutes is shown as "45 min", so it leaves 45 minutes before: the two lines on a leg agree.
    expect(durationText(42)).toBe("45 min");
    expect(legDeparture("07:00", "10:30", 42)).toEqual({ leaveBy: "09:45", tight: false });
    // An entry off the 5-minute marks leaves on the mark before.
    expect(legDeparture("07:00", "10:32", 40)).toEqual({ leaveBy: "09:50", tight: false });
  });

  it("is tight when it leaves under an hour after the dive before went in", () => {
    expect(legDeparture("09:00", "10:30", 40)).toEqual({ leaveBy: "09:50", tight: true });
    expect(legDeparture("09:00", "09:30", 40)).toEqual({ leaveBy: "08:50", tight: true });
  });

  it("is null for a leg with no time or one that would leave before midnight", () => {
    expect(legDeparture("07:00", "10:30", Infinity)).toBeNull();
    expect(legDeparture("00:00", "00:20", 40)).toBeNull();
  });
});
