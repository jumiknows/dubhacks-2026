"""FPA FOD records → cell-day labels with explicit exclusions.

reported-discovery: at least one record discovered in the cell on that local day.
no-record-in-reviewed-scope: every other cell-day in the grid and years.
Records without a usable day or point, or outside the gridded state, are excluded and counted.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .days import EPOCH, day_index, doy_to_date, n_days
from .config import RAW, experiment
from .grid import Grid


@dataclass
class Labels:
    records: pd.DataFrame  # one row per retained FPA FOD record with cell_idx and day
    positive: np.ndarray  # bool [n_days, n_cells]
    exclusions: dict


def load_records() -> pd.DataFrame:
    rows = []
    for page in sorted((RAW / "fpa").glob("page_*.json")):
        rows.extend(feature["attributes"] for feature in json.loads(page.read_text()).get("features", []))
    frame = pd.DataFrame(rows)
    frame.columns = [column.lower() for column in frame.columns]
    return frame


def build_labels(grid: Grid, records: pd.DataFrame | None = None) -> Labels:
    records = load_records() if records is None else records.copy()
    years = set(experiment()["years"]["all"])
    exclusions = {"total_records": int(len(records))}

    usable_day = records["discovery_doy"].notna() & records["fire_year"].isin(years)
    exclusions["missing_day_or_year_outside_scope"] = int((~usable_day).sum())
    records = records[usable_day]

    usable_point = records["latitude"].between(-90, 90) & records["longitude"].between(-180, 180)
    exclusions["missing_location"] = int((~usable_point).sum())
    records = records[usable_point].copy()

    records["date"] = [doy_to_date(y, d) for y, d in zip(records["fire_year"], records["discovery_doy"])]
    records["day"] = [day_index(value) for value in records["date"]]
    records["cell_idx"] = grid.locate(records["longitude"].to_numpy(), records["latitude"].to_numpy())
    outside = records["cell_idx"] < 0
    exclusions["outside_gridded_state"] = int(outside.sum())
    records = records[~outside]

    positive = np.zeros((n_days(), len(grid.cells)), dtype=bool)
    positive[records["day"].to_numpy(), records["cell_idx"].to_numpy()] = True
    exclusions["retained_records"] = int(len(records))
    exclusions["positive_cell_days"] = int(positive.sum())
    exclusions["records_sharing_a_cell_day"] = int(len(records) - positive.sum())
    exclusions["epoch"] = EPOCH.isoformat()
    return Labels(records=records.reset_index(drop=True), positive=positive, exclusions=exclusions)
