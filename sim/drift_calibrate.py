"""Size the monsoon drift's head across the chain: steady heads, no tide, against the flow they drive in Vaadhoo Kandu.

The ocean model's drift is an 8 km model's current; it does not see the atolls, but it does carry the flow through a
5 km, 400 m deep strait such as Vaadhoo Kandu. So the head the "drift" case adds (forcing.py) is sized to drive the
ocean model's drift through the strait: for each trial head (west edge higher, both edges otherwise at the mean sea
level), the solver runs from rest for HOURS and the mean eastward current across the strait is read on a north-south
transect (depth-weighted, so it is the transport over the section's area).

Prints, per head, the strait current hour by hour and the gain (m of head per m/s of strait current) once settled.
"""

import json
import os
import sys

import numpy as np

os.environ["SIM_CASE"] = "calib"

from domain import case_dir  # noqa: E402
from forcing import edge_lats  # noqa: E402
from grid import cell_of  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
HEADS_M = (0.01, 0.03)
HOURS = 18
# Vaadhoo Kandu between North and South Malé: a north-south transect across the strait.
TRANSECT = {"lon": 73.48, "south": 4.12, "north": 4.19}


def strait_current(run, h):
    j = int(round(cell_of(TRANSECT["south"], TRANSECT["lon"])[1]))
    i0 = int(round(cell_of(TRANSECT["south"], TRANSECT["lon"])[0]))
    i1 = int(round(cell_of(TRANSECT["north"], TRANSECT["lon"])[0]))
    depth = np.where(h[i0:i1 + 1, j] > 0, h[i0:i1 + 1, j], 0.0)
    u = run["f_u"][:, i0:i1 + 1, j].astype(float)
    return (u * depth).sum(axis=1) / depth.sum()


def main():
    import swe

    lats = edge_lats()
    h = np.load(os.path.join(ROOT, "out", "grid.npz"))["h"]
    base = 0.43
    for head in HEADS_M:
        hours = [{"time": f"2026-01-01T{k % 24:02d}:00", "eta_w": [base + head] * len(lats), "eta_e": [base] * len(lats),
                  "u": 0.0, "v": 0.0} for k in range(HOURS + 1)]
        json.dump({"start": f"calib-{head}", "case": "calib", "lats": lats, "hours": hours},
                  open(os.path.join(case_dir(), "forcing.json"), "w"))
        swe.main()
        run = np.load(os.path.join(case_dir(), "run.npz"))
        u = strait_current(run, h)
        print(f"head {head * 100:.0f} cm: strait current by hour " + " ".join(f"{x:.3f}" for x in u))
        settled = u[-6:].mean()
        print(f"  settled {settled:.3f} m/s east; {head / settled:.3f} m of head per m/s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
