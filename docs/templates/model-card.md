---
tags:
  - geospatial
  - tabular
---

# Model card template

Status: no model trained. Fill with an actual experiment and verified license before publishing. This template makes no affiliation or academic validation claim.

| Field | Required evidence |
| --- | --- |
| Model identity | Experiment ID, artifact hash, algorithm and model revision |
| Intended use | Exact target, time horizon, population and decision supported |
| Excluded use | Emergency orders, safe-route advice, unsupported ignition or spread claims |
| Data | Dataset and label versions, source rights, exclusions and feature availability |
| Reproduction | Code commit, environment lock, seed, parameters, command and hardware |
| Baselines | Same splits, features, budget and evaluation protocol |
| Evaluation | Actual counts, metrics, prevalence, uncertainty and slice results |
| Calibration | Eligible population, calibration split and reliability evidence |
| Failure analysis | Misses, false positives, reporting gaps and geographic transfer limits |
| Resources | Measured training/inference runtime, memory and cost |
| Deployment | Offline, shadow or released status, reviewer and rollback reference |
| Maintenance | Monitoring, expiry/review date and retraining trigger |

Leave unknown measurements as not measured. Keep the frozen test independent from tuning. A successful retrospective experiment does not establish operational early warning.
