"""Hourly simulated current at every dive site, for scripts/sim-compare.ts. Writes sim/out/<case>/sites.json.

Each site carries the cell it sampled (the nearest open-water cell, see swe.site_cells), how far that cell's
centre is from the pin, its still-water depth, and per hour: the level (m) and the depth-averaged velocity
east and north (m/s), averaged over the 30 minutes either side of the hour.
"""

import json
import os
from datetime import datetime, timedelta

import numpy as np

from domain import case_dir

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")


def main():
    run = np.load(os.path.join(case_dir(), "run.npz"))
    h = np.load(os.path.join(OUT, "grid.npz"))["h"]
    per_hour = int(3600 / int(run["sample_s"]))
    n = run["s_u"].shape[0]
    start = datetime.fromisoformat(str(run["start"]))
    hours = (n - 1) // per_hour
    sites = []
    for k, site_id in enumerate(run["site_ids"]):
        i, j, dist = run["site_cells"][k]
        rows = []
        for hr in range(hours + 1):
            a = max(hr * per_hour - per_hour // 2, 0)
            b = min(hr * per_hour + per_hour // 2, n - 1)
            rows.append({
                "time": (start + timedelta(hours=hr)).strftime("%Y-%m-%dT%H:%M"),
                "eta": round(float(run["s_eta"][a:b + 1, k].mean()), 4),
                "u": round(float(run["s_u"][a:b + 1, k].mean()), 4),
                "v": round(float(run["s_v"][a:b + 1, k].mean()), 4),
            })
        sites.append({"id": str(site_id), "cell": [int(i), int(j)], "offsetM": round(float(dist)),
                      "depthM": round(float(h[int(i), int(j)]), 1), "hours": rows})
    json.dump({"start": str(run["start"]), "sites": sites}, open(os.path.join(case_dir(), "sites.json"), "w"))
    print(f"{len(sites)} sites, {hours + 1} hours")


if __name__ == "__main__":
    main()
