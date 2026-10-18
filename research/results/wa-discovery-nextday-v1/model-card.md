---
tags:
  - geospatial
  - tabular
---

# Model card: wa-discovery-nextday-v1 Random Forest

Status: offline research, not deployed. No license has been assigned to the combined data.

| Field | Evidence |
| --- | --- |
| Model identity | wa-discovery-nextday-v1, scikit-learn RandomForestClassifier, settings {"min_samples_leaf": 30, "max_features": "sqrt"}, experiment sha256 a6ecc0bedf6098a6 |
| Intended use | Rank 10 km Washington cells by chance of a recorded FPA FOD discovery on the next day, to support research on review prioritisation |
| Excluded use | Emergency orders, evacuation or route advice, ignition or spread claims, operational early warning |
| Data | FPA FOD 7th edition labels, FIRMS VIIRS S-NPP, NASA POWER, SRTMGL3. 18299 records retained of 18777. See report |
| Reproduction | Commit ff0531d, research/requirements.txt, seed 29, commands in the report |
| Baselines | Seasonal-regional frequency, logistic regression, gradient boosting and nearest neighbours on the same splits and budget |
| Evaluation | Test 2023 to 2024: PR-AUC 0.0211 at prevalence 0.0025, recall 9.5% at 20 cells per day |
| Calibration | Isotonic on the natural validation population. Test Brier 0.00250 vs 0.00252 for a constant forecast |
| Failure analysis | Slices and transfer results in the report. No reviewed error analysis yet |
| Resources | 42 minutes for the full run on CPU. Inference cost not measured separately |
| Deployment | Offline. No reviewer, shadow evaluation or rollback plan exists |
| Maintenance | Re-run when a new FPA FOD edition is released. Decision gate unset |
