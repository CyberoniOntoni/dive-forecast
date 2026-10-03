"""Forcing at the open boundary: the sea level on the west and east sides of the domain.

From the cached Open-Meteo series in data/benchmark-marine-cache (25-30 Sep 2026; the live cache is not in the
repo and the API is not reachable from every machine).

East: three independent points in the open ocean east of the atolls, 4.2094,73.5447 (North Malé, south-east),
3.9005,73.5042 (South Malé, north-east) and 3.6000,73.5235 (South Malé, south; 3.5933 and 3.5950 are the same
ocean-model cell). Their sea levels agree within 2 cm: the east level is their mean.
West: 4.2397,73.0153 in the inner sea off North Ari, the only cached point west of the Malé atolls. It runs up
to 0.15 m off the east level through the tide: the tide crosses the double chain of atolls with a lag, and
that head across the chain is what drives water through Vaadhoo Kandu and the atolls. The 25-hour means of
the two sides differ by 1-2 cm, the ocean model's own monsoon set-up across the chain.

Only the levels are imposed. Forcing the ocean model's current at the edges would push the full drift against
a chain of atolls that blocks most of the cross-section. The drift (25-hour vector mean of the east points'
current) is written for reference and for the comparison, not used by the solver.

With SIM_CASE=uniform the west edge gets the east level too (domain.py).

Writes sim/out/<case>/forcing.json: {start, hours: [{time, eta_w, eta_e, u, v}]} with time in Maldives wall clock,
levels in m, drift u (east) and v (north) in m/s.
"""

import json
import os

import numpy as np

from domain import case, case_dir

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
POINTS = ("4.2094_73.5447", "3.9005_73.5042", "3.6000_73.5235")
WEST = "4.2397_73.0153"
START, END = "2026-09-25T00:00", "2026-09-30T23:00"


def load(point):
    hours = json.load(open(os.path.join(REPO, "data", "benchmark-marine-cache", point + ".json")))["hours"]
    hours = [h for h in hours if START <= h["time"] <= END]
    t = [h["time"] for h in hours]
    eta = np.array([h["seaLevelM"] for h in hours], dtype=float)
    rad = np.radians([h["currentDirectionDeg"] for h in hours])
    speed = np.array([h["currentVelocityMs"] for h in hours], dtype=float)
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
    series = [load(p) for p in POINTS]
    times = series[0][0]
    assert all(s[0] == times for s in series), "points must share hours"
    eta = np.mean([s[1] for s in series], axis=0)
    west = load(WEST)
    assert west[0] == times, "west point must share hours"
    eta_w = west[1] if case() == "chain" else eta
    u = np.mean([drift(s[2]) for s in series], axis=0)
    v = np.mean([drift(s[3]) for s in series], axis=0)
    spread = np.max([np.abs(s[1] - eta).max() for s in series])
    out = {"start": times[0], "east_points": POINTS, "west_point": WEST,
           "hours": [{"time": t, "eta_w": round(float(w), 4), "eta_e": round(float(e), 4),
                      "u": round(float(a), 4), "v": round(float(b), 4)}
                     for t, w, e, a, b in zip(times, eta_w, eta, u, v)]}
    out["case"] = case()
    json.dump(out, open(os.path.join(case_dir(), "forcing.json"), "w"), indent=0)
    speed = np.hypot(u, v)
    heading = (np.degrees(np.arctan2(u, v)) + 360) % 360
    print(f"{len(times)} hours from {times[0]}; tide range {eta.min():.2f}..{eta.max():.2f} m, east spread {spread:.3f} m,"
          f" west - east {np.min(eta_w - eta):+.2f}..{np.max(eta_w - eta):+.2f} m (mean {np.mean(eta_w - eta):+.3f});"
          f" drift {speed.min():.2f}-{speed.max():.2f} m/s toward {heading.min():.0f}-{heading.max():.0f} deg")


if __name__ == "__main__":
    build()
