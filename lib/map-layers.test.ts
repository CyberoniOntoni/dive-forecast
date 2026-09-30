import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYER_CHOICE,
  LAYER_STORAGE_KEY,
  formatGridLabel,
  gridStep,
  gridValues,
  parseLayerChoice,
  readLayerChoice,
  readableBase,
  saveLayerChoice,
  type LayerChoice,
} from "./map-layers";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("layer choice", () => {
  it("starts on satellite with seamarks and the coordinate grid on", () => {
    expect(DEFAULT_LAYER_CHOICE.base).toBe("satellite");
    expect(Object.entries(DEFAULT_LAYER_CHOICE.overlays).filter(([, on]) => on)).toEqual([
      ["seamarks", true],
      ["grid", true],
    ]);
  });

  it("moves depth shading and contours off satellite onto the street map", () => {
    const withOverlay = (base: LayerChoice["base"], on: Partial<LayerChoice["overlays"]>): LayerChoice => ({
      base,
      overlays: { ...DEFAULT_LAYER_CHOICE.overlays, ...on },
    });
    expect(readableBase(withOverlay("satellite", {}))).toBe("satellite");
    expect(readableBase(withOverlay("satellite", { sonarDepths: true }))).toBe("satellite");
    expect(readableBase(withOverlay("satellite", { depthShading: true }))).toBe("street");
    expect(readableBase(withOverlay("satellite", { depthContours: true }))).toBe("street");
    // A viewer who picked no base, or the street map already, keeps it.
    expect(readableBase(withOverlay("none", { depthShading: true }))).toBe("none");
    expect(readableBase(withOverlay("street", { depthContours: true }))).toBe("street");
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const choice: LayerChoice = {
      base: "none",
      overlays: { seamarks: false, reefZones: true, depthShading: true, sonarDepths: false, depthContours: true, grid: true },
    };
    saveLayerChoice(choice, storage);
    expect(storage.data.has(LAYER_STORAGE_KEY)).toBe(true);
    expect(readLayerChoice(storage)).toEqual(choice);
  });

  it("falls back to the defaults for missing, broken or unknown values", () => {
    expect(parseLayerChoice(null)).toEqual(DEFAULT_LAYER_CHOICE);
    expect(parseLayerChoice("{not json")).toEqual(DEFAULT_LAYER_CHOICE);
    expect(parseLayerChoice("42")).toEqual(DEFAULT_LAYER_CHOICE);
    // One base only: an unknown or list-valued base keeps the default.
    expect(parseLayerChoice(JSON.stringify({ base: ["satellite", "street"] })).base).toBe("satellite");
    const mixed = parseLayerChoice(JSON.stringify({ base: "moon", overlays: { grid: true, seamarks: "yes", radar: true } }));
    expect(mixed.base).toBe("satellite");
    expect(mixed.overlays).toEqual({ ...DEFAULT_LAYER_CHOICE.overlays, grid: true });
  });

  it("keeps working when storage throws or is missing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLayerChoice(throwing)).toEqual(DEFAULT_LAYER_CHOICE);
    expect(() => saveLayerChoice(DEFAULT_LAYER_CHOICE, throwing)).not.toThrow();
    expect(readLayerChoice(undefined)).toEqual(DEFAULT_LAYER_CHOICE);
  });

  it("does not share the default object with a parsed choice", () => {
    const choice = parseLayerChoice(null);
    choice.overlays.depthShading = true;
    expect(DEFAULT_LAYER_CHOICE.overlays.depthShading).toBe(false);
  });
});

describe("coordinate grid", () => {
  it("picks the finest spacing with at most eight lines across the view", () => {
    expect(gridStep(8)).toBe(1); // the whole archipelago
    expect(gridStep(1.2)).toBeCloseTo(1 / 6); // an atoll: 10′
    expect(gridStep(0.1)).toBeCloseTo(1 / 60); // a pass: 1′
    expect(gridStep(80)).toBe(10);
    expect(gridStep(0)).toBe(10);
  });

  it("lists the multiples inside the view without float drift", () => {
    expect(gridValues(4.05, 4.4, 1 / 6)).toEqual([4 + 1 / 6, 4 + 2 / 6].map((value) => Math.round(value * 3600) / 3600));
    expect(gridValues(-0.7, 0.2, 0.5)).toEqual([-0.5, 0]);
  });

  it("labels in degrees and minutes with the hemisphere", () => {
    expect(formatGridLabel(4 + 10 / 60, "lat")).toBe("4°10′N");
    expect(formatGridLabel(-0.6, "lat")).toBe("0°36′S");
    expect(formatGridLabel(73.5, "lon")).toBe("73°30′E");
    expect(formatGridLabel(0, "lat")).toBe("0°00′");
  });
});
