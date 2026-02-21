"""
Fetch Census tract geometries and ACS median household income for
Snohomish County, WA (FIPS 53/061) and write public/income-tracts.geojson.

Usage:
    python scripts/build_income_tracts.py

No API key required for the Census Data API at moderate request volumes.
"""

import json
import urllib.request
from pathlib import Path

STATE_FIPS = "53"
COUNTY_FIPS = "061"
ACS_YEAR = "2022"
ACS_DATASET = "acs/acs5"

# TIGERweb REST API — Census Tracts (layer 6) for Snohomish County
TIGER_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "tigerWMS_ACS2022/MapServer/6/query"
    f"?where=STATE%3D'{STATE_FIPS}'+AND+COUNTY%3D'{COUNTY_FIPS}'"
    "&outFields=GEOID,NAME,STATE,COUNTY,TRACT"
    "&outSR=4326&f=geojson&returnGeometry=true"
    "&resultRecordCount=500"
)

# Census Data API — B19013_001E = median household income
CENSUS_URL = (
    f"https://api.census.gov/data/{ACS_YEAR}/{ACS_DATASET}"
    f"?get=NAME,B19013_001E"
    f"&for=tract:*"
    f"&in=state:{STATE_FIPS}%20county:{COUNTY_FIPS}"
)

OUTPUT = Path(__file__).resolve().parent.parent / "public" / "income-tracts.geojson"


def round_coords(coords, precision=5):
    """Recursively round coordinates to reduce file size."""
    if isinstance(coords[0], (int, float)):
        return [round(c, precision) for c in coords]
    return [round_coords(c, precision) for c in coords]


def classify_income(value):
    """Classify median income into brackets."""
    if value is None or value < 0:
        return "nodata"
    if value >= 75000:
        return "high"
    if value >= 50000:
        return "medium"
    return "low"


def fetch_json(url):
    """Fetch JSON from a URL."""
    print(f"  Fetching: {url[:100]}...")
    req = urllib.request.Request(url, headers={"User-Agent": "CensusDataFetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def main():
    # 1. Fetch tract geometries
    print("Step 1: Fetching tract geometries from TIGERweb...")
    tiger = fetch_json(TIGER_URL)
    features = tiger.get("features", [])
    print(f"  Got {len(features)} tract geometries")

    if not features:
        print("ERROR: No tract geometries returned. Check TIGERweb URL.")
        return

    # Build lookup by GEOID
    tracts = {}
    for f in features:
        geoid = f["properties"]["GEOID"]
        tracts[geoid] = f

    # 2. Fetch income data
    print("Step 2: Fetching median household income from Census API...")
    census = fetch_json(CENSUS_URL)

    # census is [[header...], [row...], ...]
    header = census[0]
    name_idx = header.index("NAME")
    income_idx = header.index("B19013_001E")
    state_idx = header.index("state")
    county_idx = header.index("county")
    tract_idx = header.index("tract")

    income_lookup = {}
    for row in census[1:]:
        geoid = row[state_idx] + row[county_idx] + row[tract_idx]
        raw = row[income_idx]
        try:
            val = int(float(raw)) if raw and raw not in ("-666666666", "-666666666.0") else None
        except (ValueError, TypeError):
            val = None
        income_lookup[geoid] = {
            "name": row[name_idx],
            "income": val,
        }

    print(f"  Got income data for {len(income_lookup)} tracts")

    # 3. Join and build output
    print("Step 3: Joining data...")
    out_features = []
    matched = 0
    for geoid, feature in tracts.items():
        inc = income_lookup.get(geoid, {})
        median = inc.get("income")
        bracket = classify_income(median)

        # Round coordinates
        geom = feature["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"])

        # Clean up tract name (remove "; County; State" suffix)
        raw_name = inc.get("name", feature["properties"].get("NAME", ""))
        tract_name = raw_name.split(";")[0].strip() if raw_name else ""

        out_features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "GEOID": geoid,
                "tract_name": tract_name,
                "median_income": median,
                "income_bracket": bracket,
            },
        })
        if median is not None:
            matched += 1

    geojson = {
        "type": "FeatureCollection",
        "features": out_features,
    }

    # 4. Write output
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(geojson, f)

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"\nDone! Wrote {len(out_features)} tracts to {OUTPUT}")
    print(f"  {matched} with income data, {len(out_features) - matched} nodata")
    print(f"  File size: {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
