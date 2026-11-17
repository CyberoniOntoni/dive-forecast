"""
Satellite tiles the app may save for offline use, made from Copernicus Sentinel-2 (free for any use, with credit).

The map's live satellite layer (Esri World Imagery) may not be downloaded ahead of time, so saved atolls draw these
instead. Two steps, each safe to run again (finished parts are skipped):

  composite   For each atoll outline in data/rims.json, the cloud-masked per-pixel median of the clearest L2A scenes
              (true-colour "visual" band, cloud mask from the scene classification), one GeoTIFF per MGRS tile.
              Reads the Sentinel-2 COGs on AWS (earth-search STAC). Takes about an hour for all atolls.
  tiles       Web Mercator tiles, zoom 8-14 (z14 is about 9.5 m a pixel, the imagery's own 10 m), as WebP, under
              <out>/{z}/{x}/{y}.webp, transparent where no scene reached. Only tiles over an atoll's box are made, and
              of those not one under 1% covered (a sliver of an atoll's edge; the server answers 204 there).

  pip install rasterio pillow numpy
  python3 scripts/imagery/sentinel2.py composite <work dir>
  python3 scripts/imagery/sentinel2.py tiles <work dir> <out dir>
  npm run imagery:upload -- <out dir>        # to R2 (scripts/imagery-upload.ts)

Credit: "Contains modified Copernicus Sentinel data 2023–2026" (IMAGERY_ATTRIBUTION in lib/imagery.ts); a rebuild
uses the years the composite step prints.
"""
import glob, json, math, os, sys, urllib.request

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STAC = "https://earth-search.aws.element84.com/v1/search"
SCENES_PER_TILE = 8
# Rows of a composite worked on at once: 8 scenes x 1024 rows x a full 10,980-pixel tile is about 1 GB.
STRIP_ROWS = 1024
# Scene classification values left out of the median: no data, saturated, cloud shadow, cloud, cirrus.
MASKED = [0, 1, 3, 8, 9, 10]
PAD_DEG = 0.03
MIN_ZOOM, MAX_ZOOM = 8, 14
TILE = 256
WEBP_QUALITY = 78


def atoll_boxes():
    rims = json.load(open(os.path.join(ROOT, "data", "rims.json")))["rims"]
    for way, ring in sorted(rims.items()):
        lats = [p[0] for p in ring]
        lons = [p[1] for p in ring]
        yield way, (min(lats) - PAD_DEG, min(lons) - PAD_DEG, max(lats) + PAD_DEG, max(lons) + PAD_DEG)


def scenes(box):
    south, west, north, east = box
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": [west, south, east, north],
        "limit": 200,
        "query": {"eo:cloud_cover": {"lt": 20}},
        "datetime": "2023-01-01T00:00:00Z/..",
        "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
    }
    by_tile = {}
    # Every page, not just the first: the clearest scenes over a big atoll can all fall on one or two of its MGRS tiles.
    url, method = STAC, "POST"
    while url:
        request = urllib.request.Request(url, data=json.dumps(body).encode() if method == "POST" else None,
                                         headers={"Content-Type": "application/json"}, method=method)
        page = json.load(urllib.request.urlopen(request))
        for feature in page["features"]:
            if feature["properties"].get("s2:nodata_pixel_percentage", 0) > 60:
                continue
            by_tile.setdefault(feature["properties"]["grid:code"], []).append(feature)
        following = next((link for link in page.get("links", []) if link.get("rel") == "next"), None)
        url, method = (following["href"], following.get("method", "GET")) if following else (None, None)
        if following and following.get("body"):
            body = following["body"] if not following.get("merge") else {**body, **following["body"]}
    # Each tile's clearest first (pages arrive in cloud order, but a stable sort costs nothing).
    return {tile: sorted(features, key=lambda f: f["properties"]["eo:cloud_cover"])[:SCENES_PER_TILE]
            for tile, features in by_tile.items()}


def composite(work):
    os.makedirs(work, exist_ok=True)
    years = set()
    for way, box in atoll_boxes():
        done = os.path.join(work, f"{way}.done")
        if os.path.exists(done):
            continue
        south, west, north, east = box
        for tile, features in sorted(scenes(box).items()):
            # Scenes of one MGRS tile share its grid, so the first one sets the window.
            with rasterio.open(features[0]["assets"]["visual"]["href"]) as src:
                bounds = transform_bounds("EPSG:4326", src.crs, west, south, east, north)
                win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
                win = win.intersection(Window(0, 0, src.width, src.height))
                profile = src.profile.copy()
                profile.update(width=win.width, height=win.height, transform=src.window_transform(win), driver="GTiff",
                               compress="deflate", tiled=True, count=3, nodata=0)
            path = os.path.join(work, f"{way}-{tile}.tif")
            # In strips of rows: a big atoll's eight full scenes would not fit in memory at once.
            with rasterio.open(path + ".part", "w", **profile) as dst:
                for row in range(0, win.height, STRIP_ROWS):
                    strip = Window(win.col_off, win.row_off + row, win.width, min(STRIP_ROWS, win.height - row))
                    stack = []
                    for feature in features:
                        with rasterio.open(feature["assets"]["visual"]["href"]) as src:
                            rgb = src.read(window=strip, boundless=True, fill_value=0).astype(np.float32)
                            strip_bounds = src.window_bounds(strip)
                        with rasterio.open(feature["assets"]["scl"]["href"]) as scl_src:
                            scl = scl_src.read(1, window=from_bounds(*strip_bounds, transform=scl_src.transform),
                                               out_shape=rgb.shape[1:], resampling=Resampling.nearest, boundless=True,
                                               fill_value=0)
                        rgb[:, np.isin(scl, MASKED) | (rgb.sum(0) == 0)] = np.nan
                        stack.append(rgb)
                    with np.errstate(all="ignore"):
                        median = np.nanmedian(np.stack(stack), axis=0)
                    out = np.nan_to_num(median, nan=0).clip(0, 255).astype(np.uint8)
                    dst.write(out, window=Window(0, row, win.width, strip.height))
            os.replace(path + ".part", path)
            years.update(feature["properties"]["datetime"][:4] for feature in features)
            print(way, tile, len(features), "scenes", flush=True)
        open(done, "w").close()
    print("years", sorted(years))


def tile_bounds_3857(z, x, y):
    size = 2 * math.pi * 6378137 / 2**z
    west = -math.pi * 6378137 + x * size
    north = math.pi * 6378137 - y * size
    return west, north - size, west + size, north


def tile_xy(lat, lon, z):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tiles(work, out):
    sources = [rasterio.open(path) for path in sorted(glob.glob(os.path.join(work, "*.tif")))]
    # Each composite's box in Web Mercator, so a tile only reads the few that reach it.
    reach = [transform_bounds(src.crs, "EPSG:3857", *src.bounds) for src in sources]
    boxes = [box for _, box in atoll_boxes()]
    wanted = set()
    for south, west, north, east in boxes:
        x0, y0 = tile_xy(north, west, MAX_ZOOM)
        x1, y1 = tile_xy(south, east, MAX_ZOOM)
        wanted.update((x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))
    made = {}
    for x, y in sorted(wanted):
        path = os.path.join(out, str(MAX_ZOOM), str(x), f"{y}.webp")
        if os.path.exists(path):
            made[(x, y)] = Image.open(path).convert("RGBA")
            continue
        transform = transform_from_bounds(*tile_bounds_3857(MAX_ZOOM, x, y), TILE, TILE)
        pixels = np.zeros((3, TILE, TILE), np.uint8)
        west, south, east, north = tile_bounds_3857(MAX_ZOOM, x, y)
        for src, (w, s_, e, n) in zip(sources, reach):
            if w > east or e < west or s_ > north or n < south:
                continue
            part = np.zeros((3, TILE, TILE), np.uint8)
            reproject(rasterio.band(src, [1, 2, 3]), part, src_transform=src.transform, src_crs=src.crs, dst_transform=transform,
                      dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
            empty = pixels.sum(0) == 0
            pixels[:, empty] = part[:, empty]
        if (pixels.sum(0) > 0).mean() < 0.01:
            continue
        # Transparent where no scene reached: the map shows its own background there, not black squares.
        alpha = np.where(pixels.sum(0) > 0, 255, 0).astype(np.uint8)
        image = Image.fromarray(np.moveaxis(np.concatenate([pixels, alpha[None]]), 0, -1), "RGBA")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        image.save(path, "WEBP", quality=WEBP_QUALITY)
        made[(x, y)] = image
    print("z", MAX_ZOOM, len(made), flush=True)
    # Each lower zoom from the four tiles under it.
    for z in range(MAX_ZOOM - 1, MIN_ZOOM - 1, -1):
        parents = {}
        for (x, y), image in made.items():
            parents.setdefault((x // 2, y // 2), []).append(((x % 2, y % 2), image))
        made = {}
        for (px, py), children in parents.items():
            canvas = Image.new("RGBA", (TILE * 2, TILE * 2), (0, 0, 0, 0))
            for (dx, dy), image in children:
                canvas.paste(image, (dx * TILE, dy * TILE))
            image = canvas.resize((TILE, TILE), Image.LANCZOS)
            path = os.path.join(out, str(z), str(px), f"{py}.webp")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            image.save(path, "WEBP", quality=WEBP_QUALITY)
            made[(px, py)] = image
        print("z", z, len(made), flush=True)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "composite":
        composite(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "tiles":
        tiles(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(1)
