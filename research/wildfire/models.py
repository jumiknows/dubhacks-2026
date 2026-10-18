"""Candidate models. All fit on training rows, tuned and calibrated on validation rows only."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

COUNT_FEATURES = {"det_1d", "det_3d", "det_7d", "det_30d", "det3x3_3d", "det3x3_7d", "det5x5_7d", "frp_7d", "precip_1d", "precip_7d", "precip_30d", "hist_rate", "hist_rate3x3"}


def log_counts(X, index):
    """log1p on count-like columns. Module level so fitted pipelines can be saved."""
    X = np.array(X, dtype=np.float64, copy=True)
    X[:, index] = np.log1p(np.maximum(X[:, index], 0))
    return X


def _log_counts(columns: list[str]):
    index = [i for i, c in enumerate(columns) if c in COUNT_FEATURES]
    return FunctionTransformer(log_counts, kw_args={"index": index})


def random_forest(min_samples_leaf: int, max_features, seed: int):
    return RandomForestClassifier(
        n_estimators=300, min_samples_leaf=min_samples_leaf, max_features=max_features,
        max_depth=24, n_jobs=-1, random_state=seed,
    )


def gradient_boosting(max_leaf_nodes: int, seed: int):
    return HistGradientBoostingClassifier(learning_rate=0.05, max_iter=400, max_leaf_nodes=max_leaf_nodes, l2_regularization=1.0, random_state=seed)


def logistic(columns: list[str], C: float):
    return make_pipeline(_log_counts(columns), StandardScaler(), LogisticRegression(C=C, max_iter=2000))


def knn(columns: list[str], k: int):
    return make_pipeline(_log_counts(columns), StandardScaler(), KNeighborsClassifier(n_neighbors=k, weights="distance", n_jobs=-1))


def predict(model, X: pd.DataFrame, chunk: int = 200_000) -> np.ndarray:
    out = np.empty(len(X), dtype=np.float64)
    for start in range(0, len(X), chunk):
        out[start:start + chunk] = model.predict_proba(X.iloc[start:start + chunk])[:, 1]
    return out


class FrequencyBaseline:
    """Seasonal-regional frequency: discovery rate per 50 km block and month in training years."""

    def __init__(self, block_cells: int = 5):
        self.block = block_cells

    def fit(self, months: np.ndarray, ix: np.ndarray, iy: np.ndarray, y: np.ndarray, weight: np.ndarray):
        key = self._key(months, ix, iy)
        frame = pd.DataFrame({"key": key, "y": y * weight, "w": weight})
        grouped = frame.groupby("key")[["y", "w"]].sum()
        self.rates = (grouped["y"] / grouped["w"]).to_dict()
        self.default = float(frame["y"].sum() / frame["w"].sum())
        return self

    def score(self, months: np.ndarray, ix: np.ndarray, iy: np.ndarray) -> np.ndarray:
        return np.array([self.rates.get(k, self.default) for k in self._key(months, ix, iy)])

    def _key(self, months, ix, iy):
        return months * 1_000_000 + (np.asarray(ix) // self.block) * 1000 + np.asarray(iy) // self.block


def calibrate(validation_score: np.ndarray, validation_y: np.ndarray) -> IsotonicRegression:
    """Isotonic map from score to probability, fit on the natural validation population."""
    return IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(validation_score, validation_y)
