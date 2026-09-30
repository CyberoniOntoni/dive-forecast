import { describe, expect, it } from "vitest";
import { atollNamesById, listAtollLabel, repeatedNames, shortAtollName } from "./site-labels";

describe("site labels", () => {
  it("shortens atoll names", () => {
    expect(shortAtollName("North Male Atoll")).toBe("North Male");
    expect(shortAtollName("Gaafaru")).toBe("Gaafaru");
    expect(atollNamesById([{ id: "north-ari", name: "North Ari Atoll" }])).toEqual({ "north-ari": "North Ari" });
  });

  it("shows the atoll only after a name more than one site uses", () => {
    const sites = [
      { name: "Coral Garden", atollId: "north-male" },
      { name: "Coral garden", atollId: "north-ari" },
      { name: "Maaya Thila", atollId: "north-ari" },
    ];
    const repeated = repeatedNames(sites);
    const names = { "north-male": "North Male", "north-ari": "North Ari" };
    expect(listAtollLabel(sites[0], repeated, names)).toBe("North Male");
    expect(listAtollLabel(sites[1], repeated, names)).toBe("North Ari");
    expect(listAtollLabel(sites[2], repeated, names)).toBeNull();
  });
});
