import { describe, expect, it } from "vitest";
import { pointDestinationId, pointDestinationName, readPointDestination } from "./point-destination";

describe("point destinations", () => {
  it("round-trips a picked point through its id", () => {
    const id = pointDestinationId({ lat: 3.912345678, lon: 73.4987654 });
    expect(id).toBe("3.91235,73.49877");
    expect(readPointDestination(id)).toEqual({ lat: 3.91235, lon: 73.49877 });
    expect(readPointDestination(pointDestinationId({ lat: -4.5, lon: -73.25 }))).toEqual({ lat: -4.5, lon: -73.25 });
  });

  it("reads a site id or a point off the globe as no point", () => {
    expect(readPointDestination("kandooma-thila")).toBeNull();
    expect(readPointDestination("4.1,")).toBeNull();
    expect(readPointDestination("95.0,73.5")).toBeNull();
    expect(readPointDestination("4.0,190.0")).toBeNull();
  });

  it("names a point by its position", () => {
    expect(pointDestinationName({ lat: 3.91241, lon: 73.49877 })).toBe("Point 3.9124° N, 73.4988° E");
  });
});
