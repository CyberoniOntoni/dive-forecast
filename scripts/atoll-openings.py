"""Project Atlas reef-crest polygons onto each atoll rim. Prints crest arcs. Writes no catalog."""

import json
import math
import sqlite3
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GPKG = ROOT / "data" / "sources" / "aca" / "Geomorphic-Map" / "geomorphic.gpkg"
RIMS = ROOT / "data" / "rims.json"
SITES = ROOT / "data" / "sites.json"
RIM_STEP_M = 80
CREST_REACH_M = 4000
OUTER_BAND_M = 400
REEF_TOP = ("Reef Crest",)
KM_LAT = 110.57
KM_LON = 111.32


def main() -> None:
    if not GPKG.exists():
        raise SystemExit(f"No geomorphic map at {GPKG}")
    catalog = json.loads(SITES.read_text(encoding="utf-8"))
    rims = json.loads(RIMS.read_text(encoding="utf-8"))["rims"]
    ways: dict[str, list[str]] = {}
    for atoll in catalog["atolls"]:
        way_id = atoll["rimSourceUrl"].rstrip("/").split("/")[-1]
        ways.setdefault(way_id, []).append(atoll["id"])
    polygons = load_reef(GPKG)
    rim_points = []
    rim_index: dict[tuple[int, int], list[int]] = {}
    for way_id, atoll_ids in ways.items():
        ring = rims.get(way_id)
        if not ring:
            continue
        points, perimeter = densify(ring, RIM_STEP_M)
        base = len(rim_points)
        for point in points:
            rim_points.append({"wayId": way_id, "atollIds": atoll_ids, "perimeterM": perimeter, **point})
        for offset, point in enumerate(points):
            key = (int(point["lon"] / 0.05), int(point["lat"] / 0.05))
            rim_index.setdefault(key, []).append(base + offset)
    grouped: dict[str, list] = {}
    for polygon in polygons:
        lon, lat = centroid(polygon["outer"])
        hit = nearest_rim(lon, lat, rim_points, rim_index)
        inside = containing_way(lon, lat, ways, rims)
        way_id = None
        if hit is not None:
            way_id = hit["wayId"]
        elif inside is not None:
            way_id = inside
        if way_id is None:
            continue
        grouped.setdefault(way_id, []).append(polygon)
    ways_out = []
    for way_id, crests in grouped.items():
        sample = next(point for point in rim_points if point["wayId"] == way_id)
        ring = rims[way_id]
        clon = sum(lon for _lat, lon in ring) / len(ring)
        clat = sum(lat for lat, _lon in ring) / len(ring)
        perimeter, arcs = circuit(crests, clon, clat)
        if not arcs:
            continue
        ways_out.append(
            {"wayId": way_id, "atollIds": sample["atollIds"], "perimeterM": perimeter, "crests": arcs}
        )
    json.dump({"ways": ways_out}, sys.stdout)


def load_reef(path: Path) -> list[dict]:
    conn = sqlite3.connect(path)
    placeholders = ",".join("?" for _ in REEF_TOP)
    query = f'SELECT geom FROM "Central Indian Ocean" WHERE class IN ({placeholders})'
    polygons = []
    checked = False
    for (blob,) in conn.execute(query, REEF_TOP):
        for outer, holes, bbox in parse_polygons(blob):
            polygons.append({"outer": outer, "holes": holes, "bbox": bbox})
            if not checked:
                if len(outer) < 4 or not all(math.isfinite(value) for point in outer for value in point):
                    raise SystemExit("reef ring is not a closed finite outline")
                checked = True
    if not polygons:
        raise SystemExit("no reef-top polygons")
    return polygons


def grid_index(polygons: list[dict]) -> dict[tuple[int, int], list[int]]:
    index: dict[tuple[int, int], list[int]] = {}
    for number, polygon in enumerate(polygons):
        min_lon, min_lat, max_lon, max_lat = polygon["bbox"]
        for x in range(int(min_lon / 0.02), int(max_lon / 0.02) + 1):
            for y in range(int(min_lat / 0.02), int(max_lat / 0.02) + 1):
                index.setdefault((x, y), []).append(number)
    return index


def on_reef(lon: float, lat: float, polygons: list[dict], index: dict) -> bool:
    for number in index.get((int(lon / 0.02), int(lat / 0.02)), []):
        polygon = polygons[number]
        min_lon, min_lat, max_lon, max_lat = polygon["bbox"]
        if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
            continue
        if point_in_polygon(lon, lat, polygon["outer"], polygon["holes"]):
            return True
    return False


def densify(ring: list, step_m: float) -> tuple[list[dict], float]:
    points: list[dict] = []
    along = 0.0
    for index in range(len(ring) - 1):
        start_lat, start_lon = ring[index]
        end_lat, end_lon = ring[index + 1]
        length_m = km(start_lat, start_lon, end_lat, end_lon) * 1000
        if length_m == 0:
            continue
        position = 0.0
        while position <= length_m:
            fraction = position / length_m
            lat = start_lat + fraction * (end_lat - start_lat)
            lon = start_lon + fraction * (end_lon - start_lon)
            if not points or km(points[0]["lat"], points[0]["lon"], lat, lon) * 1000 > 1:
                points.append({"lat": lat, "lon": lon, "alongM": along + position})
            position += step_m
        along += length_m
    return points, along


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return lon, lat


def containing_way(lon: float, lat: float, ways: dict[str, list[str]], rims: dict) -> str | None:
    for way_id in ways:
        ring = rims.get(way_id)
        if not ring:
            continue
        outer = [(point[1], point[0]) for point in ring]
        if point_in_polygon(lon, lat, outer, []):
            return way_id
    return None


def circuit(polygons: list[dict], clon: float, clat: float) -> tuple[float, list[dict]]:
    records = []
    for polygon in polygons:
        lon, lat = centroid(polygon["outer"])
        radius = km(clat, clon, lat, lon) * 1000
        if radius < 500:
            continue
        angle = math.atan2(lat - clat, lon - clon)
        records.append({"polygon": polygon, "radius": radius, "angle": angle, "lon": lon, "lat": lat})
    if not records:
        return 0, []
    bins = [None] * 360
    for record in records:
        bucket = int(math.degrees(record["angle"]) % 360)
        bins[bucket] = record["radius"] if bins[bucket] is None else max(bins[bucket], record["radius"])
    filled = fill_bins(bins)
    outer = [
        record
        for record in records
        if record["radius"] >= filled[int(math.degrees(record["angle"]) % 360)] - OUTER_BAND_M
    ]
    if not outer:
        return 0, []
    mean_r = sorted(record["radius"] for record in outer)[len(outer) // 2]
    perimeter = 2 * math.pi * mean_r
    arcs = []
    for record in outer:
        angles = [
            math.atan2(lat - clat, lon - clon)
            for lon, lat in record["polygon"]["outer"][:: max(1, len(record["polygon"]["outer"]) // 20)]
        ]
        start, end = angle_span_metres(angles, perimeter)
        points = [
            [lon, lat]
            for lon, lat in record["polygon"]["outer"][:: max(1, len(record["polygon"]["outer"]) // 25)]
        ]
        arcs.append({"startM": start, "endM": end, "points": points})
    return perimeter, arcs


def fill_bins(bins: list) -> list[float]:
    known = [index for index, value in enumerate(bins) if value is not None]
    if not known:
        return [0.0] * 360
    filled = []
    for index in range(360):
        if bins[index] is not None:
            filled.append(bins[index])
            continue
        nearest = min(known, key=lambda item: circular_distance(item, index))
        filled.append(bins[nearest])
    return filled


def circular_distance(a: int, b: int) -> int:
    gap = abs(a - b)
    return min(gap, 360 - gap)


def angle_span_metres(angles: list[float], perimeter: float) -> tuple[float, float]:
    pts = sorted((angle + 2 * math.pi) % (2 * math.pi) for angle in angles)
    if len(pts) == 1:
        start = pts[0] / (2 * math.pi) * perimeter
        return start, start + 1
    gaps = [(pts[index + 1] - pts[index], index) for index in range(len(pts) - 1)]
    gaps.append((pts[0] + 2 * math.pi - pts[-1], -1))
    _, after = max(gaps)
    if after == -1:
        return pts[0] / (2 * math.pi) * perimeter, pts[-1] / (2 * math.pi) * perimeter
    return pts[after + 1] / (2 * math.pi) * perimeter, pts[after] / (2 * math.pi) * perimeter


def nearest_rim(lon: float, lat: float, rim_points: list[dict], rim_index: dict) -> dict | None:
    best = None
    best_m = CREST_REACH_M + 1
    x = int(lon / 0.05)
    y = int(lat / 0.05)
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            for index in rim_index.get((x + dx, y + dy), []):
                point = rim_points[index]
                distance = km(lat, lon, point["lat"], point["lon"]) * 1000
                if distance < best_m:
                    best = point
                    best_m = distance
    return best


def cover(along: list[float], perimeter: float) -> tuple[float, float]:
    pts = sorted(set(along))
    if len(pts) == 1:
        return pts[0], pts[0] + 1
    gaps = [(pts[index + 1] - pts[index], index) for index in range(len(pts) - 1)]
    gaps.append((pts[0] + perimeter - pts[-1], -1))
    _, after = max(gaps)
    if after == -1:
        return pts[0], pts[-1]
    return pts[after + 1], pts[after] + perimeter


def km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    mid = (lat1 + lat2) / 2
    return math.hypot((lat2 - lat1) * KM_LAT, (lon2 - lon1) * KM_LON * math.cos(math.radians(mid)))


def parse_polygons(blob: bytes) -> list[tuple]:
    if blob[:2] != b"GP":
        raise SystemExit("geometry is not a GeoPackage blob")
    flags = blob[3]
    envelope = (flags >> 1) & 0x07
    envelope_bytes = {0: 0, 1: 32, 2: 48, 3: 64, 4: 48}.get(envelope)
    if envelope_bytes is None:
        raise SystemExit(f"unknown envelope {envelope}")
    return wkb_polygons(blob[8 + envelope_bytes :], "<" if flags & 1 else ">")


def wkb_polygons(data: bytes, endian: str) -> list[tuple]:
    polygons = []
    kind, rings = read_wkb(data, endian)
    if kind == "polygon":
        polygons.append(rings_of(rings))
    elif kind == "multi":
        for polygon in rings:
            polygons.append(rings_of(polygon))
    return polygons


def rings_of(rings: list) -> tuple:
    outer = rings[0]
    holes = rings[1:]
    lons = [point[0] for point in outer]
    lats = [point[1] for point in outer]
    return outer, holes, (min(lons), min(lats), max(lons), max(lats))


def read_wkb(data: bytes, endian: str):
    order = "<" if data[0] == 1 else ">"
    kind = struct.unpack_from(order + "I", data, 1)[0] & 0xFF
    offset = 5
    if kind == 3:
        count = struct.unpack_from(order + "I", data, offset)[0]
        offset += 4
        rings = []
        for _ in range(count):
            points, offset = read_ring(data, offset, order)
            rings.append(points)
        return "polygon", rings
    if kind == 6:
        count = struct.unpack_from(order + "I", data, offset)[0]
        offset += 4
        polygons = []
        for _ in range(count):
            _, rings = read_wkb(data[offset:], order)
            # read_wkb consumes a nested geometry; recompute its size by walking again is wasteful.
            # Nested call returns rings only. Advance by parsing the same slice length via a second walk.
            used = wkb_size(data[offset:])
            polygons.append(rings)
            offset += used
        return "multi", polygons
    raise SystemExit(f"unsupported WKB type {kind}")


def wkb_size(data: bytes) -> int:
    order = "<" if data[0] == 1 else ">"
    kind = struct.unpack_from(order + "I", data, 1)[0] & 0xFF
    offset = 5
    if kind == 3:
        count = struct.unpack_from(order + "I", data, offset)[0]
        offset += 4
        for _ in range(count):
            points = struct.unpack_from(order + "I", data, offset)[0]
            offset += 4 + points * 16
        return offset
    if kind == 6:
        count = struct.unpack_from(order + "I", data, offset)[0]
        offset += 4
        for _ in range(count):
            offset += wkb_size(data[offset:])
        return offset
    raise SystemExit(f"unsupported WKB type {kind}")


def read_ring(data: bytes, offset: int, order: str) -> tuple[list[tuple[float, float]], int]:
    count = struct.unpack_from(order + "I", data, offset)[0]
    offset += 4
    points = []
    for _ in range(count):
        lon, lat = struct.unpack_from(order + "dd", data, offset)
        points.append((lon, lat))
        offset += 16
    return points, offset


def point_in_polygon(lon: float, lat: float, outer: list, holes: list) -> bool:
    if not in_ring(lon, lat, outer):
        return False
    return not any(in_ring(lon, lat, hole) for hole in holes)


def in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    previous = len(ring) - 1
    for current in range(len(ring)):
        xi, yi = ring[current]
        xj, yj = ring[previous]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        previous = current
    return inside


if __name__ == "__main__":
    main()
