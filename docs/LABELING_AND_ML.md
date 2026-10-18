# Labeling, evaluation and model readiness

Status: the first research experiment is implemented in [research/](../research/README.md) and its measured results are in [the report](../research/results/wa-discovery-nextday-v1/report.md). See [data backend](DATA_BACKEND.md) and [data epic #29](https://github.com/jumiknows/spacex2026Hacks/issues/29).

Product decision, 2026-10-18: the product owner chose to show the research ranking in the app as a separate layer named "Danger zones" and marked "Research model", before the independent review and shadow evaluation described below. It does not change the attention band, the briefing or Voice. The layer states its test performance and that it is retrospective research, not a forecast.

## Two different kinds of labels

| Label set | Purpose | Priority |
| --- | --- | --- |
| Briefing evaluation | Check whether a response matches the selected evidence, explains uncertainty and stays within scope | P0 |
| Wildfire research | Investigate an explicitly defined prediction task against independent reference data | P2, after the core demo |

Do not treat FIRMS confidence as a wildfire probability or a verified incident label. Do not train a model to reproduce the attention rule and present that as a scientific discovery. Grok can draft annotation suggestions, but model-generated labels are not independent ground truth.

## P0 briefing benchmark

Create at least 12 cases covering recent observations, empty data, stale data, unavailable source, low confidence, a historical cutoff, a future-row trap, a place change during audio, a source citation request, an evacuation question, an unknown snapshot and map failure. This is a smoke benchmark, not evidence of population-level performance.

Each case records `caseId`, `snapshotId`, `placeId`, `asOf`, input question, expected facts, required source IDs, prohibited claims and reviewer decisions. Ground expected numeric facts in deterministic calculations. Use real source snapshots for normal cases and clearly marked synthetic fixtures for pathological cases. Keep their results separate.

Two people independently review the actual response where feasible, with a third decision or documented discussion to resolve disagreements. If only one reviewer is available, label the evaluation accordingly. Record reviewer IDs, rubric version, timestamps, agreement counts and unresolved items. Do not invent reviewers.

Use these rubric dimensions:

- Facts: count, distance, location, mode and time agree with the selected context.
- Provenance: cited source IDs exist and support the answer.
- Uncertainty: empty and missing are different, and no-data never means safe.
- Scope: no invented incident confirmation, evacuation route or predicted fire probability.
- Accessibility: the answer makes sense as text and audio without relying on color or map position.

Any unsupported factual claim or mismatched context fails that case. Report cases passed out of cases actually reviewed, not just a percentage. Keep prompt-development cases separate from a small held-out regression set. A prompt edited after inspecting the holdout needs a new holdout before any generalization claim.

## Future scientific question

Proposed first experiment: rank 10 km equal-area cells by whether at least one wildfire discovery is recorded in the following calendar day. This predicts a recorded discovery under reporting limitations, not physical ignition, spread, damage or personal safety. Confirm that ranking helps the community workflow before investing in the experiment.

Freeze the geography, grid definition, source edition, date convention and outcome before feature engineering. FPA FOD discovery dates can be day-level, so do not pretend they resolve hourly ignition. Verify the edition's documentation for time semantics. Use conservative prior-day feature cutoffs and exclude ambiguous boundaries. Do not silently convert local discovery dates into precise UTC instants.

The [US Forest Service current edition service](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_FireOccurrenceCurrentEdition_01/MapServer) identifies the seventh edition, FPA_FOD_20260615, covering 1992 to 2024. Pin the version-specific archive and checksum when acquired. Its records include discovery date, location and final size, with varying location precision and completeness. These are retrospective reports, not a record of what was known operationally at every moment.

[MTBS](https://www.mtbs.gov/project-overview) supports later burn-area or severity analysis, but focuses on large fires and includes prescribed fires. It is not a complete early-detection label source. No matching perimeter cannot be used as proof of no fire.

## Label construction

Create a versioned label table with `labelId`, `cellId`, `targetDate`, `labelVersion`, `referenceDatasetVersion`, matched event IDs, match rule, location uncertainty, date uncertainty, review state and exclusion reason. Preserve event identities so nearby records from the same event cannot leak across splits.

Use three states: `reported-discovery`, `no-record-in-reviewed-scope`, and `unknown`. The second is a database outcome within a documented scope, not proof that no fire occurred. Unknown reporting coverage, unclear dates, ambiguous duplicates and uncertain spatial assignments remain unknown or excluded. Any binary training export documents exactly which rows were eligible and what the negative label means.

Join reference events to cells using documented location precision, not an arbitrary tiny radius. Review a stratified sample covering matches, non-matches, reporting agencies, years and regions. Have independent reviewers adjudicate ambiguous cases. Report exclusion counts and sampling method. Test sensitivity to grid size and uncertain boundaries before choosing a resolution for product claims.

Never use final fire size, post-event perimeter, severity, incident closure, future hotspot counts, or revised future imagery as pre-event features. These may help audit labels but would leak the outcome into prediction.

## Feature availability

Every feature row carries `cellId`, `predictionCutoff`, source version, acquisition time, `availableAt` or null, transform version and missingness indicators. A feature may be used in an operational simulation only if its documented availability is at or before the cutoff.

Start with seasonality and terrain. Add historical weather forecasts only if their issue time, lead time and archive are available. A weather reanalysis is not automatically a forecast that existed then. Add prior thermal observations or vegetation indices only after accounting for actual availability, cloud masks, compositing windows and product revisions. Do not use GIBS display tiles as numeric training features.

If historical availability cannot be established, report a retrospective association study and stop short of early-warning claims. Compare feature sets so any gain from imagery is measured rather than assumed.

## Splits and leakage controls

1. Freeze dataset and label versions before generating split assignments.
2. Reserve the latest complete seasons as an untouched temporal test. Select exact years only after an adequacy audit.
3. Hold out contiguous geographic regions for a separate transfer test. Group matched incidents and overlapping spatial/time windows, with a documented exclusion buffer around boundaries.
4. Tune hyperparameters and calibration on earlier validation seasons only. Fit imputation, scaling and feature selection inside the training folds.
5. Save a `split-manifest.json` containing row IDs, dates, geography, grouping rules and hashes. Reject any overlap automatically.
6. Evaluate the frozen test once for the final comparison. If the dataset has too few independent events for useful uncertainty intervals, report insufficient evidence and collect more data.

Avoid a random row split: satellite observations from the same event and adjacent cells are correlated. The [scikit-learn leakage guide](https://scikit-learn.org/stable/common_pitfalls.html) also explains why transformations learned from test data invalidate evaluation.

## Baselines and decision gate

Start on CPU with a seasonal/regional frequency baseline, regularized logistic regression and gradient-boosted trees. An imagery encoder or remote-sensing foundation model is a later candidate only if the tabular experiment exposes a real limitation and compatible imagery, compute and licensing exist. Hugging Face is not a requirement to train a useful baseline.

Record PR-AUC with prevalence, recall at a predeclared review budget, precision, Brier score, reliability plots, and false positives per 1,000 eligible cell-days. Report uncertainty by resampling independent event or region-time groups, plus slices for year, region, missingness and reporting source. Accuracy alone is misleading for rare events. Sampled negatives need weighting or evaluation on the natural population before probability calibration is meaningful.

Predeclare the decision rule before opening the final test: improvement in recall at the same agreed review budget, acceptable calibration on the eligible population, and no critical slice regression. The product owner and a qualified domain reviewer must define the numerical thresholds using the actual use case. An unset threshold blocks promotion. No invented accuracy target or result belongs in a pitch.

Keep candidates in offline research until independent review, a prospective shadow evaluation and a rollback plan justify use. A research probability must never silently replace the MVP attention band. If a model does not outperform the baseline under these conditions, keep the deterministic product and publish the negative result internally.

## Where Hugging Face fits

[Datasets](https://huggingface.co/docs/datasets/loading) can load versioned tabular files. The [Hub dataset card](https://huggingface.co/docs/hub/datasets-cards) documents origins, schema, license, intended uses, exclusions and splits. A separate [model card](https://huggingface.co/docs/hub/model-cards) records training setup, evaluation and limitations.

Use [dataset-card](templates/dataset-card.md) and [model-card](templates/model-card.md) templates. Pin repository revisions, package versions, source hashes, seeds and code commits. Save parameters, predictions, metrics, runtime and cost for each experiment. Avoid unreviewed remote code or serialized objects from unknown model repositories.

Start with local/private artifacts. Confirm redistribution rights for each source and derivative before any public upload. Do not assign an invented permissive license to combined data. Exclude credentials, private notes, reviewer identities and microphone audio. Publish only after the team selects an authorized Hugging Face account and reviews the exact artifacts. No account, paid compute or publication has been created by this plan.
