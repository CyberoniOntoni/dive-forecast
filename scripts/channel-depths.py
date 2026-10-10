"""Channel cross-sections on the Rasheed et al. (2021) Maldives bathymetry grid. Reads sites on stdin, prints JSON."""

import json
import math
import sys
from pathlib import Path

import netCDF4
import numpy as np

GRID = Path(__file__).resolve().parents[1] / "data" / "sources" / "rasheed-2021" / "Surface0_35s.nc"
HALF_M = 2500
STEP_M = 10
# Shallower than this is reef top; the satellite depths in the grid reach the reef flat reliably.
REEF_M = 5.0
MIN_GAP_M = 100
SEARCH_STEPS = 50
TURNS_DEG = range(-60, 61, 5)
BOX_DEG = 0.03
M_PER_DEG_LAT = 111_320


def main() -> None:
    if not GRID.exists():
        raise SystemExit(f"No grid at {GRID}")
    sites = json.load(sys.stdin)
    ds = netCDF4.Dataset(GRID)
    lat0, lon0 = float(ds["lat"][0]), float(ds["lon"][0])
    dlat, dlon = float(ds["lat"][1] - ds["lat"][0]), float(ds["lon"][1] - ds["lon"][0])
    out = []
    for site in sites:
        i0 = int((site["lat"] - BOX_DEG - lat0) / dlat)
        j0 = int((site["lon"] - BOX_DEG - lon0) / dlon)
        span_i, span_j = int(2 * BOX_DEG / dlat) + 2, int(2 * BOX_DEG / dlon) + 2
        # Grid z is elevation; flip to depth, positive down.
        depth = -np.ma.filled(ds["z"][i0 : i0 + span_i, j0 : j0 + span_j].astype(float), np.nan)

        def at(lat: float, lon: float) -> float:
            return depth[int(round((lat - lat0) / dlat)) - i0, int(round((lon - lon0) / dlon)) - j0]

        best = None
        for turn in TURNS_DEG:
            rad = math.radians(site["inward"] + 90 + turn)
            m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(site["lat"]))
            profile = np.array(
                [
                    at(site["lat"] + d * math.cos(rad) / M_PER_DEG_LAT, site["lon"] + d * math.sin(rad) / m_per_deg_lon)
                    for d in range(-HALF_M, HALF_M + 1, STEP_M)
                ]
            )
            section = gap_section(profile)
            if section and (best is None or section["widthM"] < best["widthM"]):
                best = section
        out.append({"id": site["id"], **(best or {})})
    json.dump(out, sys.stdout)


def gap_section(profile: np.ndarray) -> dict | None:
    """The open-water gap nearest the transect's middle, as in lib/channel-gap.ts, with its mean and deepest depth."""
    reef = ~(profile > REEF_M)
    n = len(profile)
    mid = (n - 1) // 2
    for off in range(SEARCH_STEPS + 1):
        for i in [mid] if off == 0 else [mid - off, mid + off]:
            if i < 0 or i >= n or reef[i]:
                continue
            lo = hi = i
            while lo > 0 and not reef[lo - 1]:
                lo -= 1
            while hi < n - 1 and not reef[hi + 1]:
                hi += 1
            width = (hi - lo + 1) * STEP_M
            if width < MIN_GAP_M:
                continue
            if lo == 0 or hi == n - 1:
                return None
            gap = profile[lo : hi + 1]
            return {"widthM": width, "meanM": float(gap.mean()), "maxM": float(gap.max())}
    return None


if __name__ == "__main__":
    main()
