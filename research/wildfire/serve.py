"""Danger-zone scoring for the app.

    .venv/bin/python -m wildfire.serve train                 # fit, calibrate and test the serving model once
    .venv/bin/python -m wildfire.serve score 2026-10-10 2026-10-16   # write data/risk/<date>.json for a date range

The serving model uses only features a live feed can supply: thermal history of up to 7 days
(the public FIRMS feed covers 7 days), so the 30-day thermal features are left out. It has its
own test metrics. Every scored day records how complete its inputs were.
"""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

from . import evaluate, models
from .acquire import POWER_PARAMS, USER_AGENT, power_points
from .config import ARTIFACTS, RAW, RESULTS, ROOT, experiment, experiment_hash, load_env
from .days import day_date, day_index, n_days
from .features import ALL_FEATURES, FeatureBuilder, history_rates, load_firms, load_power, load_terrain
from .grid import TO_LONLAT, build_grid

SERVING_EXCLUDE = {"det_30d", "days_since_det"}
SERVING_FEATURES = [f for f in ALL_FEATURES if f not in SERVING_EXCLUDE]
THERMAL_DAYS_NEEDED = 7
MODEL_FILE = ARTIFACTS / "serving" / "model.joblib"
OUT = ROOT.parent / "data" / "risk"
PUBLIC_7D = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv"
TIERS = [("highest", 0.01), ("high", 0.05), ("elevated", 0.20)]


def log(message: str) -> None:
    print(message, flush=True)


# --- training -----------------------------------------------------------------------------

def train() -> None:
    from .run import Data

    exp = experiment()
    seed, ratio, budget = exp["negative_sampling"]["seed"], exp["negative_sampling"]["train_ratio"], exp["review_budget_cells_per_day"]
    metrics_file = RESULTS / exp["id"] / "metrics.json"
    params = json.loads(metrics_file.read_text())["models"]["random_forest"]["params"] if metrics_file.exists() else {"min_samples_leaf": 30, "max_features": "sqrt"}
    data = Data()
    d_tr, c_tr, y_tr, w_tr = data.rows("train", ratio, seed)
    d_va, c_va, y_va, _ = data.rows("validation")
    d_te, c_te, y_te, _ = data.rows("test")
    X_tr = data.X(d_tr, c_tr)[SERVING_FEATURES]
    log(f"fitting serving forest {params} on {len(y_tr)} rows")
    model = models.random_forest(params["min_samples_leaf"], params["max_features"], seed).fit(X_tr, y_tr, sample_weight=w_tr)
    calibrator = models.calibrate(models.predict(model, data.X(d_va, c_va)[SERVING_FEATURES]), y_va)
    score = models.predict(model, data.X(d_te, c_te)[SERVING_FEATURES])
    test = evaluate.summarize(y_te, d_te, score, calibrator.predict(score), budget) | evaluate.bootstrap(y_te, d_te, score, budget)
    log(f"serving model test: PR-AUC {test['pr_auc']:.4f}, recall@{budget} {test['recall_at_budget']:.3f}")

    # Training-year discovery counts per cell, for the history features at scoring time.
    from .days import year_days

    train_days = year_days(exp["years"]["train"])
    history = {"counts": data.labels.positive[train_days].sum(axis=0), "days": len(train_days)}
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "calibrator": calibrator, "features": SERVING_FEATURES, "params": params,
                 "history": history, "experiment_sha256": experiment_hash(), "test": test}, MODEL_FILE)
    summary = {
        "experiment": exp["id"], "experiment_sha256": experiment_hash(), "features": SERVING_FEATURES,
        "excluded": sorted(SERVING_EXCLUDE), "params": params, "trained_years": exp["years"]["train"],
        "calibrated_on": exp["years"]["validation"], "test_years": exp["years"]["test"], "test": test,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (RESULTS / exp["id"] / "serving.json").write_text(json.dumps(summary, indent=2))
    log(f"saved {MODEL_FILE}")


# --- inputs for arbitrary dates ------------------------------------------------------------

def _get(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())
    return dest


def thermal_inputs(first: date, last: date, cache: Path) -> tuple[list[Path], set[date], list[dict]]:
    """FIRMS VIIRS S-NPP files covering UTC dates first..last, from the best available source."""
    files, covered, sources = [], set(), []
    for year in range(first.year, last.year + 1):
        archive = RAW / "firms" / f"viirs-snpp_{year}_United_States.csv"
        if archive.exists():
            files.append(archive)
            days = pd.date_range(max(first, date(year, 1, 1)), min(last, date(year, 12, 31))).date
            covered.update(days)
            sources.append({"source": "FIRMS yearly archive", "file": archive.name})
    missing = [d for d in pd.date_range(first, last).date if d not in covered]
    key = os.environ.get("FIRMS_MAP_KEY")
    if missing and key:
        west, south, east, north = experiment()["geography"]["bbox"]
        start = min(missing)
        while start <= max(missing):
            span = min(5, (max(missing) - start).days + 1)
            url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{west},{south},{east},{north}/{span}/{start.isoformat()}"
            files.append(_get(url, cache / f"area_{start.isoformat()}_{span}.csv"))
            covered.update(pd.date_range(start, periods=span).date)
            start += timedelta(days=span)
        sources.append({"source": "FIRMS Area API (VIIRS_SNPP_NRT)"})
    missing = [d for d in pd.date_range(first, last).date if d not in covered]
    if missing:
        path = _get(PUBLIC_7D, cache / f"public_7d_{datetime.now(timezone.utc):%Y%m%dT%H}.csv")
        dates = pd.to_datetime(pd.read_csv(path, usecols=["acq_date"])["acq_date"]).dt.date
        files.append(path)
        covered.update(pd.date_range(dates.min(), dates.max()).date)
        sources.append({"source": "FIRMS public 7-day feed", "from": str(dates.min()), "to": str(dates.max()),
                        "sha256": __import__("hashlib").sha256(path.read_bytes()).hexdigest()})
    return files, covered, sources


def weather_inputs(first: date, last: date) -> Path:
    folder = ARTIFACTS / "serving" / "power" / f"{first:%Y%m%d}_{last:%Y%m%d}"
    for lat, lon in power_points():
        path = folder / f"{lat}_{lon}.csv"
        if path.exists():
            continue
        params = urllib.parse.urlencode({"parameters": ",".join(POWER_PARAMS), "community": "AG", "latitude": lat, "longitude": lon,
                                         "start": f"{first:%Y%m%d}", "end": f"{last:%Y%m%d}", "format": "CSV", "header": "false"})
        _get(f"https://power.larc.nasa.gov/api/temporal/daily/point?{params}", path)
    return folder


# --- scoring --------------------------------------------------------------------------------

PLAIN = {
    "doy_sin": "time of year", "doy_cos": "time of year", "weekend": "weekend", "july4_window": "Independence Day week",
    "elev_mean": "elevation", "elev_relief": "terrain relief", "slope_mean": "slope", "lat": "location", "lon": "location",
    "det_1d": "satellite heat in the cell yesterday", "det_3d": "satellite heat in the cell, last 3 days",
    "det_7d": "satellite heat in the cell, last 7 days", "det3x3_3d": "satellite heat within 10 km, last 3 days",
    "det3x3_7d": "satellite heat within 10 km, last 7 days", "det5x5_7d": "satellite heat within 20 km, last 7 days",
    "frp_7d": "fire radiative power, last 7 days", "tmax": "yesterday's high temperature", "tmin": "yesterday's low temperature",
    "rh": "yesterday's humidity", "vpd": "yesterday's air dryness (vapour-pressure deficit)", "wind_max": "yesterday's peak wind",
    "precip_1d": "yesterday's rain", "precip_7d": "rain in the last 7 days", "precip_30d": "rain in the last 30 days",
    "dry_days": "days since meaningful rain", "soil_wet": "topsoil wetness", "tmax_7d": "7-day average high temperature",
    "hist_rate": "past recorded discoveries in this cell", "hist_rate3x3": "past recorded discoveries nearby",
}


def score(first: date, last: date) -> None:
    load_env()
    bundle = joblib.load(MODEL_FILE)
    exp = experiment()
    grid = build_grid()
    cells = np.arange(len(grid.cells))
    days = n_days(last)
    cache = ARTIFACTS / "serving" / "firms"

    # Inputs: 7 days of thermal history and 31 days of weather before each target day.
    thermal_first, weather_first = first - timedelta(days=THERMAL_DAYS_NEEDED + 1), first - timedelta(days=35)
    files, covered, thermal_sources = thermal_inputs(thermal_first, last, cache)
    firms = load_firms(grid, files, days)
    firms = firms.drop_duplicates(subset=["day", "cell_idx", "frp"]) if len(firms) else firms
    power = load_power(weather_inputs(weather_first, last - timedelta(days=1)), days)
    builder = FeatureBuilder.build(grid, firms=firms, power=power, terrain=load_terrain(grid), days=days)

    counts, history_days = bundle["history"]["counts"], bundle["history"]["days"]
    explainer = shap.TreeExplainer(bundle["model"])
    OUT.mkdir(parents=True, exist_ok=True)
    write_grid(grid)
    index = json.loads((OUT / "index.json").read_text()) if (OUT / "index.json").exists() else {"dates": {}}

    for target in pd.date_range(first, last).date:
        d = day_index(target)
        prior = [target - timedelta(days=k) for k in range(1, THERMAL_DAYS_NEEDED + 1)]
        # A Pacific day spans two UTC dates, so both must be covered.
        thermal_days = sum(1 for p in prior if p in covered and (p + timedelta(days=1)) in covered)
        weather_ok = not np.isnan(power["values"]["T2M_MAX"][d - 1]).any()
        status = "unavailable" if not weather_ok else ("complete" if thermal_days == THERMAL_DAYS_NEEDED else "partial")
        entry = {
            "date": target.isoformat(), "status": status,
            "coverage": {"thermalDays": thermal_days, "thermalDaysNeeded": THERMAL_DAYS_NEEDED, "weatherForPreviousDay": weather_ok},
        }
        if status == "unavailable":
            log(f"{target}: weather for the previous day is not published yet, not scored")
            index["dates"][target.isoformat()] = entry
            (OUT / f"{target.isoformat()}.json").unlink(missing_ok=True)
            continue
        day = np.full(len(cells), d)
        rate = counts / history_days * 1000
        raster = np.zeros((grid.nx, grid.ny))
        raster[grid.cells["ix"], grid.cells["iy"]] = counts
        from .features import _box_sum

        rate3 = _box_sum(raster[None], 1)[0, grid.cells["ix"], grid.cells["iy"]] / history_days * 1000
        X = builder.frame(day, cells, (rate, rate3))[bundle["features"]]
        raw = models.predict(bundle["model"], X)
        probability = bundle["calibrator"].predict(raw)
        order = np.argsort(-raw, kind="stable")
        rank = np.empty(len(cells), dtype=int)
        rank[order] = np.arange(1, len(cells) + 1)
        values = explainer.shap_values(X, check_additivity=False)
        values = values[:, :, 1] if values.ndim == 3 else values[1]
        top = []
        for i in range(len(cells)):
            best = np.argsort(-np.abs(values[i]))[:3]
            top.append([[bundle["features"][j], round(float(X.iloc[i, j]), 3), round(float(values[i, j]), 5)] for j in best])
        tiers = []
        for r in rank:
            share = r / len(cells)
            tiers.append(next((name for name, cut in TIERS if share <= cut), "low"))
        payload = {
            **entry,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataThrough": (target - timedelta(days=1)).isoformat(),
            "thermalSources": thermal_sources,
            "model": {"experiment": exp["id"], "experimentSha256": bundle["experiment_sha256"]},
            "cells": {"probability": [round(float(p), 5) for p in probability], "rank": rank.tolist(), "tier": tiers, "top": top},
        }
        (OUT / f"{target.isoformat()}.json").write_text(json.dumps(payload, separators=(",", ":")))
        index["dates"][target.isoformat()] = entry
        log(f"{target}: {status}, thermal {thermal_days}/{THERMAL_DAYS_NEEDED} days, top cell {grid.cells['cell_id'].iloc[order[0]]} p={probability[order[0]]:.4f}")

    test = bundle["test"]
    index.update({
        "experiment": exp["id"],
        "label": "Research ranking of where a wildfire discovery is most likely to be recorded next",
        "framing": exp["framing"],
        "model": {"algorithm": "Random Forest", "params": bundle["params"], "features": bundle["features"],
                  "trainedYears": exp["years"]["train"], "calibratedOn": exp["years"]["validation"]},
        "test": {"years": exp["years"]["test"], "prAuc": test["pr_auc"], "prevalence": test["prevalence"],
                 "recallAtBudget": test["recall_at_budget"], "budgetCellsPerDay": exp["review_budget_cells_per_day"],
                 "recallAtBudget95ci": test["recall_at_budget_95ci"]},
        "tiers": {name: f"top {int(cut * 100)}% of cells that day" for name, cut in TIERS},
        "plainLanguage": PLAIN,
    })
    index["dates"] = dict(sorted(index["dates"].items()))
    (OUT / "index.json").write_text(json.dumps(index, indent=2))


def write_grid(grid) -> None:
    half = grid.size / 2
    polygons = []
    for x, y in zip(grid.cells["x"], grid.cells["y"]):
        xs = [x - half, x + half, x + half, x - half, x - half]
        ys = [y - half, y - half, y + half, y + half, y - half]
        lon, lat = TO_LONLAT.transform(xs, ys)
        polygons.append([[round(a, 5), round(b, 5)] for a, b in zip(lon, lat)])
    places = json.loads((ROOT.parent / "data" / "places" / "wa-communities.json").read_text())["places"]
    located = grid.locate(np.array([p["longitude"] for p in places]), np.array([p["latitude"] for p in places]))
    payload = {
        "crs": "EPSG:5070 cells, corners in WGS84", "cellSizeM": grid.size,
        "cellIds": grid.cells["cell_id"].tolist(), "polygons": polygons,
        "placeCells": {p["id"]: int(c) for p, c in zip(places, located) if c >= 0},
    }
    (OUT / "grid.json").write_text(json.dumps(payload, separators=(",", ":")))


def main(argv: list[str]) -> None:
    if argv[:1] == ["train"]:
        train()
    elif argv[:1] == ["score"] and len(argv) >= 2:
        first = date.fromisoformat(argv[1])
        last = date.fromisoformat(argv[2]) if len(argv) > 2 else first
        score(first, last)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
