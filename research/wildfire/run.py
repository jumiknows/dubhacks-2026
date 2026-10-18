"""End to end: grid → labels → features → splits → fit and tune → calibrate → one test evaluation → SHAP → report.

    cd research && .venv/bin/python -m wildfire.run
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import precision_recall_curve  # noqa: E402

from . import evaluate, explain, models  # noqa: E402
from .config import RAW, RESULTS, RUNS, experiment, experiment_hash  # noqa: E402
from .days import day_date, year_days  # noqa: E402
from .features import ALL_FEATURES, AVAILABILITY, GROUPS, FeatureBuilder, history_rates  # noqa: E402
from .grid import build_grid  # noqa: E402
from .labels import build_labels  # noqa: E402
from .splits import make_splits, manifest  # noqa: E402

T0 = time.time()


def log(message: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {message}", flush=True)


def year_of(day: np.ndarray) -> np.ndarray:
    years = {d: day_date(d).year for d in np.unique(day)}
    return np.array([years[d] for d in day])


class Data:
    def __init__(self):
        self.exp = experiment()
        self.grid = build_grid()
        log(f"grid: {len(self.grid.cells)} cells of {self.exp['grid']['cell_m'] // 1000} km")
        self.labels = build_labels(self.grid)
        log(f"labels: {self.labels.exclusions}")
        self.features = FeatureBuilder.build(self.grid)
        log(f"features ready ({self.features.firms_stats['detections_in_grid']} FIRMS detections in the grid)")
        self.splits = make_splits(self.grid)

    def rows(self, split: str, negatives_per_positive: int | None = None, seed: int = 29):
        """(day, cell, y, weight). Optionally keep every positive and a weighted sample of negatives."""
        day, cell = self.splits[split].rows()
        y = self.labels.positive[day, cell]
        weight = np.ones(len(day))
        if negatives_per_positive:
            rng = np.random.default_rng(seed)
            neg = np.flatnonzero(~y)
            take = rng.choice(neg, size=min(len(neg), negatives_per_positive * int(y.sum())), replace=False)
            keep = np.sort(np.concatenate([np.flatnonzero(y), take]))
            weight = np.where(y, 1.0, len(neg) / len(take))[keep]
            day, cell, y = day[keep], cell[keep], y[keep]
        return day, cell, y.astype(np.int8), weight

    def X(self, day, cell, with_history: bool = True) -> pd.DataFrame:
        history = None
        if with_history:
            history = history_rates(self.grid, self.labels.positive, self.exp["years"]["train"], day, cell, year_of(day))
        frame = self.features.frame(day, cell, history)
        return frame


def fit_best(name, candidates, X_train, y_train, w_train, X_val, y_val, day_val, budget, supports_weight=True):
    best = None
    for params, factory in candidates:
        model = factory()
        start = time.time()
        if supports_weight:
            if hasattr(model, "steps"):
                model.fit(X_train, y_train, **{f"{model.steps[-1][0]}__sample_weight": w_train})
            else:
                model.fit(X_train, y_train, sample_weight=w_train)
        else:
            model.fit(X_train, y_train)
        # Neighbour search holds k distances per row, so it predicts in small chunks.
        score = models.predict(model, X_val, chunk=20_000 if name == "knn" else 200_000)
        metrics = evaluate.summarize(y_val, day_val, score, None, budget)
        log(f"  {name} {params}: validation PR-AUC {metrics['pr_auc']:.4f}, recall@budget {metrics['recall_at_budget']:.3f} ({time.time() - start:.0f}s)")
        if best is None or metrics["pr_auc"] > best["validation"]["pr_auc"]:
            best = {"model": model, "params": params, "validation": metrics, "validation_score": score}
    return best


def main() -> None:
    exp = experiment()
    budget = exp["review_budget_cells_per_day"]
    seed = exp["negative_sampling"]["seed"]
    ratio = exp["negative_sampling"]["train_ratio"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = RUNS / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    out_dir = RESULTS / exp["id"]
    figures = out_dir / "figures"
    figures.mkdir(parents=True, exist_ok=True)

    data = Data()
    split_manifest = manifest(data.splits, data.labels.positive, data.grid.cells["cell_id"].to_numpy())
    audit = {str(y): int(data.labels.positive[year_days([y])].sum()) for y in exp["years"]["all"]}
    log(f"adequacy audit, positive cell-days per year: {audit}")

    # --- design matrices ------------------------------------------------------------
    d_tr, c_tr, y_tr, w_tr = data.rows("train", ratio, seed)
    X_tr = data.X(d_tr, c_tr)
    d_va, c_va, y_va, _ = data.rows("validation")
    X_va = data.X(d_va, c_va)
    d_te, c_te, y_te, _ = data.rows("test")
    X_te = data.X(d_te, c_te)
    log(f"rows: train sample {len(y_tr)} ({int(y_tr.sum())} positive), validation {len(y_va)}, test {len(y_te)}")

    # --- candidates, tuned on validation ---------------------------------------------
    cols = list(X_tr.columns)
    fitted = {}
    log("random forest")
    fitted["random_forest"] = fit_best("rf", [
        ({"min_samples_leaf": 10, "max_features": "sqrt"}, lambda: models.random_forest(10, "sqrt", seed)),
        ({"min_samples_leaf": 30, "max_features": "sqrt"}, lambda: models.random_forest(30, "sqrt", seed)),
        ({"min_samples_leaf": 30, "max_features": 0.33}, lambda: models.random_forest(30, 0.33, seed)),
    ], X_tr, y_tr, w_tr, X_va, y_va, d_va, budget)
    log("gradient boosting")
    fitted["gradient_boosting"] = fit_best("hgb", [
        ({"max_leaf_nodes": 31}, lambda: models.gradient_boosting(31, seed)),
        ({"max_leaf_nodes": 63}, lambda: models.gradient_boosting(63, seed)),
    ], X_tr, y_tr, w_tr, X_va, y_va, d_va, budget)
    log("logistic regression")
    fitted["logistic_regression"] = fit_best("lr", [
        ({"C": c}, (lambda c=c: models.logistic(cols, c))) for c in (0.01, 0.1, 1.0)
    ], X_tr, y_tr, w_tr, X_va, y_va, d_va, budget)

    # Nearest neighbours: fewer, stronger dimensions chosen from training-time forest importance.
    rf = fitted["random_forest"]["model"]
    knn_cols = list(pd.Series(rf.feature_importances_, index=cols).sort_values(ascending=False).head(12).index)
    d_kn, c_kn, y_kn, _ = data.rows("train", 10, seed)
    X_kn = data.X(d_kn, c_kn)[knn_cols]
    log(f"nearest neighbours on {knn_cols}")
    fitted["nearest_neighbors"] = fit_best("knn", [
        ({"k": k, "features": knn_cols}, (lambda k=k: models.knn(knn_cols, k))) for k in (50, 100)
    ], X_kn, y_kn, None, X_va[knn_cols], y_va, d_va, budget, supports_weight=False)

    log("frequency baseline")
    months_tr = pd.to_datetime([day_date(d) for d in d_tr]).month.to_numpy()
    ix, iy = data.grid.cells["ix"].to_numpy(), data.grid.cells["iy"].to_numpy()
    base = models.FrequencyBaseline().fit(months_tr, ix[c_tr], iy[c_tr], y_tr, w_tr)
    months_va = pd.to_datetime([day_date(d) for d in d_va]).month.to_numpy()
    base_va = base.score(months_va, ix[c_va], iy[c_va])
    fitted["frequency_baseline"] = {"model": base, "params": {"block_km": 50}, "validation": evaluate.summarize(y_va, d_va, base_va, None, budget), "validation_score": base_va}

    # --- calibrate on validation, then evaluate the frozen test once -----------------
    months_te = pd.to_datetime([day_date(d) for d in d_te]).month.to_numpy()
    results, test_scores = {}, {}
    for name, item in fitted.items():
        calibrator = models.calibrate(item["validation_score"], y_va)
        if name == "frequency_baseline":
            score = item["model"].score(months_te, ix[c_te], iy[c_te])
        elif name == "nearest_neighbors":
            score = models.predict(item["model"], X_te[knn_cols], chunk=20_000)
        else:
            score = models.predict(item["model"], X_te)
        probability = calibrator.predict(score)
        test_scores[name] = score
        results[name] = {
            "params": item["params"],
            "validation": item["validation"],
            "test": evaluate.summarize(y_te, d_te, score, probability, budget),
            "test_intervals": evaluate.bootstrap(y_te, d_te, score, budget),
            "test_reliability": evaluate.reliability(y_te, probability),
        }
        log(f"TEST {name}: PR-AUC {results[name]['test']['pr_auc']:.4f} recall@{budget} {results[name]['test']['recall_at_budget']:.3f}")
        joblib.dump({"model": item["model"], "calibrator": calibrator}, run_dir / f"{name}.joblib")

    # Slices for the Random Forest
    rf_score = test_scores["random_forest"]
    lon_te = data.grid.cells["lon"].to_numpy()[c_te]
    slices = {}
    for label, mask in {
        "year_2023": year_of(d_te) == 2023,
        "year_2024": year_of(d_te) == 2024,
        "fire_season_jun_sep": np.isin(months_te, [6, 7, 8, 9]),
        "off_season": ~np.isin(months_te, [6, 7, 8, 9]),
        "west_of_cascades": lon_te < -121.0,
        "east_of_cascades": lon_te >= -121.0,
        "no_prior_detection_7d_3x3": X_te["det3x3_7d"].to_numpy() == 0,
        "prior_detection_7d_3x3": X_te["det3x3_7d"].to_numpy() > 0,
    }.items():
        slices[label] = evaluate.summarize(y_te[mask], d_te[mask], rf_score[mask], None, budget)
    results["random_forest"]["test_slices"] = slices

    # --- feature-set ablation (same forest settings) -----------------------------------
    log("ablation")
    best_rf = fitted["random_forest"]["params"]
    ablation = {}
    sets = {
        "season+terrain+history": GROUPS["season"] + GROUPS["terrain"] + GROUPS["history"],
        "+thermal": GROUPS["season"] + GROUPS["terrain"] + GROUPS["history"] + GROUPS["thermal"],
        "+weather": GROUPS["season"] + GROUPS["terrain"] + GROUPS["history"] + GROUPS["weather"],
        "all": ALL_FEATURES,
    }
    for label, names in sets.items():
        model = models.random_forest(best_rf["min_samples_leaf"], best_rf["max_features"], seed).fit(X_tr[names], y_tr, sample_weight=w_tr)
        score = models.predict(model, X_te[names])
        ablation[label] = evaluate.summarize(y_te, d_te, score, None, budget) | evaluate.bootstrap(y_te, d_te, score, budget, n=100)
        log(f"  {label}: PR-AUC {ablation[label]['pr_auc']:.4f}")

    # --- spatial transfer: a region the model never trained on (no history features) ---
    log("spatial transfer")
    no_hist = [f for f in ALL_FEATURES if f not in GROUPS["history"]]
    d_a, c_a, y_a, w_a = data.rows("transfer_train", ratio, seed)
    X_a = data.X(d_a, c_a, with_history=False)[no_hist]
    transfer_model = models.random_forest(best_rf["min_samples_leaf"], best_rf["max_features"], seed).fit(X_a, y_a, sample_weight=w_a)
    d_h, c_h, y_h, _ = data.rows("transfer_test")
    X_h = data.X(d_h, c_h, with_history=False)[no_hist]
    in_region = np.isin(c_te, data.splits["transfer_test"].cells)
    transfer = {
        "held_out_region_model": evaluate.summarize(y_h, d_h, models.predict(transfer_model, X_h), None, budget),
        "model_trained_with_region": evaluate.summarize(y_te[in_region], d_te[in_region], rf_score[in_region], None, budget),
        "note": "The held-out model never saw the region and uses no history features. Budget is the same 20 cells per day, applied within the region.",
    }
    log(f"  transfer PR-AUC {transfer['held_out_region_model']['pr_auc']:.4f} vs in-region {transfer['model_trained_with_region']['pr_auc']:.4f}")

    # --- explanations -------------------------------------------------------------------
    log("SHAP")
    rng = np.random.default_rng(seed)
    pos = np.flatnonzero(y_te == 1)
    neg = rng.choice(np.flatnonzero(y_te == 0), size=1500, replace=False)
    sample = np.concatenate([rng.choice(pos, size=min(1500, len(pos)), replace=False), neg])
    shap_out = explain.shap_forest(rf, X_te.iloc[sample], figures)
    top = sample[np.argmax(rf_score[sample] * (y_te[sample] == 1))]
    top_position = int(np.flatnonzero(sample == top)[0])
    example = {
        "cell_id": data.grid.cells["cell_id"].iloc[c_te[top]],
        "date": day_date(d_te[top]).isoformat(),
        "score": float(rf_score[top]),
        "contributions": dict(sorted(((c, float(v)) for c, v in zip(cols, shap_out["values"][top_position])), key=lambda kv: -abs(kv[1]))[:8]),
        "feature_values": {c: float(X_te.iloc[top][c]) for c in cols},
    }
    log("kNN permutation importance")
    sub = rng.choice(len(y_va), size=60_000, replace=False)
    sub = np.unique(np.concatenate([sub, np.flatnonzero(y_va == 1)]))
    knn_importance = explain.knn_permutation(fitted["nearest_neighbors"]["model"], X_va[knn_cols].iloc[sub], y_va[sub])

    # --- figures ----------------------------------------------------------------------------
    plot_pr(y_te, test_scores, figures / "pr_curves.png")
    plot_reliability(results, figures / "reliability.png")
    plot_budget(results, ablation, figures / "recall_at_budget.png", budget)
    plot_map(data, c_te, d_te, y_te, rf_score, figures / "map_2024_season.png")

    # --- write ------------------------------------------------------------------------------
    metrics = {
        "experiment": exp["id"],
        "experiment_sha256": experiment_hash(),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "framing": exp["framing"],
        "review_budget_cells_per_day": budget,
        "adequacy_audit_positive_cell_days": audit,
        "label_exclusions": data.labels.exclusions,
        "models": results,
        "ablation_random_forest": ablation,
        "spatial_transfer": transfer,
        "shap": {"mean_abs_shap": shap_out["mean_abs_shap"], "base_value": shap_out["base_value"], "rows": int(len(sample)), "example": example},
        "knn_permutation_importance": knn_importance,
        "decision_gate": exp["decision_gate"],
        "runtime_seconds": round(time.time() - T0),
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out_dir / "split-manifest.json").write_text(json.dumps({"experiment_sha256": experiment_hash(), "splits": split_manifest}, indent=2))
    (out_dir / "feature-availability.json").write_text(json.dumps({
        "rule": exp["date_convention"],
        "groups": {g: {"features": GROUPS[g], "availability": AVAILABILITY[g]} for g in GROUPS},
    }, indent=2))
    raw_manifest = json.loads((RAW / "manifest.json").read_text())
    (out_dir / "sources.json").write_text(json.dumps({"files": len(raw_manifest), "bytes": sum(v["bytes"] for v in raw_manifest.values()), "sha256": {k: v["sha256"] for k, v in sorted(raw_manifest.items())}}, indent=2))
    pd.DataFrame({"day": d_te, "cell_idx": c_te, "y": y_te, **{f"score_{k}": v for k, v in test_scores.items()}}).to_parquet(run_dir / "test_predictions.parquet")
    log(f"done: {out_dir}")


# --- plots ------------------------------------------------------------------------------------

LABELS = {"random_forest": "Random Forest", "gradient_boosting": "Gradient boosting", "logistic_regression": "Logistic regression",
          "nearest_neighbors": "Nearest neighbours", "frequency_baseline": "Frequency baseline"}


def plot_pr(y, scores, path):
    plt.figure(figsize=(6.5, 5))
    for name, score in scores.items():
        precision, recall, _ = precision_recall_curve(y, score)
        plt.plot(recall, precision, label=LABELS[name])
    plt.axhline(y.mean(), color="grey", ls="--", lw=1, label=f"prevalence {y.mean():.4f}")
    plt.xlabel("recall")
    plt.ylabel("precision")
    plt.yscale("log")
    plt.title("Test 2023-2024: next-day discovery")
    plt.legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    plt.close("all")


def plot_reliability(results, path):
    plt.figure(figsize=(5.5, 5))
    for name, item in results.items():
        bins = item["test_reliability"]
        plt.plot([b["mean_predicted"] for b in bins], [b["observed"] for b in bins], marker="o", label=LABELS[name])
    top = max(max(b["observed"] for b in item["test_reliability"]) for item in results.values())
    plt.plot([0, top], [0, top], color="grey", ls="--", lw=1)
    plt.xlabel("calibrated probability (decile mean)")
    plt.ylabel("observed discovery rate")
    plt.title("Reliability on test")
    plt.legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    plt.close("all")


def plot_budget(results, ablation, path, budget):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    names = list(results)
    values = [results[n]["test"]["recall_at_budget"] for n in names]
    ci = np.array([results[n]["test_intervals"]["recall_at_budget_95ci"] for n in names])
    axes[0].barh([LABELS[n] for n in names], values, xerr=[np.array(values) - ci[:, 0], ci[:, 1] - np.array(values)], color="#d9622b")
    axes[0].set_xlabel(f"recall at {budget} cells per day (95% week-bootstrap)")
    axes[0].set_title("Models")
    labels = list(ablation)
    axes[1].barh(labels, [ablation[a]["recall_at_budget"] for a in labels], color="#3a7ca5")
    axes[1].set_xlabel(f"recall at {budget} cells per day")
    axes[1].set_title("Random Forest feature sets")
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    plt.close("all")


def plot_map(data, cells, days, y, score, path):
    year = year_of(days)
    months = pd.to_datetime([day_date(d) for d in np.unique(days)]).month
    season_days = np.unique(days)[np.isin(months, [6, 7, 8, 9])]
    mask = (year == 2024) & np.isin(days, season_days)
    frame = pd.DataFrame({"cell": cells[mask], "score": score[mask], "y": y[mask]}).groupby("cell").agg(score=("score", "mean"), fires=("y", "sum"))
    lon = data.grid.cells["lon"].to_numpy()[frame.index]
    lat = data.grid.cells["lat"].to_numpy()[frame.index]
    plt.figure(figsize=(9, 5.4))
    plt.scatter(lon, lat, c=frame["score"], s=22, marker="s", cmap="inferno")
    plt.colorbar(label="mean Random Forest score")
    fired = frame["fires"] > 0
    plt.scatter(lon[fired], lat[fired], s=4 + 6 * frame["fires"][fired], facecolors="none", edgecolors="#5ce1e6", lw=0.8, label="recorded discoveries")
    plt.legend(loc="lower left", fontsize=8)
    plt.title("June-September 2024 (test): mean score vs recorded discoveries")
    plt.gca().set_aspect(1 / np.cos(np.radians(47)))
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    plt.close("all")


if __name__ == "__main__":
    main()
