# Data and behavior contracts

These contracts keep data, map, and voice work compatible. Implement runtime validation and exported TypeScript types before connecting the components.

Artifact persistence and quality gates are specified in [data backend](DATA_BACKEND.md), with versioned [manifest and evaluation schemas](../data/README.md). Keep the existing response schema version separate from the artifact manifest version. The schema files are specifications, not a working validator or acquired dataset.

## Coordinate and time rules

- GeoJSON coordinates are longitude, latitude in WGS84.
- Distance calculations return kilometers and use a tested geodesic or haversine implementation.
- Store UTC timestamps in ISO 8601 with a `Z` suffix. Display a clearly named timezone.
- Parse FIRMS acquisition date and zero-padded HHMM together as UTC.
- Pass `asOf` explicitly to domain functions. Do not call the wall clock inside replay logic.
- Missing values are null or an explicit status, never a made-up zero.

## Snapshot

| Field | Type and meaning |
| --- | --- |
| `schemaVersion` | Literal `1.0` |
| `snapshotId` | Stable content or manifest identifier |
| `mode` | `live` or `replay` |
| `asOf` | The selected observation cutoff |
| `generatedAt` | When this response was assembled |
| `sources` | Provider, product, source URL, fetch status, retrieval time, and request range |
| `observations` | Normalized thermal observations |
| `warnings` | Typed missing-data or provider notices |

Source metadata includes `fetchedAt`, `newestObservationAt` or null, `fetchStatus` (`ok`, `stale`, `unavailable`), and `coverageStatus` (`unknown`, `provider-reported`). A successful empty CSV is not evidence of complete cloud-free coverage. A stale threshold of 15 minutes is a demo cache policy, not a satellite revisit guarantee.

## Thermal observation

Required fields are `id`, `sourceId`, `product`, `satellite`, `latitude`, `longitude`, `observedAt`, `confidenceRaw`, and `rawRowId`. `frpMw` may be null. Preserve the original product version and row in the provenance file.

For VIIRS, preserve low, nominal, and high confidence categories as categories. They are not percentages. FRP is not fire size. Repeated rows are deduplicated using product, satellite, acquisition time, and original coordinates. Do not merge nearby points from different sensors into a supposed confirmed incident.

## Place

Required fields are `id`, `name`, `latitude`, `longitude`, `sourceUrl`, `sourceVintage`, and `officialInfoLinks`.

Use public representative place coordinates from a documented source. Do not label them as a household, shelter, hospital, or emergency facility. Do not infer resident vulnerability from a town coordinate. Gazetteer coordinates are not community boundaries or population estimates.

## PlaceContext

Fields include `contextVersion`, `placeId`, `snapshotId`, `mode`, `asOf`, `nearestObservationKm`, `matchingObservationIds`, `countLast24h`, `attentionBand`, `ruleVersion`, `reasons`, `sources`, `briefingText`, and `officialInfoLinks`.

`contextVersion` must change when the place, snapshot, mode, or cutoff changes. All user-visible surfaces use it to discard old responses.

## Attention rule version 1

This is an explainable observation-sorting rule, not a hazard forecast. The distances are product defaults for the demo and have not been validated as risk thresholds.

Count nominal or high confidence observations acquired within the preceding 24 hours, including the cutoff, and exclude future observations. Use a left-open, right-closed time window: `asOf - 24h < observedAt <= asOf`.

| Condition | Band | User-facing meaning |
| --- | --- | --- |
| Required live source is stale or unavailable | `unknown` | Data needs review before interpretation |
| Nearest qualifying observation is within 5 km | `review` | Review nearby thermal observations |
| Nearest qualifying observation is over 5 km and within 25 km | `monitor` | Observed activity in the wider area |
| No qualifying observations within 25 km | `no-signal` | No matching observations in this snapshot |

Unknown places have a separate visible group. Do not hide them at the end of a reassuring sorted list. Low confidence observations remain inspectable but do not drive this band. Explain this filter in the legend.

Do not draw the 5 km and 25 km thresholds as hazard boundaries. Never rename these bands low, medium, or high fire probability. Weather warnings remain separately sourced context and are not multiplied into a made-up score.

## Replay and change summaries

The timeline shows cumulative observations up to `asOf`, with a configurable display window. New observations between two cutoffs are observations, not newly ignited fires or growth in burned area.

Hide current weather and current alerts when viewing historical replay unless a matching historical source snapshot is present. Never silently combine today's conditions with an old event. When historical availability times are unknown, explicitly describe the view as an observation-time replay.

## Briefing and Voice tool

The deterministic briefing includes the selected place, live or replay mode, cutoff, observation count and radius, latest observation time, source retrieval time, attention explanation, and official links. Empty and unavailable data use different sentences.

Define one read-only tool:

```text
get_place_context({ placeId, snapshotId, asOf }) -> PlaceContext
```

Validate all arguments against the application catalog and selected context. The model cannot write data, send alerts, invent map layers, or change the clock. Reject unknown snapshot IDs and stale context versions.

Voice answers about safety, evacuation, or road access must state that those facts are outside this dataset and direct the user to the displayed official sources. The model can explain observations and uncertainty. No microphone audio is stored by the application by default.

## Replay manifest

Each real dataset records `datasetId`, provider, product, source URL without credentials, retrieval time, observation start and end, region bounds, raw and retained row counts, transformation version, SHA-256, attribution, and `synthetic: false`.

Use the published manifest schema to add `datasetVersion`, `snapshotId`, raw and derived artifact hashes, count reconciliation and quality status. Persist original row lineage, validate all artifacts before publication and resolve the same immutable snapshot across application surfaces. A schema-valid manifest is not proof of real data or a completed quality check.

Record known source-availability timestamps if available, otherwise null. Keep synthetic edge-case fixtures under `tests/fixtures/synthetic` with `synthetic: true`. They are never the main demo's claimed NASA evidence.

## Essential test cases

Test the exact 5 km and 25 km boundaries, midnight UTC, HHMM with leading zeros, the left-open time boundary, future rows, low confidence rows, duplicated rows, unknown confidence, missing FRP, empty CSV, malformed CSV, timeout, stale cache, latitude/longitude reversal, and a place change during an audio response.
