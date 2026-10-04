"""Forcing at the open boundary: the sea level along the west and east edges of the domain, from Open-Meteo.

Every ocean-model cell (1/12 degree) along each edge, from the domain's south wall to its north wall: the inner
sea just west of the Malé atolls (73.21 E) and the open ocean just east of them (73.79 E), over domain.WINDOW
(marine.py fetches and caches them). The solver interpolates each edge's level in latitude between these
points, so the level the edge holds varies along it as the ocean model's does.

The tide reaches the inner sea and the open ocean at slightly different times and heights: the head across the
chain of atolls this leaves is what drives water through them. The ocean model also sets the inner sea's mean a
centimetre or so off the ocean's (the monsoon's set-up across the chain); that is kept.

Only the levels are imposed. Forcing the ocean model's current at the edges would push the full drift against
a chain of atolls that blocks most of the cross-section. The drift (25-hour vector mean of the east edge's
current) is written for reference, not used by the solver.

With SIM_CASE=uniform the west edge gets the east edge's levels too (domain.py).

Writes sim/out/<case>/forcing.json: {start, lats, hours: [{time, eta_w: [per lat], eta_e: [per lat], u, v}]}
with time in Maldives wall clock, levels in m, drift u (east) and v (north) in m/s.
"""

import json
import math

import numpy as np

from domain import DOMAIN, EDGE_LON, case, case_dir
from marine import CELL_DEG, fetch


def edge_lats():
    """Ocean-model cell centres from just south of the domain to just north of it."""
    k0 = math.floor(DOMAIN["south"] / CELL_DEG - 0.5)
    k1 = math.ceil(DOMAIN["north"] / CELL_DEG - 0.5)
    return [round((k + 0.5) * CELL_DEG, 4) for k in range(k0, k1 + 1)]


def load(lat, lon):
    hours = fetch(lat, lon)
    t = [h["time"] for h in hours]
    eta = np.array([h["seaLevelM"] for h in hours], dtype=float)
    if np.isnan(eta).any():
        raise SystemExit(f"{lat},{lon}: sea level missing in {np.isnan(eta).sum()} hours")
    rad = np.radians([h["currentDirectionDeg"] or 0 for h in hours])
    speed = np.array([h["currentVelocityMs"] or 0 for h in hours], dtype=float)
    return t, eta, speed * np.sin(rad), speed * np.cos(rad)


def drift(x, half=12):
    """25-hour running mean; the window slides inward at the ends so it always spans 25 hours."""
    n = len(x)
    out = np.empty(n)
    for k in range(n):
        a = min(max(k - half, 0), n - 2 * half - 1)
        out[k] = x[a:a + 2 * half + 1].mean()
    return out


def build():
    lats = edge_lats()
    west = [load(lat, EDGE_LON["west"]) for lat in lats]
    east = [load(lat, EDGE_LON["east"]) for lat in lats]
    times = east[0][0]
    assert all(s[0] == times for s in west + east), "edge points must share hours"
    eta_e = np.array([s[1] for s in east]).T  # (hours, lats)
    eta_w = np.array([s[1] for s in west]).T if case() == "chain" else eta_e
    u = np.mean([drift(s[2]) for s in east], axis=0)
    v = np.mean([drift(s[3]) for s in east], axis=0)
    out = {"start": times[0], "case": case(), "lats": lats, "edge_lon": EDGE_LON,
           "hours": [{"time": t, "eta_w": [round(float(x), 4) for x in w], "eta_e": [round(float(x), 4) for x in e],
                      "u": round(float(a), 4), "v": round(float(b), 4)}
                     for t, w, e, a, b in zip(times, eta_w, eta_e, u, v)]}
    json.dump(out, open(f"{case_dir()}/forcing.json", "w"))
    head = eta_w - eta_e
    mean_head = head.mean(axis=1)
    print(f"{len(times)} hours from {times[0]} to {times[-1]}, {len(lats)} points a side;"
          f" ocean tide {eta_e.mean(axis=1).min():.2f}..{eta_e.mean(axis=1).max():.2f} m;"
          f" west - east {head.min():+.3f}..{head.max():+.3f} m (edge mean {mean_head.min():+.3f}..{mean_head.max():+.3f},"
          f" overall {head.mean():+.4f}); spread along the east edge {np.ptp(eta_e, axis=1).max():.3f} m,"
          f" west {np.ptp(eta_w, axis=1).max():.3f} m; drift {np.hypot(u, v).min():.2f}-{np.hypot(u, v).max():.2f} m/s")


if __name__ == "__main__":
    build()
