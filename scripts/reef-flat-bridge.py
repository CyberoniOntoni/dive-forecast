"""Mark a crest-to-crest mouth as bridged when reef flat still crosses it.

ATLAS_TILE_POLYGONS (a JSON file with a "flat" list of [lon, lat] rings) replaces the GeoPackage with the map's
reef-zone tiles; see scripts/atoll-openings.py.
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import geopackage_wkb

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data" / "sources" / "aca" / "Geomorphic-Map" / "geomorphic.gpkg"
FLAT = ("Outer Reef Flat", "Inner Reef Flat")


def main() -> None:
    mouths = json.load(sys.stdin)
    flats = load_flat()
    tree = STRtree(flats)
    json.dump([bridged(mouth, flats, tree) for mouth in mouths], sys.stdout)


def load_flat() -> list[Polygon]:
    tiles = os.environ.get("ATLAS_TILE_POLYGONS")
    if tiles:
        rings = json.loads(Path(tiles).read_text(encoding="utf-8"))["flat"]
        polygons = [Polygon(ring) for ring in rings if len(ring) >= 4]
        polygons = [polygon if polygon.is_valid else polygon.buffer(0) for polygon in polygons]
        polygons = [polygon for polygon in polygons if not polygon.is_empty]
        if not polygons:
            raise SystemExit("no reef-flat polygons")
        return polygons
    conn = sqlite3.connect(GPKG)
    placeholders = ",".join("?" for _ in FLAT)
    query = f'SELECT geom FROM "Central Indian Ocean" WHERE class IN ({placeholders})'
    polygons = []
    for (blob,) in conn.execute(query, FLAT):
        for outer, holes, _bbox in geopackage_wkb.parse_polygons(blob):
            if len(outer) < 4:
                continue
            try:
                polygon = Polygon(outer, holes)
            except Exception:
                continue
            if polygon.is_empty:
                continue
            polygons.append(polygon if polygon.is_valid else polygon.buffer(0))
    if not polygons:
        raise SystemExit("no reef-flat polygons")
    return polygons


def bridged(mouth: dict, flats: list[Polygon], tree: STRtree) -> bool:
    lon1, lat1 = mouth["a"]
    lon2, lat2 = mouth["b"]
    inside = 0
    checked = 0
    for fraction in (0.25, 0.5, 0.75):
        checked += 1
        lon = lon1 + fraction * (lon2 - lon1)
        lat = lat1 + fraction * (lat2 - lat1)
        if on_flat(lon, lat, flats, tree):
            inside += 1
    return inside >= 2 or (checked > 0 and on_flat((lon1 + lon2) / 2, (lat1 + lat2) / 2, flats, tree))


def on_flat(lon: float, lat: float, flats: list[Polygon], tree: STRtree) -> bool:
    point = Point(lon, lat)
    for index in tree.query(point):
        if flats[int(index)].covers(point):
            return True
    return False


if __name__ == "__main__":
    main()
