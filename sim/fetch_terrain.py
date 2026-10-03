"""Download the elevation tiles that cover the simulation domain into sim/cache/terrarium/.

The tiles are the open "terrarium" elevation set on AWS (s3://elevation-tiles-prod, Mapzen/Tilezen).
Each PNG pixel encodes height = (R * 256 + G + B / 256) - 32768 metres. Over the sea it carries the
global bathymetry the set was built from (ETOPO1 / GEBCO class, about 1-2 km), over land SRTM-class
terrain. Zoom 10 carries the sea floor; from zoom 11 the sea reads 0 m and only land has height, which is
what grid.py uses zoom 12 for: islands. The sea floor is coarse: it resolves the deep ocean, the strait
and the lagoon floor, not the reefs.
Reefs and islands come from the Allen Coral Atlas tiles in public/overlays (see grid.py).
"""

import math
import os
import sys
import time
import urllib.request

from domain import DOMAIN, LAND_ZOOM, TERRAIN_ZOOM

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = os.path.join(os.path.dirname(__file__), "cache", "terrarium")


def tile_xy(lat, lon, z):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tiles(z):
    x0, y0 = tile_xy(DOMAIN["north"], DOMAIN["west"], z)
    x1, y1 = tile_xy(DOMAIN["south"], DOMAIN["east"], z)
    return [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def download(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2**attempt)


def main():
    os.makedirs(CACHE, exist_ok=True)
    todo = tiles(TERRAIN_ZOOM) + tiles(LAND_ZOOM)
    for i, (z, x, y) in enumerate(todo):
        path = os.path.join(CACHE, f"{z}_{x}_{y}.png")
        if os.path.exists(path):
            continue
        data = download(URL.format(z=z, x=x, y=y))
        with open(path, "wb") as f:
            f.write(data)
        print(f"{i + 1}/{len(todo)} {z}/{x}/{y}", file=sys.stderr)
    print(f"{len(todo)} tiles in {CACHE}")


if __name__ == "__main__":
    main()
