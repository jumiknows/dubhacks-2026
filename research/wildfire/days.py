"""Day axis shared by labels and features. Day 0 is EPOCH; targets start on 1 January of the first year."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from .config import experiment

EPOCH = date(2012, 12, 1)  # one month of history before the first target day


def day_index(value: date) -> int:
    return (value - EPOCH).days


def day_date(index: int) -> date:
    return EPOCH + timedelta(days=int(index))


def n_days(last: date | None = None) -> int:
    """Length of the day axis, through 31 December of the last study year or a later scoring date."""
    return day_index(last or date(max(experiment()["years"]["all"]), 12, 31)) + 1


def year_days(years: list[int]) -> np.ndarray:
    """Target day indices for whole calendar years."""
    out = []
    for year in years:
        start, end = day_index(date(year, 1, 1)), day_index(date(year, 12, 31))
        out.append(np.arange(start, end + 1))
    return np.concatenate(out) if out else np.array([], dtype=int)


def doy_to_date(year: int, doy: int) -> date:
    return date(int(year), 1, 1) + timedelta(days=int(doy) - 1)
