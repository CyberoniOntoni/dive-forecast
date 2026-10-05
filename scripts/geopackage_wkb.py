"""Polygon rings from a GeoPackage geometry blob."""

import struct


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
