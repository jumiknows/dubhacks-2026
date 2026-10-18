# Data foundation

This directory currently contains design inputs and schemas, not acquired NASA data or training data.

- [source-registry.json](source-registry.json) identifies selected and candidate sources. Access and rights reviews remain explicit.
- [Published manifest schema](schemas/snapshot-manifest.schema.json) defines the artifact boundary.
- [Briefing evaluation schema](schemas/briefing-case.schema.json) defines reviewable test cases.
- [Backend plan](../docs/DATA_BACKEND.md) specifies cleaning, quality gates, storage and job commands.
- [Labeling and model plan](../docs/LABELING_AND_ML.md) defines the evaluation and research gates.

Implement these schemas with a JSON Schema 2020-12 validator that checks date-time formats. Validate domain invariants in shared code as well: schema validation alone does not reconcile counts, verify hashes, establish source truth, compare timestamps or prevent path traversal.

During handoff preparation, both schema definitions passed Draft 2020-12 validation with `jsonschema[format]` 4.26.0. Two synthetic valid examples were accepted and ten invalid boundary examples were rejected, including invalid timestamps and synthetic data marked live. Ensure date-time format support is actually installed and enabled. This check is not an implemented pipeline or a substitute for the acceptance tests in #12 and #30.

For published manifests require `rawRows = retainedRows + duplicateRows + excludedRows + quarantinedRows`, zero quarantined rows, valid WGS84 bounds, ordered observation windows, a cutoff at the window end, and complete readable artifacts. Resolve relative artifact paths within the chosen storage root and reject absolute paths, traversal and unapproved remote hosts. The schema's `qualityStatus: passed` is a recorded result, not proof that checks ran.

Preserve original source bytes and use actual hashes. Do not create an example manifest with fabricated NASA provenance. Synthetic evaluation cases belong under `tests/fixtures/synthetic` and use `mode: test` in data manifests. The application only serves real `live` or `replay` manifests through its public observation routes.

Implementations should add a small reproducible real dataset only after [#13](https://github.com/jumiknows/spacex2026Hacks/issues/13) verifies it. Larger runtime artifacts stay outside Git.
