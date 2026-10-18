# Data pipeline

Node 24 runs this workspace from the repository root. It shares the FIRMS parser in `@emberready/data`.

```bash
npm ci
npm run data:ingest -- --source firms-viirs-noaa20 --region wa-demo --raw data/replay/wa-viirs-noaa20-20261010/raw/J1_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv --fetched-at 2026-10-18T04:34:28Z --source-url https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv
npm run data:validate -- --manifest data/replay/wa-viirs-noaa20-20261010/manifest.json
npm run data:replay -- --manifest data/replay/wa-viirs-noaa20-20261010/manifest.json
npm run data:publish -- --manifest data/replay/wa-viirs-noaa20-20261010/manifest.json --mode replay
```

Live ingest uses `FIRMS_MAP_KEY` and does not replace the replay snapshot when the request fails.

```bash
npm run data:ingest -- --source firms-viirs-snpp --region wa-demo --days 1
```

Ingest now writes each run into a new immutable `artifacts/snapshots/<runId>` directory. It validates bytes and source lineage, writes the manifest last, then atomically replaces the mode-specific pointer. Re-running the archive never overwrites the checked-in dataset. Run `npm run verify:data` for two isolated real-data rebuilds and hashes. `npm test` injects interruptions after artifact, manifest, directory and pointer staging writes.

`wa-demo` is the Washington box in `data/regions/wa-demo.json`. Callers cannot pass an arbitrary URL or bounding box.

For briefing evaluation, `node --import tsx apps/pipeline/src/export-evaluation.ts artifacts/evaluation-inputs.json` verifies frozen case hashes and exports their deterministic contexts and current Voice prompt. It does not regenerate cases or publish synthetic data. See [evaluation instructions](../../data/evaluation/README.md) for bounded paid provider runs and human review.
