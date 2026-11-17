import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IMAGERY_VERSION, imageryStyle, imageryTile, readImageryTile } from "./imagery";

describe("imagery tiles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imagery-"));
  afterEach(() => {
    delete process.env.IMAGERY_DIR;
  });

  it("takes only tiles that could have been made", () => {
    expect(imageryTile(IMAGERY_VERSION, "14", "11534", "7960.webp")).toEqual({ z: 14, x: 11534, y: 7960 });
    expect(imageryTile("s2-v0", "14", "11534", "7960.webp")).toBeNull();
    expect(imageryTile(IMAGERY_VERSION, "15", "11534", "7960.webp")).toBeNull();
    expect(imageryTile(IMAGERY_VERSION, "7", "90", "62.webp")).toBeNull();
    expect(imageryTile(IMAGERY_VERSION, "8", "256", "1.webp")).toBeNull();
    expect(imageryTile(IMAGERY_VERSION, "14", "11534", "7960.png")).toBeNull();
    expect(imageryTile(IMAGERY_VERSION, "14", "..", "7960.webp")).toBeNull();
  });

  it("reads a tile from data/imagery on Node, and none where none was made", async () => {
    process.env.IMAGERY_DIR = dir;
    const file = path.join(dir, IMAGERY_VERSION, "14", "11534", "7960.webp");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));
    expect(Array.from((await readImageryTile({ z: 14, x: 11534, y: 7960 }))!)).toEqual([1, 2, 3]);
    expect(await readImageryTile({ z: 14, x: 11534, y: 7961 })).toBeNull();
  });

  it("gives the app a style whose tile URL is the one its map uses", () => {
    const style = imageryStyle("https://50bar.app");
    // android/…/ui/map/SiteMapView.kt SENTINEL2_TILES builds the same URL from the app's server.
    expect(style.sources.sentinel2.tiles).toEqual([`https://50bar.app/imagery/${IMAGERY_VERSION}/{z}/{x}/{y}.webp`]);
    expect(style.sources.sentinel2.maxzoom).toBe(14);
  });
});
