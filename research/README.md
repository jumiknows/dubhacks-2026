# Wildfire discovery research

Offline research for [issue #29](https://github.com/jumiknows/spacex2026Hacks/issues/29), following the [labeling and model protocol](../docs/LABELING_AND_ML.md). It does not change the app. The attention band stays deterministic.

The experiment is frozen in [experiment.json](experiment.json): rank 10 km cells in Washington by whether a wildfire discovery is recorded in FPA FOD the next day, using only data dated the day before. Results and their limits are in [the report](results/wa-discovery-nextday-v1/report.md).

## Pipeline

| Step | Module | Output |
| --- | --- | --- |
| Acquire | `wildfire/acquire.py` | Raw files with URL, time and SHA-256 in `artifacts/raw/manifest.json` |
| Grid | `wildfire/grid.py` | 10 km EPSG:5070 cells inside the Census state outline |
| Labels | `wildfire/labels.py` | Cell-day labels with counted exclusions |
| Features | `wildfire/features.py` | Season, terrain, thermal, weather and history features with an availability rule |
| Splits | `wildfire/splits.py` | Year splits, a held-out region and a hashed manifest that rejects overlap |
| Models | `wildfire/models.py` | Frequency baseline, logistic regression, Random Forest, gradient boosting, nearest neighbours, isotonic calibration |
| Evaluation | `wildfire/evaluate.py` | PR-AUC, recall at a daily budget, Brier, reliability, week-block bootstrap |
| Explanation | `wildfire/explain.py` | SHAP for the forest, permutation importance for nearest neighbours |
| Report | `wildfire/report.py` | `results/<experiment>/report.md` and a model card generated from `metrics.json` |

## Run

Python 3.12, about 600 MB of downloads and 1.5 GB of memory.

```bash
cd research
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
echo 'EARTHDATA_TOKEN=<NASA Earthdata Login token>' > .env
.venv/bin/python -m wildfire.acquire
.venv/bin/python -m unittest discover -s tests
.venv/bin/python -m wildfire.run
.venv/bin/python -m wildfire.report
```

`.env` and `artifacts/` stay out of Git. Only SRTM elevation needs the Earthdata token. The other sources are public.

## Rules this code keeps

- A feature for day D uses data dated D-1 or earlier. Tests add future data and check nothing changes.
- History features never see the row's own year.
- Validation tunes and calibrates. The test years are scored once.
- Training samples negatives with weights. Evaluation uses every cell-day.
- A missing record is "no record in reviewed scope", never "no fire".
- Weather is reanalysis, so results are retrospective and support no early-warning claim.

## Danger zones in the app

`wildfire/serve.py` turns the research model into the app's "Danger zones" layer.

```bash
.venv/bin/python -m wildfire.serve train                          # once, after wildfire.run
.venv/bin/python -m wildfire.serve score 2026-10-10 2026-10-17     # writes data/risk/
cd .. && npm run data:bundle                                       # checks and bundles for the web app
```

The serving model leaves out the 30-day thermal features because live feeds supply 7 days. It is trained, calibrated and tested on the same splits and its test result is in `results/<experiment>/serving.json`. Each scored day records its input coverage:

- `complete`: 7 days of thermal history and the previous day's weather
- `partial`: weather present, thermal history incomplete (the app says how many days)
- `unavailable`: NASA POWER has not published the previous day yet, so the day is not scored

Thermal history comes from the yearly archive, the FIRMS Area API when `FIRMS_MAP_KEY` is set, or the public 7-day feed, in that order. The web app reads `/api/risk` (grid and model summary) and `/api/risk/<date>` (one day). A cutoff on day D shows the ranking for D, which uses data through D-1.
