"""Offline checks for the properties that make the study valid: no future data in features,
no split overlap, no row seeing its own label, and correct budget metrics."""

import unittest
from datetime import date

import numpy as np
import pandas as pd

from wildfire import evaluate
from wildfire.days import day_index, doy_to_date, n_days
from wildfire.features import FeatureBuilder, history_rates
from wildfire.grid import Grid
from wildfire.labels import build_labels
from wildfire.splits import Split, check_disjoint


def tiny_grid() -> Grid:
    """3 x 3 cells, all inside the 'state'."""
    ix, iy = np.meshgrid(np.arange(3), np.arange(3), indexing="ij")
    cells = pd.DataFrame({
        "cell_idx": np.arange(9), "cell_id": [f"c{i}" for i in range(9)], "ix": ix.ravel(), "iy": iy.ravel(),
        "x": ix.ravel() * 10000.0, "y": iy.ravel() * 10000.0, "lon": -120 + ix.ravel() * 0.1, "lat": 47 + iy.ravel() * 0.1,
    })
    lookup = np.arange(9).reshape(3, 3)
    return Grid(cells=cells, size=10000, ix0=0, iy0=0, nx=3, ny=3, lookup=lookup)


def builder(grid: Grid, detections: list[tuple[int, int]]) -> FeatureBuilder:
    firms = pd.DataFrame({"day": [d for d, _ in detections], "cell_idx": [c for _, c in detections], "frp": [5.0] * len(detections)})
    days = n_days()
    values = {name: np.full((days, 1), value, dtype=np.float32) for name, value in
              {"T2M_MAX": 25, "T2M_MIN": 10, "RH2M": 40, "WS10M_MAX": 5, "PRECTOTCORR": 0, "GWETTOP": 0.4}.items()}
    terrain = pd.DataFrame({"elev_mean": np.ones(9), "elev_relief": np.ones(9), "slope_mean": np.ones(9)})
    return FeatureBuilder.build(grid, firms=firms, power={"points": [(47.0, -120.0)], "values": values}, terrain=terrain)


class FeatureAvailability(unittest.TestCase):
    def test_features_ignore_the_target_day_and_later(self):
        grid = tiny_grid()
        target = day_index(date(2018, 7, 10))
        base = builder(grid, [(target - 1, 4), (target - 5, 4)]).frame(np.array([target]), np.array([4]))
        with_future = builder(grid, [(target - 1, 4), (target - 5, 4), (target, 4), (target + 3, 4)]).frame(np.array([target]), np.array([4]))
        pd.testing.assert_frame_equal(base, with_future)
        self.assertEqual(base["det_1d"].iloc[0], 1)
        self.assertEqual(base["det_7d"].iloc[0], 2)
        self.assertEqual(base["days_since_det"].iloc[0], 1)

    def test_neighbourhood_counts_adjacent_cells(self):
        grid = tiny_grid()
        target = day_index(date(2018, 7, 10))
        frame = builder(grid, [(target - 2, 0), (target - 2, 8)]).frame(np.array([target]), np.array([4]))
        self.assertEqual(frame["det_3d"].iloc[0], 0)
        self.assertEqual(frame["det3x3_3d"].iloc[0], 2)

    def test_weather_uses_the_previous_day(self):
        grid = tiny_grid()
        fb = builder(grid, [])
        target = day_index(date(2018, 7, 10))
        fb.weather["tmax"][target, 0] = 99  # the target day itself must not appear
        self.assertEqual(fb.frame(np.array([target]), np.array([0]))["tmax"].iloc[0], 25)


class Labels(unittest.TestCase):
    def test_discovery_day_of_year_handles_leap_years(self):
        self.assertEqual(doy_to_date(2020, 60), date(2020, 2, 29))
        self.assertEqual(doy_to_date(2021, 60), date(2021, 3, 1))

    def test_exclusions_are_counted(self):
        class FakeGrid:
            cells = pd.DataFrame({"cell_idx": [0, 1]})

            def locate(self, lon, lat):
                return np.where(np.asarray(lon) < -130, -1, 0)

        records = pd.DataFrame({
            "fire_year": [2018, 2018, 2018, 2018, 2010],
            "discovery_doy": [190, 190, np.nan, 191, 100],
            "latitude": [47.0, 47.1, 47.0, 47.0, 47.0],
            "longitude": [-120.0, -120.1, -120.0, -140.0, -120.0],
        })
        labels = build_labels(FakeGrid(), records)
        self.assertEqual(labels.exclusions["missing_day_or_year_outside_scope"], 2)
        self.assertEqual(labels.exclusions["outside_gridded_state"], 1)
        self.assertEqual(labels.exclusions["positive_cell_days"], 1)
        self.assertEqual(labels.exclusions["records_sharing_a_cell_day"], 1)


class Leakage(unittest.TestCase):
    def test_history_rate_excludes_the_rows_own_year(self):
        grid = tiny_grid()
        positive = np.zeros((n_days(), 9), dtype=bool)
        positive[day_index(date(2014, 6, 1)), 0] = True  # only in 2014
        day = np.array([day_index(date(2014, 6, 1)), day_index(date(2015, 6, 1)), day_index(date(2023, 6, 1))])
        rate, _ = history_rates(grid, positive, [2013, 2014, 2015], day, np.zeros(3, dtype=int), np.array([2014, 2015, 2023]))
        self.assertEqual(rate[0], 0)  # 2014 row cannot see its own 2014 discovery
        self.assertGreater(rate[1], 0)
        self.assertGreater(rate[2], 0)

    def test_overlapping_splits_are_rejected(self):
        a = Split("a", np.array([1, 2]), np.array([0, 1]))
        b = Split("b", np.array([3]), np.array([0, 1]))
        splits = {"train": a, "validation": b, "test": Split("test", np.array([2, 9]), np.array([0])),
                  "transfer_train": a, "transfer_test": Split("t", np.array([9]), np.array([5]))}
        with self.assertRaises(ValueError):
            check_disjoint(splits)


class Metrics(unittest.TestCase):
    def test_budget_flags_top_cells_per_day(self):
        day = np.array([0, 0, 0, 1, 1, 1])
        score = np.array([0.1, 0.9, 0.5, 0.3, 0.2, 0.8])
        self.assertEqual(evaluate.budget_flags(day, score, 1).tolist(), [False, True, False, False, False, True])
        summary = evaluate.summarize(np.array([0, 1, 1, 0, 0, 1]), day, score, None, budget=1)
        self.assertAlmostEqual(summary["recall_at_budget"], 2 / 3)
        self.assertAlmostEqual(summary["precision_at_budget"], 1.0)


if __name__ == "__main__":
    unittest.main()


class WeatherGaps(unittest.TestCase):
    def test_unpublished_days_stay_missing(self):
        import tempfile
        from pathlib import Path

        from wildfire.features import load_power

        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "47.0_-120.0.csv").write_text(
                "YEAR,DOY,T2M_MAX\n2013,1,5.0\n2013,2,-999\n2013,3,7.0\n2013,4,-999\n2013,5,-999\n"
            )
            values = load_power(Path(folder))["values"]["T2M_MAX"][:, 0]
            start = day_index(date(2013, 1, 1))
            self.assertEqual(values[start + 1], 5.0)  # interior gap filled from the day before
            self.assertTrue(np.isnan(values[start + 3]))  # not yet published: stays missing


class ModelsSave(unittest.TestCase):
    def test_every_model_type_can_be_saved_and_reloaded(self):
        import io

        import joblib

        from wildfire import models

        cols = ["det_1d", "tmax"]
        X = pd.DataFrame({"det_1d": [0, 1, 2, 3, 0, 5] * 5, "tmax": [10, 20, 30, 25, 15, 35] * 5}, dtype=float)
        y = np.array([0, 0, 1, 1, 0, 1] * 5)
        for model in [models.logistic(cols, 1.0), models.knn(cols, 3), models.random_forest(1, "sqrt", 0), models.gradient_boosting(15, 0)]:
            model.fit(X, y)
            buffer = io.BytesIO()
            joblib.dump(model, buffer)
            buffer.seek(0)
            np.testing.assert_allclose(joblib.load(buffer).predict_proba(X), model.predict_proba(X))
