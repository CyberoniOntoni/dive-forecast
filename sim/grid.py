"""Build the simulation grid: still-water depth on a regular 200 m grid over the domain.

Three sources, finest first:
  1. Islands: terrarium zoom 12 (SRTM-class land, about 38 m a pixel). A pixel at 1 m or more is land.
  2. Reefs: the Allen Coral Atlas reef zones exported to public/overlays/reef-zones (reef crest, reef
     flats, slopes, plateau, shallow and deep lagoon), each zone given a typical depth (ZONE_DEPTH_M).
  3. Everything else: terrarium zoom 10 sea floor (ETOPO/GEBCO class, about 1-2 km underneath), which knows
     the ocean, the strait and roughly the lagoon floor but smooths the rim to a few metres. So open water
     inside the reef footprint (channels, the lagoon floor) is held at least OPEN_WATER_MIN_M deep.

The grid is built on 50 m subcells and averaged to 200 m cells: a cell is land when most of it is land,
and its depth is the mean depth of its wet subcells. Writes sim/out/grid.npz and a preview PNG.
"""

import glob
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

from domain import DOMAIN, DX_M, LAND_ZOOM, TERRAIN_ZOOM

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT = os.path.join(ROOT, "out")
SUB = 4  # subcells per cell side

# Typical still-water depth (m below mean sea level) of each Allen Coral Atlas zone. The Atlas maps what a
# satellite sees, so its "Deep Lagoon" is still only lagoon floor visible from space, roughly 5-20 m.
ZONE_DEPTH_M = {
    "Reef Crest": 0.4,
    "Outer Reef Flat": 0.6,
    "Inner Reef Flat": 0.8,
    "Reef Slope": 12.0,
    "Sheltered Reef Slope": 10.0,
    "Back Reef Slope": 6.0,
    "Plateau": 10.0,
    "Shallow Lagoon": 3.0,
    "Deep Lagoon": 12.0,
}
# Open water inside the atolls (channel floors, the lagoon basin) is at least this deep; Maldivian channel
# sills run about 20-40 m and lagoon floors 30-60 m.
OPEN_WATER_MIN_M = 25.0
# Outside the atolls: the floor at the reef edge, and how fast it falls (m per m) to the cap. Maldivian outer
# slopes reach a few hundred metres within a kilometre or two; Vaadhoo Kandu is 5 km wide and 400 m deep.
OUTER_SLOPE_TOP_M = 30.0
OUTER_SLOPE = 0.3
# Atoll outlines in the domain (data/rims.json, OSM way ids): North Malé, Gaafaru, South Malé, Vaavu.
RIM_WAYS = ("671807044", "671807125", "671807056", "671807115")
# Cap on depth: the explicit solver's time step scales with 1/sqrt(depth). Tides are forced at the edge and
# the domain is tiny next to a tidal wavelength, so deeper ocean changes nothing the sites feel.
MAX_DEPTH_M = 400.0
LAND_M = 1.0


def projection():
    lat0 = (DOMAIN["south"] + DOMAIN["north"]) / 2
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 110_574.0
    return lat0, kx, ky


def shape():
    _, kx, ky = projection()
    nx = int(round((DOMAIN["east"] - DOMAIN["west"]) * kx / DX_M))
    ny = int(round((DOMAIN["north"] - DOMAIN["south"]) * ky / DX_M))
    return ny, nx


def lonlat_of(i, j):
    """Centre of cell (row i from the south, column j from the west)."""
    _, kx, ky = projection()
    return DOMAIN["west"] + (j + 0.5) * DX_M / kx, DOMAIN["south"] + (i + 0.5) * DX_M / ky


def cell_of(lat, lon):
    """Fractional (row, column) of a point; cell centres are at integers."""
    _, kx, ky = projection()
    return (lat - DOMAIN["south"]) * ky / DX_M - 0.5, (lon - DOMAIN["west"]) * kx / DX_M - 0.5


def mosaic(z):
    files = glob.glob(os.path.join(ROOT, "cache", "terrarium", f"{z}_*.png"))
    if not files:
        raise SystemExit("no terrarium tiles: run python3 sim/fetch_terrain.py first")
    keys = [tuple(int(v) for v in os.path.basename(f)[:-4].split("_")[1:]) for f in files]
    xs = sorted({k[0] for k in keys})
    ys = sorted({k[1] for k in keys})
    m = np.zeros((256 * len(ys), 256 * len(xs)), dtype=np.float32)
    for f, (x, y) in zip(files, keys):
        a = np.asarray(Image.open(f).convert("RGB")).astype(np.float32)
        h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        m[(y - ys[0]) * 256:(y - ys[0] + 1) * 256, (x - xs[0]) * 256:(x - xs[0] + 1) * 256] = h
    return m, xs[0], ys[0], z


def sample(mos, lon, lat):
    """Bilinear sample of a web-mercator mosaic at arrays of lon/lat."""
    m, x0, y0, z = mos
    n = 2**z * 256
    px = (lon + 180) / 360 * n - x0 * 256 - 0.5
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n - y0 * 256 - 0.5
    i0 = np.clip(np.floor(py).astype(int), 0, m.shape[0] - 2)
    j0 = np.clip(np.floor(px).astype(int), 0, m.shape[1] - 2)
    fy = np.clip(py - i0, 0, 1)
    fx = np.clip(px - j0, 0, 1)
    return (m[i0, j0] * (1 - fy) * (1 - fx) + m[i0 + 1, j0] * fy * (1 - fx)
            + m[i0, j0 + 1] * (1 - fy) * fx + m[i0 + 1, j0 + 1] * fy * fx)


def decode_ring(flat):
    x = np.cumsum(np.asarray(flat[0::2], dtype=np.int64)) / 1e5
    y = np.cumsum(np.asarray(flat[1::2], dtype=np.int64)) / 1e5
    return x, y


def zone_raster(fine_shape):
    """Allen Coral Atlas zone index (0-based, -1 none) on the subcell grid, rows from the south."""
    index = json.load(open(os.path.join(REPO, "public", "overlays", "reef-zones", "index.json")))
    classes = index["classes"]
    ny, nx = fine_shape
    _, kx, ky = projection()
    d = DX_M / SUB
    zones = np.full(fine_shape, -1, dtype=np.int8)
    count = 0
    for tile in index["tiles"]:
        if tile["east"] < DOMAIN["west"] or tile["west"] > DOMAIN["east"]:
            continue
        if tile["north"] < DOMAIN["south"] or tile["south"] > DOMAIN["north"]:
            continue
        shapes = json.load(open(os.path.join(REPO, "public", "overlays", "reef-zones", tile["file"])))
        for cls, *rings in shapes:
            pix = []
            for flat in rings:
                lon, lat = decode_ring(flat)
                pix.append(((lon - DOMAIN["west"]) * kx / d, (lat - DOMAIN["south"]) * ky / d))
            c0 = max(int(pix[0][0].min()) - 1, 0)
            c1 = min(int(pix[0][0].max()) + 2, nx)
            r0 = max(int(pix[0][1].min()) - 1, 0)
            r1 = min(int(pix[0][1].max()) + 2, ny)
            if c1 <= c0 or r1 <= r0:
                continue
            img = Image.new("1", (c1 - c0, r1 - r0), 0)
            draw = ImageDraw.Draw(img)
            for k, (px, py) in enumerate(pix):
                if len(px) < 3:
                    continue
                draw.polygon(list(zip(px - c0, py - r0)), fill=0 if k else 1)
            mask = np.asarray(img, dtype=bool)
            zones[r0:r1, c0:c1][mask] = cls
            count += 1
    print(f"rasterised {count} reef-zone shapes")
    return zones, classes


def build():
    ny, nx = shape()
    fy, fx = ny * SUB, nx * SUB
    _, kx, ky = projection()
    d = DX_M / SUB
    lon = DOMAIN["west"] + (np.arange(fx) + 0.5) * d / kx
    lat = DOMAIN["south"] + (np.arange(fy) + 0.5) * d / ky
    LON, LAT = np.meshgrid(lon, lat)

    sea = -sample(mosaic(TERRAIN_ZOOM), LON, LAT)  # positive down
    land = sample(mosaic(LAND_ZOOM), LON, LAT) >= LAND_M
    zones, classes = zone_raster((fy, fx))

    # The coarse sea floor smooths the rims into shallow banks and fills Vaadhoo Kandu (400 m) to 25-100 m.
    # Inside an atoll outline, open water is lagoon basin or channel: at least OPEN_WATER_MIN_M. Outside, the
    # outer slope falls away fast: at least OUTER_SLOPE_TOP_M plus OUTER_SLOPE grade with distance from the
    # nearest reef, land or rim.
    reefy = zones >= 0
    inside = atoll_insides((fy, fx))
    from scipy.ndimage import distance_transform_edt
    dist_m = distance_transform_edt(~(reefy | inside | land)) * d
    ocean_floor = np.minimum(OUTER_SLOPE_TOP_M + OUTER_SLOPE * dist_m, MAX_DEPTH_M)
    depth = np.where(inside, np.maximum(sea, OPEN_WATER_MIN_M), np.maximum(sea, ocean_floor))
    for k, name in enumerate(classes):
        depth = np.where(zones == k, ZONE_DEPTH_M[name], depth)
    depth = np.minimum(depth, MAX_DEPTH_M)

    # Average to cells.
    def coarsen(a):
        return a.reshape(ny, SUB, nx, SUB).mean(axis=(1, 3))

    land_frac = coarsen(land.astype(np.float32))
    wet = ~land
    wet_depth = coarsen(np.where(wet, depth, 0)) / np.maximum(coarsen(wet.astype(np.float32)), 1e-6)
    h = np.where(land_frac > 0.5, -2.0, wet_depth).astype(np.float64)
    # Dominant zone per cell, for friction and the preview.
    zone_cell = np.full((ny, nx), -1, dtype=np.int8)
    best = np.zeros((ny, nx))
    for k in range(len(classes)):
        f = coarsen((zones == k).astype(np.float32))
        zone_cell = np.where(f > best, k, zone_cell)
        best = np.maximum(best, f)
    zone_cell = np.where(best >= 0.25, zone_cell, -1)
    zone_cell = np.where(land_frac > 0.5, -2, zone_cell)

    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(os.path.join(OUT, "grid.npz"), h=h, zone=zone_cell, land_frac=land_frac,
                        classes=np.array(classes), dx=DX_M, domain=np.array([DOMAIN[k] for k in ("south", "north", "west", "east")]))
    print(f"grid {ny} x {nx} at {DX_M:.0f} m: {np.sum(h < 0)} land cells, {np.sum((h >= 0) & (h < 2))} reef-flat cells,"
          f" depth p50 {np.median(h[h > 0]):.0f} m")
    preview(h)


def atoll_insides(fine_shape):
    """True inside any atoll outline in the domain, on the subcell grid."""
    rims = json.load(open(os.path.join(REPO, "data", "rims.json")))["rims"]
    _, kx, ky = projection()
    d = DX_M / SUB
    img = Image.new("1", (fine_shape[1], fine_shape[0]), 0)
    draw = ImageDraw.Draw(img)
    for way in RIM_WAYS:
        ring = np.asarray(rims[way])
        px = (ring[:, 1] - DOMAIN["west"]) * kx / d
        py = (ring[:, 0] - DOMAIN["south"]) * ky / d
        draw.polygon(list(zip(px, py)), fill=1)
    return np.asarray(img, dtype=bool)


def preview(h):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm

    fig, ax = plt.subplots(figsize=(6, 13))
    ax.imshow(np.where(h > 0, h, np.nan), origin="lower", cmap="viridis_r", norm=LogNorm(0.3, 400))
    ax.imshow(np.where(h < 0, 1, np.nan), origin="lower", cmap="Oranges", vmin=0, vmax=1.2)
    ax.set_title("still-water depth (log, m); orange = land")
    fig.savefig(os.path.join(OUT, "grid.png"), dpi=90, bbox_inches="tight")


if __name__ == "__main__":
    build()
