"""Render report.md and model-card.md from metrics.json, so every number in prose comes from the run."""

from __future__ import annotations

import json
import platform
import subprocess

from .config import RESULTS, ROOT, experiment

NAMES = {"random_forest": "Random Forest", "gradient_boosting": "Gradient boosting", "logistic_regression": "Logistic regression",
         "nearest_neighbors": "Nearest neighbours", "frequency_baseline": "Seasonal-regional frequency baseline"}


def pct(value, digits=1):
    return "not measured" if value is None else f"{100 * value:.{digits}f}%"


def num(value, digits=4):
    return "not measured" if value is None else f"{value:.{digits}f}"


def ci(pair, scale=100, digits=1):
    return f"{pair[0] * scale:.{digits}f} to {pair[1] * scale:.{digits}f}"


def commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def main() -> None:
    exp = experiment()
    out = RESULTS / exp["id"]
    m = json.loads((out / "metrics.json").read_text())
    budget = m["review_budget_cells_per_day"]
    models = m["models"]
    ranked = sorted(models, key=lambda n: -(models[n]["test"]["pr_auc"] or 0))
    best = ranked[0]
    base = models["frequency_baseline"]["test"]
    rf = models["random_forest"]
    t = rf["test"]
    ex = m["label_exclusions"]
    n_cells = json.loads((out / "split-manifest.json").read_text())["splits"]["test"]["cells"]

    lines = [
        f"# {exp['id']}: next-day wildfire discovery in Washington",
        "",
        f"Status: offline research. {m['framing']} {m['decision_gate']}",
        "",
        "## Question",
        "",
        exp["question"],
        f" The outcome is a recorded discovery in FPA FOD, not physical ignition, spread, damage or personal safety. A cell-day without a record is a database outcome, not proof that no fire occurred.",
        "",
        "## Data",
        "",
        "| Source | Role | Access |",
        "| --- | --- | --- |",
        "| FPA FOD 7th edition, US Forest Service | Labels | Public map service, Washington records 2013 to 2024 |",
        "| NASA FIRMS VIIRS S-NPP yearly archives | Prior thermal detections | Public download |",
        "| NASA POWER daily (MERRA-2 reanalysis) | Weather and topsoil wetness on the previous day | Public API |",
        "| NASA SRTMGL3 via LP DAAC | Elevation, relief and slope | NASA Earthdata Login token |",
        "| US Census 2023 cartographic boundary | State outline for the grid | Public download |",
        "",
        f"Every raw file is pinned by SHA-256 in [sources.json](sources.json). The grid has 10 km equal-area cells (EPSG:5070) whose centres lie inside Washington.",
        "",
        f"Of {ex['total_records']} FPA FOD records, {ex['retained_records']} were retained. {ex['outside_gridded_state']} fell outside the gridded state and {ex['missing_day_or_year_outside_scope'] + ex['missing_location']} lacked a usable day or point. They form {ex['positive_cell_days']} positive cell-days ({ex['records_sharing_a_cell_day']} records shared a cell-day with another record).",
        "",
        "Positive cell-days per year (adequacy audit):",
        "",
        "| " + " | ".join(m["adequacy_audit_positive_cell_days"]) + " |",
        "| " + " | ".join("---" for _ in m["adequacy_audit_positive_cell_days"]) + " |",
        "| " + " | ".join(str(v) for v in m["adequacy_audit_positive_cell_days"].values()) + " |",
        "",
        "## Features",
        "",
        f"Every feature for target day D uses data dated D-1 or earlier. Availability per group is in [feature-availability.json](feature-availability.json). Tests in `research/tests` check that adding data on or after D never changes a feature.",
        "",
        "- Season: day-of-year cycle, weekend, the 1 to 7 July window",
        "- Terrain: mean elevation, relief and slope per cell",
        "- Thermal: VIIRS detections in the cell and its 3x3 and 5x5 neighbourhoods over 1, 3, 7 and 30 days, fire radiative power and days since the last detection",
        "- Weather: previous-day heat, humidity, vapour-pressure deficit, wind, rain totals, dry-spell length and topsoil wetness",
        "- History: the cell and neighbourhood discovery rate in training years, leave-one-year-out inside training",
        "",
        "## Splits",
        "",
        f"Training {exp['years']['train'][0]} to {exp['years']['train'][-1]}, validation {exp['years']['validation'][0]} to {exp['years']['validation'][-1]} for tuning and isotonic calibration, test {exp['years']['test'][0]} to {exp['years']['test'][-1]} evaluated once. A separate transfer test holds out {exp['spatial_holdout']['name']} with a one-cell buffer. Row hashes are in [split-manifest.json](split-manifest.json). Training keeps every positive and a weighted sample of {exp['negative_sampling']['train_ratio']} negatives per positive. Validation and test use the full natural population.",
        "",
        "## Results on the frozen test",
        "",
        f"Test rows: {t['rows']} cell-days with {t['positives']} positives (prevalence {pct(t['prevalence'], 3)}). The review budget is {budget} of {n_cells} cells per day ({budget / n_cells * 100:.1f}%). Intervals resample whole calendar weeks.",
        "",
        f"| Model | PR-AUC | 95% interval | Recall at {budget}/day | 95% interval | Precision at budget | False positives per 1,000 cell-days | Brier |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name in ranked:
        r = models[name]
        lines.append(
            f"| {NAMES[name]} | {num(r['test']['pr_auc'])} | {ci(r['test_intervals']['pr_auc_95ci'], 1, 4)} | {pct(r['test']['recall_at_budget'])} | {ci(r['test_intervals']['recall_at_budget_95ci'])}% | {pct(r['test']['precision_at_budget'])} | {num(r['test']['false_positives_per_1000_cell_days'], 2)} | {num(r['test'].get('brier'), 5)} |"
        )
    gain = (t["recall_at_budget"] or 0) - (base["recall_at_budget"] or 0)
    lines += [
        "",
        f"Chance PR-AUC equals the prevalence, {num(t['prevalence'])}. The strongest model by PR-AUC was {NAMES[best]}. At the same budget the Random Forest recalled {pct(t['recall_at_budget'])} of recorded discoveries against {pct(base['recall_at_budget'])} for the frequency baseline, a difference of {gain * 100:.1f} points. Tuned settings are in [metrics.json](metrics.json).",
        "",
        "![Precision and recall](figures/pr_curves.png)",
        "",
        "![Recall at budget](figures/recall_at_budget.png)",
        "",
        "Run history: the first complete run stopped after scoring the test years because one fitted model could not be saved. After that fix the unchanged pipeline, configuration and seed were run again and produced the same test metrics, so no setting was changed after seeing the test.",
        "",
        "### Feature sets (Random Forest, same settings)",
        "",
        f"| Features | PR-AUC | Recall at {budget}/day | 95% interval |",
        "| --- | --- | --- | --- |",
    ]
    for label, r in m["ablation_random_forest"].items():
        lines.append(f"| {label} | {num(r['pr_auc'])} | {pct(r['recall_at_budget'])} | {ci(r['recall_at_budget_95ci'])}% |")
    lines += [
        "",
        "### Slices (Random Forest)",
        "",
        "Each slice applies the 20-cell budget within the slice. A smaller pool makes the budget easier to fill, so slice recall is not comparable with the overall figure. Compare PR-AUC against each slice's prevalence instead.",
        "",
        f"| Slice | Positives | Prevalence | PR-AUC | Recall at {budget}/day |",
        "| --- | --- | --- | --- | --- |",
    ]
    for label, r in rf["test_slices"].items():
        lines.append(f"| {label.replace('_', ' ')} | {r['positives']} | {pct(r['prevalence'], 3)} | {num(r['pr_auc'])} | {pct(r['recall_at_budget'])} |")
    tr = m["spatial_transfer"]
    lines += [
        "",
        "### Geographic transfer",
        "",
        f"In {exp['spatial_holdout']['name']}, a forest that never trained there and had no history features reached PR-AUC {num(tr['held_out_region_model']['pr_auc'])} and recall {pct(tr['held_out_region_model']['recall_at_budget'])} at {budget} cells per day within the region. The forest trained with the region reached {num(tr['model_trained_with_region']['pr_auc'])} and {pct(tr['model_trained_with_region']['recall_at_budget'])}. The region has {tr['held_out_region_model']['positives']} test positives.",
        "",
        "### Calibration",
        "",
        "Scores were mapped to probabilities with isotonic regression fitted on the natural validation population. Brier scores are compared with a constant prevalence forecast in [metrics.json](metrics.json).",
        "",
        "![Reliability](figures/reliability.png)",
        "",
        "## Explanations",
        "",
        f"SHAP values for the Random Forest come from {m['shap']['rows']} test rows (half recorded discoveries, half not). Mean absolute contribution, largest first:",
        "",
        "| Feature | Mean abs SHAP |",
        "| --- | --- |",
    ]
    for feature, value in list(m["shap"]["mean_abs_shap"].items())[:10]:
        lines.append(f"| {feature} | {value:.4f} |")
    example = m["shap"]["example"]
    lines += [
        "",
        "![SHAP importance](figures/shap_importance.png)",
        "",
        "![SHAP values](figures/shap_beeswarm.png)",
        "",
        f"Example: cell `{example['cell_id']}` on {example['date']} had a recorded discovery and scored {example['score']:.3f}. Its largest contributions were " + ", ".join(f"{k} {v:+.3f}" for k, v in list(example["contributions"].items())[:5]) + ".",
        "",
        "Nearest-neighbour permutation importance on validation (drop in PR-AUC when a feature is shuffled):",
        "",
        "| Feature | PR-AUC drop |",
        "| --- | --- |",
    ]
    for feature, value in list(m["knn_permutation_importance"].items())[:8]:
        lines.append(f"| {feature} | {value:.4f} |")
    lines += [
        "",
        "![Map](figures/map_2024_season.png)",
        "",
        "## Limitations",
        "",
        "- Weather is reanalysis published after the fact, so this is a retrospective association study and not an early-warning result.",
        "- The FIRMS yearly archive mixes near-real-time and later standard-processing rows. Values can differ from what was visible on the day.",
        "- Thermal detections can belong to a fire that is later recorded as a discovery nearby. Part of the signal is detection of fires already burning, not prediction of new ones.",
        "- FPA FOD locations vary in precision and completeness by agency and year. Coverage gaps become false negatives.",
        "- Two test years with correlated events give wide intervals. The test was evaluated once.",
        "- No human reviewer has examined labels or errors. No decision threshold has been set.",
        "",
        "## Reproduce",
        "",
        "```bash",
        "cd research",
        "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
        "echo 'EARTHDATA_TOKEN=...' > .env   # NASA Earthdata Login, needed for SRTM",
        ".venv/bin/python -m wildfire.acquire",
        ".venv/bin/python -m wildfire.run",
        ".venv/bin/python -m wildfire.report",
        "```",
        "",
        f"Run on commit `{commit()}`, Python {platform.python_version()}, {m['runtime_seconds'] // 60} minutes on a 12-core CPU without a GPU. Seed {exp['negative_sampling']['seed']}.",
    ]
    (out / "report.md").write_text("\n".join(lines) + "\n")

    card = [
        "---", "tags:", "  - geospatial", "  - tabular", "---", "",
        f"# Model card: {exp['id']} Random Forest", "",
        "Status: offline research, not deployed. No license has been assigned to the combined data.", "",
        "| Field | Evidence |", "| --- | --- |",
        f"| Model identity | {exp['id']}, scikit-learn RandomForestClassifier, settings {json.dumps(rf['params'])}, experiment sha256 {m['experiment_sha256'][:16]} |",
        f"| Intended use | Rank 10 km Washington cells by chance of a recorded FPA FOD discovery on the next day, to support research on review prioritisation |",
        "| Excluded use | Emergency orders, evacuation or route advice, ignition or spread claims, operational early warning |",
        f"| Data | FPA FOD 7th edition labels, FIRMS VIIRS S-NPP, NASA POWER, SRTMGL3. {ex['retained_records']} records retained of {ex['total_records']}. See report |",
        f"| Reproduction | Commit {commit()}, research/requirements.txt, seed {exp['negative_sampling']['seed']}, commands in the report |",
        "| Baselines | Seasonal-regional frequency, logistic regression, gradient boosting and nearest neighbours on the same splits and budget |",
        f"| Evaluation | Test {exp['years']['test'][0]} to {exp['years']['test'][-1]}: PR-AUC {num(t['pr_auc'])} at prevalence {num(t['prevalence'])}, recall {pct(t['recall_at_budget'])} at {budget} cells per day |",
        f"| Calibration | Isotonic on the natural validation population. Test Brier {num(t.get('brier'), 5)} vs {num(t.get('brier_reference_prevalence'), 5)} for a constant forecast |",
        f"| Failure analysis | Slices and transfer results in the report. No reviewed error analysis yet |",
        f"| Resources | {m['runtime_seconds'] // 60} minutes for the full run on CPU. Inference cost not measured separately |",
        "| Deployment | Offline. No reviewer, shadow evaluation or rollback plan exists |",
        "| Maintenance | Re-run when a new FPA FOD edition is released. Decision gate unset |",
    ]
    (out / "model-card.md").write_text("\n".join(card) + "\n")
    print(f"wrote {out / 'report.md'} and {out / 'model-card.md'}")


if __name__ == "__main__":
    main()
