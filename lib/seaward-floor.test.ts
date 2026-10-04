import { describe, expect, it } from "vitest";
import { pickSeawardKm } from "./floor-sample";
import { readSeawardFloor, seawardKmFor } from "./seaward-floor";

describe("seaward floor table", () => {
  it("keeps each catalog site on the step the open-ocean rule picks", () => {
    const floor = readSeawardFloor();
    if (!floor) return;
    expect(floor.grid).toBe("GEBCO_2026");
    expect(floor.openOceanM).toBe(-50);
    for (const [id, site] of Object.entries(floor.sites)) {
      const picked = pickSeawardKm(site.steps);
      expect(site.km, id).toBe(picked.km);
      expect(site.open, id).toBe(picked.open);
      expect(seawardKmFor(id), id).toBe(site.open ? site.km : 3);
    }
    expect(seawardKmFor("__missing__")).toBe(3);
  });
});
