"""Metrics for a rare outcome: PR-AUC with prevalence, recall and precision at a daily review budget,
Brier score, reliability, false positives per 1,000 cell-days, and week-block bootstrap intervals."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss


def budget_flags(day: np.ndarray, score: np.ndarray, budget: int) -> np.ndarray:
    """True for the top `budget` cells of each day (ties broken by row order)."""
    order = np.lexsort((-score, day))
    sorted_day = day[order]
    starts = np.r_[0, np.flatnonzero(np.diff(sorted_day)) + 1]
    rank = np.arange(len(order)) - np.repeat(starts, np.diff(np.r_[starts, len(order)]))
    flags = np.zeros(len(day), dtype=bool)
    flags[order[rank < budget]] = True
    return flags


def summarize(y: np.ndarray, day: np.ndarray, score: np.ndarray, probability: np.ndarray | None, budget: int) -> dict:
    y = y.astype(bool)
    flags = budget_flags(day, score, budget)
    positives = int(y.sum())
    out = {
        "rows": int(len(y)),
        "positives": positives,
        "prevalence": float(y.mean()),
        "pr_auc": float(average_precision_score(y, score)) if positives else None,
        "recall_at_budget": float((flags & y).sum() / positives) if positives else None,
        "precision_at_budget": float((flags & y).sum() / flags.sum()) if flags.sum() else None,
        "false_positives_per_1000_cell_days": float((flags & ~y).sum() / len(y) * 1000),
    }
    if probability is not None:
        out["brier"] = float(brier_score_loss(y, probability))
        out["brier_reference_prevalence"] = float(brier_score_loss(y, np.full(len(y), y.mean())))
    return out


def bootstrap(y: np.ndarray, day: np.ndarray, score: np.ndarray, budget: int, n: int = 200, seed: int = 29) -> dict:
    """95% intervals from resampling whole weeks, so correlated days stay together."""
    rng = np.random.default_rng(seed)
    week = (day - day.min()) // 7
    weeks = np.unique(week)
    by_week = {w: np.flatnonzero(week == w) for w in weeks}
    flags = budget_flags(day, score, budget)
    pr, rec = [], []
    for _ in range(n):
        idx = np.concatenate([by_week[w] for w in rng.choice(weeks, size=len(weeks), replace=True)])
        yy = y[idx].astype(bool)
        if yy.sum() == 0:
            continue
        pr.append(average_precision_score(yy, score[idx]))
        rec.append((flags[idx] & yy).sum() / yy.sum())
    q = lambda values: [float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))]
    return {"pr_auc_95ci": q(pr), "recall_at_budget_95ci": q(rec), "resamples": len(pr), "unit": "calendar week"}


def reliability(y: np.ndarray, probability: np.ndarray, bins: int = 10) -> list[dict]:
    """Observed rate per predicted-probability quantile bin."""
    order = np.argsort(probability)
    out = []
    for chunk in np.array_split(order, bins):
        out.append({"mean_predicted": float(probability[chunk].mean()), "observed": float(y[chunk].mean()), "rows": int(len(chunk))})
    return out
