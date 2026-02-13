"""
Stream-parse the large Snohomish County parcels GeoJSON.
Keep only 8 fields + derived ZONE_CAT, round coordinates to 6 decimals.
Outputs parcels-stripped.geojson (~163 MB).
"""

import sys
import os
import ujson
import time

INPUT = os.path.join(os.path.dirname(__file__), "..", "Parcels_2524085481023656916 (1).geojson")
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "parcels-stripped.geojson")

KEEP_FIELDS = {"PARCEL_ID", "USECODE", "GIS_ACRES", "GIS_SQ_FT",
               "SITUSLINE1", "SITUSCITY", "SITUSZIP", "MKTTL"}

# Excluded use codes (first 3 digits) — not gym-friendly
EXCLUDE_CODES = {
    # Entire zone categories excluded
    "4",   # Transportation
    "8",   # Resource/Agriculture
    "9",   # Government
    # Services (6xx)
    "611", "612", "613", "614",  # Churches, schools
    "621", "622",                # Funeral, banking
    "623",                       # Beauty/barber
    "631", "632",                # Legal, military
    "633", "634",                # Postal, corrections
    "636",                       # Insurance
    "638",                       # Mini-warehouse/self-storage
    "641",                       # Auto repair
    "651",                       # Medical/health services
    "699",                       # Churches (misc)
    # Trade (5xx)
    "511", "512", "513", "514",  # Car dealers, food retail, gas stations
    "515", "516",                # Restaurants, bars
    "517",                       # Pharmacies
    "518",                       # Specialty retail
    "519",                       # Membership warehouses (Costco)
    "599",                       # Outlet malls
    # Cultural/Recreation (7xx)
    "711", "712", "713",         # Parks, marinas, trails
    "714", "715",                # Camps, resorts
    "716", "717",                # Fairgrounds, libraries
    "721",                       # Entertainment assembly
    "742",                       # Playgrounds/athletic areas
    "743",                       # Swimming areas
    # Commercial (2xx)
    "211", "212",                # Sawmills, logging
    "213", "214",                # Food processing, petroleum
    "215", "216",                # Lumber, textiles
    # Industrial (3xx)
    "311",                       # Transportation equipment
    "312",                       # Engineering/lab
    "313",                       # Cannabis processing
    "314", "315",                # Heavy manufacturing, metals
    # Residential (1xx) — only SFR kept
    "118",                       # Manufactured homes
    "198",                       # Vacation cabins
}

ZONE_MAP = {
    "1": "Residential",
    "2": "Commercial",
    "3": "Industrial",
    "4": "Transportation",
    "5": "Trade",
    "6": "Services",
    "7": "Cultural/Recreation",
    "8": "Resource/Agriculture",
    "9": "Government",
    "0": "Undeveloped",
}


def zone_cat(usecode):
    """Derive zone category from first digit of USECODE."""
    if usecode:
        first = usecode.strip()[0] if usecode.strip() else ""
        return ZONE_MAP.get(first, "Other")
    return "Other"


def round_coords(coords):
    """Recursively round coordinate arrays to 6 decimal places."""
    if isinstance(coords[0], (int, float)):
        return [round(c, 6) for c in coords]
    return [round_coords(c) for c in coords]


def main():
    t0 = time.time()
    file_size = os.path.getsize(INPUT)
    print(f"Input file: {file_size / 1e6:.0f} MB")

    # Read the whole file — ujson is fast enough for this size
    # But we'll stream by reading raw bytes and splitting on features
    # to avoid loading everything into a Python dict at once.

    f_in = open(INPUT, "r", encoding="utf-8")
    f_out = open(OUTPUT, "w", encoding="utf-8")

    # Read until we find "features":[
    buf = ""
    while True:
        chunk = f_in.read(4096)
        if not chunk:
            break
        buf += chunk
        idx = buf.find('"features":[')
        if idx != -1:
            # Skip past "features":[
            skip_to = idx + len('"features":[')
            # Put back the rest
            remainder = buf[skip_to:]
            break

    f_out.write('{"type":"FeatureCollection","features":[\n')

    # Now parse features one by one using bracket counting
    count = 0
    brace_depth = 0
    in_string = False
    escape_next = False
    feature_start = -1
    buf = remainder

    def should_exclude(usecode):
        """Check if use code matches any exclusion pattern."""
        if not usecode:
            return True
        code = usecode.strip()
        if not code:
            return True
        # Exclude entire zone categories by first digit
        if code[0] in ("4", "8", "9"):
            return True
        # Exclude specific 3-digit codes
        if code[:3] in EXCLUDE_CODES:
            return True
        # Residential: only keep SFR (111)
        if code[0] == "1" and code[:3] != "111":
            return True
        return False

    skipped = 0

    def process_feature(raw):
        nonlocal count, skipped
        feat = ujson.loads(raw)
        props = feat.get("properties", {})
        usecode = props.get("USECODE", "")
        if should_exclude(usecode):
            skipped += 1
            return
        new_props = {}
        for k in KEEP_FIELDS:
            if k in props:
                new_props[k] = props[k]
        new_props["ZONE_CAT"] = zone_cat(props.get("USECODE", ""))

        geom = feat.get("geometry")
        if geom and "coordinates" in geom:
            geom["coordinates"] = round_coords(geom["coordinates"])

        new_feat = {
            "type": "Feature",
            "geometry": geom,
            "properties": new_props,
        }
        prefix = ",\n" if count > 0 else ""
        f_out.write(prefix + ujson.dumps(new_feat))
        count += 1
        if count % 50000 == 0:
            elapsed = time.time() - t0
            print(f"  Processed {count:,} features ({elapsed:.1f}s)")

    i = 0
    while True:
        if i >= len(buf):
            chunk = f_in.read(1 << 20)  # 1 MB chunks
            if not chunk:
                break
            buf = buf + chunk

        c = buf[i]

        if escape_next:
            escape_next = False
            i += 1
            continue

        if c == '\\' and in_string:
            escape_next = True
            i += 1
            continue

        if c == '"':
            in_string = not in_string
            i += 1
            continue

        if in_string:
            i += 1
            continue

        if c == '{':
            if brace_depth == 0:
                feature_start = i
            brace_depth += 1
        elif c == '}':
            brace_depth -= 1
            if brace_depth == 0 and feature_start >= 0:
                raw = buf[feature_start:i + 1]
                process_feature(raw)
                # Trim processed data from buffer periodically
                buf = buf[i + 1:]
                i = 0
                feature_start = -1
                continue

        i += 1

    f_out.write("\n]}\n")
    f_out.close()
    f_in.close()

    elapsed = time.time() - t0
    out_size = os.path.getsize(OUTPUT)
    print(f"\nDone! {count:,} features kept, {skipped:,} excluded in {elapsed:.1f}s")
    print(f"Output: {out_size / 1e6:.0f} MB -> {OUTPUT}")


if __name__ == "__main__":
    main()
