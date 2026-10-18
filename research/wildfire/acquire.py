"""Download and pin raw sources. Every file is recorded with URL, time, size and SHA-256.

Sources (all public except SRTM, which needs a NASA Earthdata bearer token):
- FIRMS VIIRS S-NPP yearly United States archives (thermal detections)
- FPA FOD 7th edition fire records for Washington (labels)
- NASA POWER daily weather at the MERRA-2 grid (reanalysis)
- SRTMGL3 elevation tiles from LP DAAC (Earthdata Login)
- US Census 2023 state boundary
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .config import RAW, experiment, load_env

USER_AGENT = "EmberReady-research/1.0 (DubHacks/SpaceX hackathon; github.com/jumiknows/spacex2026Hacks)"
FPA_LAYER = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_FireOccurrenceCurrentEdition_01/MapServer/0/query"
FPA_FIELDS = [
    "fod_id", "fire_year", "discovery_doy", "discovery_time", "latitude", "longitude",
    "nwcg_cause_classification", "nwcg_reporting_agency", "fire_size", "mtbs_id", "complex_name", "state",
]
POWER_PARAMS = ["T2M_MAX", "T2M_MIN", "RH2M", "WS10M_MAX", "PRECTOTCORR", "GWETTOP"]
CENSUS_STATES = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip"


def _manifest_path() -> Path:
    return RAW / "manifest.json"


def _load_manifest() -> dict:
    path = _manifest_path()
    return json.loads(path.read_text()) if path.exists() else {}


def _save_manifest(manifest: dict) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    _manifest_path().write_text(json.dumps(manifest, indent=2, sort_keys=True))


def _redact(url: str) -> str:
    return url  # no source in this module puts a credential in the URL


def fetch(url: str, dest: Path, manifest: dict, headers: dict | None = None, retries: int = 4) -> Path | None:
    """Download url to dest once. Returns None for a 404 (e.g. an ocean SRTM tile)."""
    key = dest.relative_to(RAW).as_posix()
    if dest.exists() and key in manifest and manifest[key]["sha256"] == _sha256(dest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=120) as response, open(dest.with_suffix(dest.suffix + ".part"), "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            dest.with_suffix(dest.suffix + ".part").replace(dest)
            manifest[key] = {
                "url": _redact(url),
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "bytes": dest.stat().st_size,
                "sha256": _sha256(dest),
            }
            return dest
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def acquire_firms(manifest: dict) -> None:
    for year in experiment()["years"]["all"]:
        url = f"https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{year}/viirs-snpp_{year}_United_States.csv"
        path = fetch(url, RAW / "firms" / f"viirs-snpp_{year}_United_States.csv", manifest)
        print(f"  FIRMS {year}: {'ok' if path else 'missing'}")


def acquire_fpa(manifest: dict) -> None:
    years = experiment()["years"]["all"]
    where = f"STATE='WA' AND FIRE_YEAR>={min(years)} AND FIRE_YEAR<={max(years)}"
    offset, page = 0, 0
    while True:
        params = urllib.parse.urlencode({
            "where": where, "outFields": ",".join(FPA_FIELDS), "returnGeometry": "false",
            "orderByFields": "objectid", "resultOffset": offset, "resultRecordCount": 2000, "f": "json",
        })
        path = fetch(f"{FPA_LAYER}?{params}", RAW / "fpa" / f"page_{page:03d}.json", manifest)
        rows = json.loads(path.read_text()).get("features", [])
        print(f"  FPA FOD page {page}: {len(rows)} records")
        if len(rows) < 2000:
            break
        offset += 2000
        page += 1


def power_points() -> list[tuple[float, float]]:
    """MERRA-2 grid centers (0.5 x 0.625 degrees) covering the study bounding box."""
    west, south, east, north = experiment()["geography"]["bbox"]
    lats = [round(-90 + 0.5 * i, 3) for i in range(int((south + 90) / 0.5) - 1, int((north + 90) / 0.5) + 2)]
    lons = [round(-180 + 0.625 * i, 4) for i in range(int((west + 180) / 0.625) - 1, int((east + 180) / 0.625) + 2)]
    return [(lat, lon) for lat in lats for lon in lons]


def acquire_power(manifest: dict) -> None:
    years = experiment()["years"]["all"]
    start, end = f"{min(years) - 1}1201", f"{max(years)}1231"
    points = power_points()
    for index, (lat, lon) in enumerate(points):
        params = urllib.parse.urlencode({
            "parameters": ",".join(POWER_PARAMS), "community": "AG", "latitude": lat, "longitude": lon,
            "start": start, "end": end, "format": "CSV", "header": "false",
        })
        fetch(f"https://power.larc.nasa.gov/api/temporal/daily/point?{params}", RAW / "power" / f"{lat}_{lon}.csv", manifest)
        if index % 25 == 0:
            print(f"  POWER {index + 1}/{len(points)}")


def acquire_srtm(manifest: dict) -> None:
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise SystemExit("EARTHDATA_TOKEN is not set (research/.env). SRTM elevation needs NASA Earthdata Login.")
    west, south, east, north = experiment()["geography"]["bbox"]
    found = 0
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            name = f"N{lat:02d}W{-lon:03d}"
            url = f"https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/SRTMGL3.003/{name}.SRTMGL3.hgt/{name}.SRTMGL3.hgt.zip"
            if fetch(url, RAW / "srtm" / f"{name}.hgt.zip", manifest, headers={"Authorization": f"Bearer {token}"}):
                found += 1
    print(f"  SRTM tiles: {found}")


def acquire_boundary(manifest: dict) -> None:
    fetch(CENSUS_STATES, RAW / "census" / "cb_2023_us_state_500k.zip", manifest)


def main() -> None:
    load_env()
    manifest = _load_manifest()
    steps = [("Census boundary", acquire_boundary), ("FPA FOD labels", acquire_fpa), ("FIRMS archives", acquire_firms),
             ("SRTM elevation", acquire_srtm), ("NASA POWER weather", acquire_power)]
    for label, step in steps:
        print(label)
        try:
            step(manifest)
        finally:
            _save_manifest(manifest)
    print(f"Raw manifest: {_manifest_path()}")


if __name__ == "__main__":
    main()
