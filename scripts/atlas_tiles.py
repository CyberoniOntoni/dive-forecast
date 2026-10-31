"""Reef-zone rings from the map's Atlas tile export, for when the GeoPackage is not at hand.

scripts/atoll-openings.ts writes the export (ATLAS_TILE_POLYGONS): {"crest": [ring, ...], "flat": [ring, ...]}, each
ring a list of [lon, lat]. A mouth walked on these rings is marked fromTiles; the GeoPackage stays the source of record.
"""

import json
import math
import os
from pathlib import Path


def tile_export() -> Path | None:
    value = os.environ.get("ATLAS_TILE_POLYGONS")
    return Path(value) if value else None


def load_tile_rings(path: Path, kind: str) -> list[list[tuple[float, float]]]:
    """The closed, finite outer rings of one kind ("crest" or "flat"). An export with none of that kind is an error."""
    rings = []
    for ring in json.loads(path.read_text(encoding="utf-8"))[kind]:
        if len(ring) < 4:
            continue
        if not all(math.isfinite(value) for point in ring for value in point):
            raise SystemExit(f"{kind} ring in {path} is not a finite outline")
        rings.append([(point[0], point[1]) for point in ring])
    if not rings:
        raise SystemExit(f"no {kind} rings in {path}")
    return rings
