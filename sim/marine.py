"""Open-Meteo marine series for the simulation window, cached in sim/cache/marine/ (gitignored).

The same request the app makes (lib/marine.ts: sea level and ocean current, the nearest sea cell, Maldives wall
clock), over WINDOW instead of 1 past + 7 forecast days. The ocean model's grid is 1/12 degree, so the cache is
keyed by the cell Open-Meteo answers with: nearby requests share a file.

Python's urllib verifies TLS against SSL_CERT_FILE when it is set (behind a proxy with its own CA).
"""

import json
import os
import time
import urllib.parse
import urllib.request

from domain import WINDOW

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "cache", "marine")
URL = "https://marine-api.open-meteo.com/v1/marine"
CELL_DEG = 1 / 12


def cell_key(lat, lon):
    """The ocean-model cell a point falls in (centres at multiples of 1/12 degree plus 1/24)."""
    snap = lambda x: round((x - CELL_DEG / 2) / CELL_DEG) * CELL_DEG + CELL_DEG / 2  # noqa: E731
    return f"{snap(lat):.4f}_{snap(lon):.4f}"


def cache_path(lat, lon):
    return os.path.join(CACHE, f"{WINDOW[0]}_{WINDOW[1]}_{cell_key(lat, lon)}.json")


def fetch(lat, lon):
    """Hours [{time, seaLevelM, currentVelocityMs, currentDirectionDeg}] at a point, from the cache or the API.

    The cache holds the API's answer as it came (scripts/sim-compare.ts serves it to the app's own parser)."""
    os.makedirs(CACHE, exist_ok=True)
    path = cache_path(lat, lon)
    if os.path.exists(path):
        return hours_of(json.load(open(path)))
    query = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "hourly": "sea_level_height_msl,ocean_current_velocity,ocean_current_direction",
        "cell_selection": "sea", "timezone": "Indian/Maldives",
        "start_date": WINDOW[0], "end_date": WINDOW[1],
    })
    for attempt in range(5):
        try:
            body = json.load(urllib.request.urlopen(f"{URL}?{query}", timeout=60))
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
    json.dump(body, open(path, "w"))
    return hours_of(body)


def hours_of(body):
    hourly = body["hourly"]
    # The API reports current speed in km/h unless asked otherwise.
    to_ms = 1 / 3.6 if body.get("hourly_units", {}).get("ocean_current_velocity", "km/h") == "km/h" else 1.0
    return [{"time": t, "seaLevelM": e,
             "currentVelocityMs": None if s is None else s * to_ms, "currentDirectionDeg": d}
            for t, e, s, d in zip(hourly["time"], hourly["sea_level_height_msl"],
                                  hourly["ocean_current_velocity"], hourly["ocean_current_direction"])]
