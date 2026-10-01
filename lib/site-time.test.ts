import { describe, expect, it } from "vitest";
import {
  MALDIVES_TIME,
  currentWallHour,
  currentWallTime,
  timeZoneForSite,
  utcOffsetLabel,
  viewerClock,
  zoneLabel,
} from "./site-time";

describe("site time zone", () => {
  it("is the Maldives for every site today", () => {
    expect(timeZoneForSite({ atollId: "north-male" })).toEqual(MALDIVES_TIME);
    expect(zoneLabel(MALDIVES_TIME)).toBe("Maldives time (UTC+5)");
  });

  it("labels offsets", () => {
    expect(utcOffsetLabel(300)).toBe("UTC+5");
    expect(utcOffsetLabel(330)).toBe("UTC+5:30");
    expect(utcOffsetLabel(-180)).toBe("UTC-3");
    expect(utcOffsetLabel(0)).toBe("UTC");
  });

  it("starts the form on the site's current hour, whatever the server's clock", () => {
    // 04:20 UTC is 09:20 in the Maldives.
    const now = Date.UTC(2026, 9, 1, 4, 20);
    expect(currentWallTime(MALDIVES_TIME, now)).toBe("2026-10-01T09:20");
    expect(currentWallHour(MALDIVES_TIME, now)).toBe("2026-10-01T09:00");
  });

  it("tells a diver in Singapore what the site's time is on their clock", () => {
    expect(viewerClock("2026-10-01T09:00", MALDIVES_TIME, 8 * 60)).toEqual({ clock: "12:00", offset: "UTC+8", dayShift: 0 });
    // Late evening in the Maldives is already tomorrow in Singapore.
    expect(viewerClock("2026-10-01T22:00", MALDIVES_TIME, 8 * 60)).toEqual({ clock: "01:00", offset: "UTC+8", dayShift: 1 });
    // And early morning is still yesterday in London (UTC+1 in summer).
    expect(viewerClock("2026-10-01T03:00", MALDIVES_TIME, 60)).toEqual({ clock: "23:00", offset: "UTC+1", dayShift: -1 });
  });

  it("says nothing to a diver already on the site's time, or for an empty time", () => {
    expect(viewerClock("2026-10-01T09:00", MALDIVES_TIME, 5 * 60)).toBeNull();
    expect(viewerClock("", MALDIVES_TIME, 8 * 60)).toBeNull();
  });
});
