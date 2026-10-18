"""Temporal and spatial splits with an automatic overlap check and a hashed manifest."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from .config import experiment
from .days import year_days
from .grid import Grid


@dataclass
class Split:
    name: str
    days: np.ndarray
    cells: np.ndarray

    def rows(self) -> tuple[np.ndarray, np.ndarray]:
        day = np.repeat(self.days, len(self.cells))
        cell = np.tile(self.cells, len(self.days))
        return day, cell


def holdout_cells(grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """(holdout region cells, buffer cells around it). Buffer cells are excluded from transfer training."""
    rule = experiment()["spatial_holdout"]
    cells = grid.cells
    region = (cells["lon"] > rule["lon_min"]) & (cells["lat"] > rule["lat_min"])
    held = set(zip(cells["ix"][region], cells["iy"][region]))
    b = rule["buffer_cells"]
    near = np.array([
        not r and any((i + dx, j + dy) in held for dx in range(-b, b + 1) for dy in range(-b, b + 1))
        for i, j, r in zip(cells["ix"], cells["iy"], region)
    ])
    return np.flatnonzero(region.to_numpy()), np.flatnonzero(near)


def make_splits(grid: Grid) -> dict[str, Split]:
    years = experiment()["years"]
    every = grid.cells["cell_idx"].to_numpy()
    held, buffer = holdout_cells(grid)
    transfer_train = np.setdiff1d(every, np.concatenate([held, buffer]))
    splits = {
        "train": Split("train", year_days(years["train"]), every),
        "validation": Split("validation", year_days(years["validation"]), every),
        "test": Split("test", year_days(years["test"]), every),
        "transfer_train": Split("transfer_train", year_days(years["train"]), transfer_train),
        "transfer_validation": Split("transfer_validation", year_days(years["validation"]), transfer_train),
        "transfer_test": Split("transfer_test", year_days(years["test"]), held),
    }
    check_disjoint(splits)
    return splits


def check_disjoint(splits: dict[str, Split]) -> None:
    """Reject any overlap between rows used to fit, tune and test."""
    for a, b in [("train", "validation"), ("train", "test"), ("validation", "test")]:
        if np.intersect1d(splits[a].days, splits[b].days).size:
            raise ValueError(f"Split overlap in days: {a} and {b}")
    if np.intersect1d(splits["transfer_train"].cells, splits["transfer_test"].cells).size:
        raise ValueError("Transfer training cells overlap the held-out region")
    if np.intersect1d(splits["transfer_train"].days, splits["transfer_test"].days).size:
        raise ValueError("Transfer training days overlap transfer test days")


def manifest(splits: dict[str, Split], positive: np.ndarray, cell_ids: np.ndarray) -> dict:
    out = {}
    for name, split in splits.items():
        day, cell = split.rows()
        digest = hashlib.sha256()
        digest.update(np.ascontiguousarray(split.days, dtype=np.int32).tobytes())
        digest.update("|".join(cell_ids[split.cells]).encode())
        out[name] = {
            "days": int(len(split.days)),
            "cells": int(len(split.cells)),
            "rows": int(len(day)),
            "positives": int(positive[day, cell].sum()),
            "row_hash_sha256": digest.hexdigest(),
        }
    return out
