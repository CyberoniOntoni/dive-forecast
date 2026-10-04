"""Figures for sim/README.md, written to sim/figures/.

  depth.png      the depth grid the simulation runs on
  flow-*.png     simulated current over North Malé at the strongest flood and ebb hours of the last week, and the
                 mean over the run (spin-up excluded)
  sites.png      simulated current along each site's axis against the forecast, for a few sites, over the last
                 SITES_DAYS of the run (the scores in each title are over the whole run)
"""

import json
import os
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LogNorm  # noqa: E402

from domain import case, case_dir  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
FIG = os.path.join(ROOT, "figures")
# North Malé, in cells: rows (south to north) and columns (west to east).
NM = (slice(335, 663), slice(60, 300))
SITES = ("hp-reef", "embudhoo-express", "kandooma-thila", "lions-head", "okobe-thila", "rasfari")
SITES_DAYS = 8


def load():
    grid = np.load(os.path.join(OUT, "grid.npz"))
    run = np.load(os.path.join(case_dir(), "run.npz"))
    forcing = json.load(open(os.path.join(case_dir(), "forcing.json")))
    return grid, run, forcing


def depth_figure(grid):
    h = grid["h"]
    fig, ax = plt.subplots(figsize=(5, 10))
    im = ax.imshow(np.where(h > 0, h, np.nan), origin="lower", cmap="viridis_r", norm=LogNorm(0.3, 400))
    ax.imshow(np.where(h < 0, 1, np.nan), origin="lower", cmap="Oranges", vmin=0, vmax=1.2)
    fig.colorbar(im, ax=ax, shrink=0.6, label="still-water depth, m (log)")
    ax.set_title("Depth grid, 200 m cells (orange: land)")
    label_axes(ax, h.shape)
    save(fig, "depth.png")


def label_axes(ax, shape, rows=slice(None), cols=slice(None)):
    ax.set_xticks([])
    ax.set_yticks([])


def flow_figure(grid, run, k, title, name, mean=False):
    h = grid["h"][NM]
    if mean:
        u = run["mean_u"].astype(float)[NM]
        v = run["mean_v"].astype(float)[NM]
    else:
        k -= int(run["field_from"])
        u = run["f_u"][k].astype(float)[NM]
        v = run["f_v"][k].astype(float)[NM]
    speed = np.hypot(u, v)
    speed[h < 0] = np.nan
    fig, ax = plt.subplots(figsize=(7, 9))
    im = ax.imshow(speed, origin="lower", cmap="magma", vmin=0, vmax=0.3 if mean else 1.0)
    fig.colorbar(im, ax=ax, shrink=0.6, label="depth-averaged speed, m/s")
    ax.contour(h, levels=[1.5], colors="w", linewidths=0.4)
    ax.imshow(np.where(h < 0, 1, np.nan), origin="lower", cmap="Oranges", vmin=0, vmax=1.2)
    s = 6
    yy, xx = np.mgrid[0:h.shape[0]:s, 0:h.shape[1]:s]
    us, vs = u[::s, ::s], v[::s, ::s]
    keep = h[::s, ::s] > 2
    ax.quiver(xx[keep], yy[keep], us[keep], vs[keep], color="#7fdbff", scale=1.5 if mean else 6, width=0.002)
    ax.set_title(title)
    label_axes(ax, h.shape)
    save(fig, name)


def sites_figure():
    compare = json.load(open(os.path.join(case_dir(), "compare.json")))
    rows = [r for r in compare["rows"] if r["id"] in SITES]
    rows.sort(key=lambda r: SITES.index(r["id"]))
    fig, axes = plt.subplots(len(rows), 1, figsize=(10, 2.1 * len(rows)), sharex=True)
    for ax, row in zip(np.atleast_1d(axes), rows):
        series = row["series"][-SITES_DAYS * 24:]
        t = [datetime.fromisoformat(x["time"]) for x in series]
        ax.axhline(0, color="#888", lw=0.5)
        ax.plot(t, [x["sim"] for x in series], color="#d62728", lw=1.4, label="simulation, m/s along axis")
        ax2 = ax.twinx()
        ax2.step(t, [x["forecast"] for x in series], where="mid", color="#1f77b4", lw=1.1, label="forecast, signed band")
        ax2.set_ylim(-3.3, 3.3)
        ax2.set_yticks([-3, -2, -1, 0, 1, 2, 3])
        lim = max(0.3, max(abs(x["sim"]) for x in series) * 1.1)
        ax.set_ylim(-lim, lim)
        ax.set_title(f"{row['name']} ({row['kind']}, axis {row['axisDeg']}°): direction agrees {pct(row['direction'])},"
                     f" r = {row['correlation']:.2f}, best lag {row['bestLag']} h", fontsize=9)
        ax.tick_params(labelsize=8)
        ax2.tick_params(labelsize=8, colors="#1f77b4")
    np.atleast_1d(axes)[0].legend(loc="upper left", fontsize=7)
    fig.autofmt_xdate()
    fig.tight_layout()
    save(fig, "sites.png")


def pct(x):
    return "–" if x is None or not np.isfinite(x) else f"{round(100 * x)} %"


def save(fig, name):
    os.makedirs(FIG, exist_ok=True)
    fig.savefig(os.path.join(FIG, name), dpi=80, bbox_inches="tight")
    plt.close(fig)


def main():
    grid, run, forcing = load()
    depth_figure(grid)
    # Strongest flood and ebb into North Malé: the hours of steepest rise and fall of the ocean level in the
    # stretch the hourly fields cover.
    eta = np.array([np.mean(x["eta_e"]) for x in forcing["hours"]])
    slope = np.gradient(eta)
    first = max(int(run["field_from"]), 24)
    ks = np.arange(first, int(run["field_from"]) + run["f_u"].shape[0])
    flood = int(ks[np.argmax(slope[ks])])
    ebb = int(ks[np.argmin(slope[ks])])
    t = forcing["hours"]
    flow_figure(grid, run, flood, f"Rising tide, {t[flood]['time']}", "flow-flood.png")
    flow_figure(grid, run, ebb, f"Falling tide, {t[ebb]['time']}", "flow-ebb.png")
    flow_figure(grid, run, None, f"Mean over {t[24]['time'][:10]} to {t[-1]['time'][:10]} (tide removed)",
                "flow-mean.png", mean=True)
    if os.path.exists(os.path.join(case_dir(), "compare.json")):
        sites_figure()
    print(f"figures in {FIG}")


if __name__ == "__main__":
    main()
