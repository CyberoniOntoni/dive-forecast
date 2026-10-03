"""The simulation domain: a slab of the Maldives' eastern chain, from the inner sea to the open ocean.

North Malé and South Malé, Vaadhoo Kandu between them, the gap to Gaafaru north of North Malé and the gap to
Vaavu south of South Malé. The west edge is in the inner sea, the east edge in the open ocean; both are open.
The north and south edges are walls drawn through Gaafaru and Vaavu, so the head the ocean model has between
the inner sea and the open ocean drops across the atolls and the gaps between them, as it does along the chain,
instead of short-circuiting round the domain's ends.
"""

DOMAIN = {"south": 3.55, "north": 4.75, "west": 73.22, "east": 73.78}

# Grid spacing in metres (the grid is regular in metres on a local equirectangular projection).
DX_M = 200.0

# Terrarium tiles at zoom 10 are about 150 m a pixel; zoom 11 and up drop the sea floor (sea reads 0 m).
TERRAIN_ZOOM = 10
# Zoom 12 (about 38 m a pixel) is used only for land: a pixel above 0 m is an island.
LAND_ZOOM = 12

# Atolls in the domain (sites.json atollId) and the window the cached forcing covers.
ATOLLS = ("north-male", "south-male")


# Forcing cases (forcing.py): "chain" drives the west and east edges with their own ocean-model levels, so the
# tide's head across the chain of atolls drives water through them; "uniform" gives both edges the east level,
# leaving only the rise and fall of the tide. SIM_CASE picks one; each case's files go to sim/out/<case>/.
CASES = ("chain", "uniform")


def case():
    import os
    name = os.environ.get("SIM_CASE", "chain")
    if name not in CASES:
        raise SystemExit(f"SIM_CASE must be one of {CASES}")
    return name


def case_dir():
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", case())
    os.makedirs(path, exist_ok=True)
    return path
