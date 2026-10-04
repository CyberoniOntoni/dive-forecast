"""Depth-averaged (2-D) nonlinear shallow-water model of the domain, forced by the tide and the ocean drift.

    dU/dt + (U.grad)U + f k x U = -g grad(eta) - g n^2 |U| U / H^(4/3) + nu lap(U)
    d(eta)/dt + div(H U) = 0,     H = h + eta

Staggered C-grid on the 200 m cells of grid.py; forward-backward explicit time stepping; first-order upwind
advection; Manning bottom friction, implicit; upwind total depth in the mass fluxes, so reef flats dry and
flood without going negative (Stelling & Duinmeijer 2003). Land (islands) is a wall, and so are the north and
south edges (domain.py). The west and east edges are open: a Flather (radiation) condition, plus a sponge a
few km wide that holds the level to forcing.py's, the inner sea's on the west and the ocean's on the east, each
varying along its edge as the ocean model's does (clamped in the outer three columns, relaxed inside them). The deep inner sea and open ocean carry a level
across the 10-20 km between the edge and the reefs with almost no loss, so the head drops where it should: across
the atolls and the gaps between them.
Nothing else is imposed: every current inside comes from those two levels, the depths and friction. The sea floor is capped at 400 m (grid.py) to keep the time step near 1.5 s.

Writes sim/out/<case>/run.npz: 10-minute series at every dive site in the domain, sampled at the nearest
open-water cell to the pin (site_cells); hourly fields (eta, u, v at cell centres, float16) over the last
FIELD_DAYS; and the mean current over the run after spin-up. A 90-day run takes several hours, so the state is
checkpointed every simulated day (checkpoint.npz) and a rerun with the same forcing resumes from it.
"""

import json
import math
import os
import sys
import time

import numpy as np
from numba import njit, prange
from scipy.interpolate import CubicSpline

from domain import SPINUP_H, case_dir
from grid import cell_of, lonlat_of

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT = os.path.join(ROOT, "out")

G = 9.81
DT = 1.5  # s; c = sqrt(9.81 * 400) = 63 m/s on 200 m cells gives a CFL number near 0.5
NU = 5.0  # m^2/s; upwind advection adds far more on its own at these speeds
MANNING_REEF = 0.035  # reef crest and flats: rough
MANNING = 0.025
H_DRY = 0.05  # m of water below which a cell is dry
SPONGE_CELLS = 15
SPONGE_TAU_S = 120.0
CLAMP_CELLS = 3
SPONGE_MIN_DEPTH = 20.0
SAMPLE_EVERY_S = 600
SITE_MIN_DEPTH_M = 3.0  # a site samples the nearest cell at least this deep, within SITE_SEARCH_CELLS
SITE_SEARCH_CELLS = 3
FIELD_DAYS = 7  # hourly fields kept for the last this many days (the full 90 would be about 3 GB)
TAB_DT_S = 600.0  # the edge levels are tabulated every 10 minutes and interpolated linearly between


@njit(parallel=True, fastmath=True, cache=True)
def momentum(eta, u, v, h, n2, un, vn, dt, dx, f, nu, eta_w, eta_e, east_w):
    ny, nx = eta.shape
    for i0 in prange(ny):
        i = np.int64(i0)
        for j in range(nx + 1):
            if j == 0 or j == nx:
                c = i, (0 if j == 0 else nx - 1)
                hc = h[c]
                if hc < 0:
                    un[i, j] = 0.0
                    continue
                H = max(hc + eta[c], H_DRY)
                sgn = -1.0 if j == 0 else 1.0
                ext = eta_w[i] + east_w[c] * (eta_e[i] - eta_w[i])
                un[i, j] = sgn * math.sqrt(G / H) * (eta[c] - ext)
                continue
            hl = h[i, j - 1]
            hr = h[i, j]
            if hl < 0 or hr < 0:
                un[i, j] = 0.0
                continue
            Hl = hl + eta[i, j - 1]
            Hr = hr + eta[i, j]
            grad = (eta[i, j] - eta[i, j - 1]) / dx
            if (Hl < H_DRY and Hr < H_DRY) or (grad > 0 and Hr < H_DRY) or (grad < 0 and Hl < H_DRY):
                un[i, j] = 0.0
                continue
            uu = u[i, j]
            vb = 0.25 * (v[i, j - 1] + v[i, j] + v[i + 1, j - 1] + v[i + 1, j])
            if uu > 0:
                ax = uu * (uu - u[i, j - 1]) / dx
            else:
                ax = uu * (u[i, j + 1] - uu) / dx
            iS = max(i - 1, 0)
            iN = min(i + 1, ny - 1)
            if vb > 0:
                ay = vb * (uu - u[iS, j]) / dx
            else:
                ay = vb * (u[iN, j] - uu) / dx
            lap = (u[i, j - 1] + u[i, j + 1] + u[iS, j] + u[iN, j] - 4.0 * uu) / (dx * dx)
            Hf = max(0.5 * (Hl + Hr), H_DRY)
            ustar = uu + dt * (-G * grad - ax - ay + f * vb + nu * lap)
            speed = math.sqrt(uu * uu + vb * vb)
            nf = 0.5 * (n2[i, j - 1] + n2[i, j])
            un[i, j] = ustar / (1.0 + dt * G * nf * speed / Hf ** (4.0 / 3.0))
    for i0 in prange(ny + 1):
        i = np.int64(i0)
        for j in range(nx):
            if i == 0 or i == ny:
                vn[i, j] = 0.0
                continue
            hs = h[i - 1, j]
            hn = h[i, j]
            if hs < 0 or hn < 0:
                vn[i, j] = 0.0
                continue
            Hs = hs + eta[i - 1, j]
            Hn = hn + eta[i, j]
            grad = (eta[i, j] - eta[i - 1, j]) / dx
            if (Hs < H_DRY and Hn < H_DRY) or (grad > 0 and Hn < H_DRY) or (grad < 0 and Hs < H_DRY):
                vn[i, j] = 0.0
                continue
            vv = v[i, j]
            ub = 0.25 * (u[i - 1, j] + u[i - 1, j + 1] + u[i, j] + u[i, j + 1])
            if vv > 0:
                ay = vv * (vv - v[i - 1, j]) / dx
            else:
                ay = vv * (v[i + 1, j] - vv) / dx
            jW = max(j - 1, 0)
            jE = min(j + 1, nx - 1)
            if ub > 0:
                ax = ub * (vv - v[i, jW]) / dx
            else:
                ax = ub * (v[i, jE] - vv) / dx
            lap = (v[i - 1, j] + v[i + 1, j] + v[i, jW] + v[i, jE] - 4.0 * vv) / (dx * dx)
            Hf = max(0.5 * (Hs + Hn), H_DRY)
            vstar = vv + dt * (-G * grad - ax - ay - f * ub + nu * lap)
            speed = math.sqrt(vv * vv + ub * ub)
            nf = 0.5 * (n2[i - 1, j] + n2[i, j])
            vn[i, j] = vstar / (1.0 + dt * G * nf * speed / Hf ** (4.0 / 3.0))


@njit(parallel=True, fastmath=True, cache=True)
def continuity(eta, u, v, h, sponge, dt, dx, eta_w, eta_e, east_w, relax):
    ny, nx = eta.shape
    for i0 in prange(ny):
        i = np.int64(i0)
        for j in range(nx):
            if h[i, j] < 0:
                continue
            fl = flux_x(eta, u, h, i, j)
            fr = flux_x(eta, u, h, i, j + 1)
            fs = flux_y(eta, v, h, i, j)
            fn = flux_y(eta, v, h, i + 1, j)
            e = eta[i, j] - dt / dx * (fr - fl + fn - fs)
            if e < -h[i, j]:
                e = -h[i, j]
            eta[i, j] = e
    # Sponge: relax the level at the edges toward the open ocean's.
    for i0 in prange(ny):
        i = np.int64(i0)
        for j in range(nx):
            w = sponge[i, j] * relax
            if w > 0:
                eta[i, j] += w * (eta_w[i] + east_w[i, j] * (eta_e[i] - eta_w[i]) - eta[i, j])


@njit(inline="always")
def flux_x(eta, u, h, i, j):
    nx = eta.shape[1]
    uu = u[i, j]
    if uu == 0.0:
        return 0.0
    if uu > 0:
        c = max(j - 1, 0)
    else:
        c = min(j, nx - 1)
    if h[i, c] < 0:
        return 0.0
    return uu * max(h[i, c] + eta[i, c], 0.0)


@njit(inline="always")
def flux_y(eta, v, h, i, j):
    ny = eta.shape[0]
    vv = v[i, j]
    if vv == 0.0:
        return 0.0
    if vv > 0:
        c = max(i - 1, 0)
    else:
        c = min(i, ny - 1)
    if h[c, j] < 0:
        return 0.0
    return vv * max(h[c, j] + eta[c, j], 0.0)


@njit(cache=True)
def run_steps(eta, u, v, h, n2, sponge, east_w, un, vn, t0, nsteps, dt, dx, f, nu, tab_t0, tab_dt, tab_w, tab_e):
    t = t0
    for _ in range(nsteps):
        k = (t - tab_t0) / tab_dt
        k0 = min(max(int(k), 0), tab_w.shape[0] - 2)
        a = min(max(k - k0, 0.0), 1.0)
        e_w = tab_w[k0] * (1 - a) + tab_w[k0 + 1] * a
        e_e = tab_e[k0] * (1 - a) + tab_e[k0 + 1] * a
        momentum(eta, u, v, h, n2, un, vn, dt, dx, f, nu, e_w, e_e, east_w)
        u, un = un, u
        v, vn = vn, v
        continuity(eta, u, v, h, sponge, dt, dx, e_w, e_e, east_w, dt / SPONGE_TAU_S)
        t += dt
    return t, u, v, un, vn


def sponge_weights(h):
    ny, nx = h.shape
    i = np.arange(ny)[:, None]
    j = np.arange(nx)[None, :]
    d = np.minimum(j, nx - 1 - j) + 0 * i
    # The outer CLAMP_CELLS columns hold the ocean's level outright (relax = 1 per step); inside them the pull
    # fades over the sponge.
    w = np.where(d < CLAMP_CELLS, SPONGE_TAU_S / DT, np.clip(1 - (d - CLAMP_CELLS) / SPONGE_CELLS, 0, 1) ** 2)
    return np.where(h > SPONGE_MIN_DEPTH, w, 0.0)


def domain_sites():
    from domain import ATOLLS
    data = json.load(open(os.path.join(REPO, "data", "sites.json")))
    return [s for s in data["sites"] if s["atollId"] in ATOLLS]


def site_cells(h, sites):
    """The open-water cell each site samples: the nearest cell at least SITE_MIN_DEPTH_M deep, within a few cells."""
    ny, nx = h.shape
    cells = []
    for s in sites:
        fi, fj = cell_of(s["lat"], s["lon"])
        best = None
        for di in range(-SITE_SEARCH_CELLS, SITE_SEARCH_CELLS + 1):
            for dj in range(-SITE_SEARCH_CELLS, SITE_SEARCH_CELLS + 1):
                i, j = int(round(fi)) + di, int(round(fj)) + dj
                if not (0 <= i < ny and 0 <= j < nx) or h[i, j] < SITE_MIN_DEPTH_M:
                    continue
                d = math.hypot(i - fi, j - fj)
                if best is None or d < best[0]:
                    best = (d, i, j)
        if best is None:
            i, j = min(max(int(round(fi)), 0), ny - 1), min(max(int(round(fj)), 0), nx - 1)
            best = (0.0, i, j)
        cells.append((best[1], best[2], best[0] * float(np.load(os.path.join(OUT, "grid.npz"))["dx"])))
    return cells


def centred(u, v):
    return 0.5 * (u[:, :-1] + u[:, 1:]), 0.5 * (v[:-1, :] + v[1:, :])


def main(hours=None):
    grid = np.load(os.path.join(OUT, "grid.npz"))
    h = grid["h"].astype(np.float64)
    zone = grid["zone"]
    dx = float(grid["dx"])
    south, north, _, _ = grid["domain"]
    f = 2 * 7.2921e-5 * math.sin(math.radians((south + north) / 2))
    ny, nx = h.shape
    classes = list(grid["classes"])
    reef_zones = [classes.index(n) for n in ("Reef Crest", "Outer Reef Flat", "Inner Reef Flat")]
    n2 = np.where(np.isin(zone, reef_zones), MANNING_REEF**2, MANNING**2).astype(np.float64)

    forcing = json.load(open(os.path.join(case_dir(), "forcing.json")))
    fh = forcing["hours"]
    total_h = len(fh) - 1 if hours is None else hours
    th = np.arange(len(fh)) * 3600.0
    tab_t = np.arange(0, th[-1] + 1, TAB_DT_S)
    # Each edge's level: a cubic spline in time at each forcing latitude, then linear in latitude to every row.
    row_lat = np.array([lonlat_of(i, 0)[1] for i in range(ny)])
    lats = np.array(forcing["lats"])

    def table(key):
        at_lats = CubicSpline(th, np.array([x[key] for x in fh]), axis=0)(tab_t)  # (times, lats)
        return np.ascontiguousarray(np.array([np.interp(row_lat, lats, row) for row in at_lats]))  # (times, rows)

    tab_w = table("eta_w")
    tab_e = table("eta_e")
    east_w = np.repeat((np.arange(nx) >= nx // 2).astype(np.float64)[None, :], ny, axis=0)

    sponge = sponge_weights(h)
    sites = domain_sites()
    cells = site_cells(h, sites)
    ci = np.array([c[0] for c in cells])
    cj = np.array([c[1] for c in cells])

    steps_per_sample = int(round(SAMPLE_EVERY_S / DT))
    samples_per_hour = int(3600 / SAMPLE_EVERY_S)
    nsamples = total_h * samples_per_hour + 1
    field_from = max(total_h - FIELD_DAYS * 24, 0)
    state = {
        "s_eta": np.zeros((nsamples, len(sites)), np.float32),
        "s_u": np.zeros((nsamples, len(sites)), np.float32),
        "s_v": np.zeros((nsamples, len(sites)), np.float32),
        "f_eta": np.zeros((total_h - field_from + 1, ny, nx), np.float16),
        "f_u": np.zeros((total_h - field_from + 1, ny, nx), np.float16),
        "f_v": np.zeros((total_h - field_from + 1, ny, nx), np.float16),
        "mean_u": np.zeros((ny, nx)), "mean_v": np.zeros((ny, nx)), "mean_n": np.zeros(1),
    }
    eta = np.maximum(np.full((ny, nx), 0.5 * (tab_w[0].mean() + tab_e[0].mean())), -np.maximum(h, 0))
    eta[h < 0] = 0
    u = np.zeros((ny, nx + 1))
    v = np.zeros((ny + 1, nx))
    t, k_done = 0.0, 0

    ckpt = os.path.join(case_dir(), "checkpoint.npz")
    if os.path.exists(ckpt):
        c = np.load(ckpt)
        if str(c["start"]) == forcing["start"] and int(c["total_h"]) == total_h and c["s_eta"].shape == state["s_eta"].shape:
            eta, u, v, t, k_done = c["eta"].copy(), c["u"].copy(), c["v"].copy(), float(c["t"]), int(c["k"])
            for key in state:
                state[key] = c[key].copy()
            print(f"resuming at hour {k_done // samples_per_hour}", file=sys.stderr, flush=True)
    un = np.zeros_like(u)
    vn = np.zeros_like(v)

    def record(k, u, v):
        uc, vc = centred(u, v)
        state["s_eta"][k] = eta[ci, cj]
        state["s_u"][k] = uc[ci, cj]
        state["s_v"][k] = vc[ci, cj]
        if k % samples_per_hour == 0:
            hk = k // samples_per_hour
            if hk >= field_from:
                state["f_eta"][hk - field_from] = eta
                state["f_u"][hk - field_from] = uc
                state["f_v"][hk - field_from] = vc
            if hk > SPINUP_H:
                state["mean_u"] += uc
                state["mean_v"] += vc
                state["mean_n"] += 1

    def checkpoint(k):
        tmp = ckpt + ".tmp.npz"
        np.savez(tmp, start=forcing["start"], total_h=total_h, eta=eta, u=u, v=v, t=t, k=k, **state)
        os.replace(tmp, ckpt)

    if k_done == 0:
        record(0, u, v)
    wall = time.time()
    for k in range(k_done + 1, nsamples):
        t, u, v, un, vn = run_steps(eta, u, v, h, n2, sponge, east_w, un, vn, t, steps_per_sample, DT, dx, f, NU,
                                    0.0, TAB_DT_S, tab_w, tab_e)
        record(k, u, v)
        if not np.isfinite(eta).all():
            raise SystemExit(f"blew up at t = {t / 3600:.2f} h")
        if k % samples_per_hour == 0:
            hk = k // samples_per_hour
            uc, vc = centred(u, v)
            sp = np.hypot(uc, vc)
            print(f"hour {hk:4d}/{total_h}  {fh[hk]['time']}  tide {np.interp(t, tab_t, tab_e.mean(axis=1)):+.2f} m"
                  f"  max speed {sp.max():.2f} m/s  ({time.time() - wall:.0f} s)", file=sys.stderr, flush=True)
            if hk % 24 == 0:
                checkpoint(k)

    n = max(float(state["mean_n"][0]), 1.0)
    np.savez_compressed(
        os.path.join(case_dir(), "run.npz"),
        start=forcing["start"], sample_s=SAMPLE_EVERY_S, field_from=field_from,
        site_ids=np.array([s["id"] for s in sites]), site_cells=np.array(cells),
        s_eta=state["s_eta"], s_u=state["s_u"], s_v=state["s_v"],
        f_eta=state["f_eta"], f_u=state["f_u"], f_v=state["f_v"],
        mean_u=(state["mean_u"] / n).astype(np.float32), mean_v=(state["mean_v"] / n).astype(np.float32),
    )
    if os.path.exists(ckpt):
        os.remove(ckpt)
    print(f"{total_h} hours simulated in {time.time() - wall:.0f} s; {len(sites)} sites sampled")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
