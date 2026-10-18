# EmberReady architecture

Status: replay application and batch job are in the repo. Live FIRMS and Grok Voice credentials are still unverified. A synthetic [interactive design reference](prototype/README.md) remains design-only.

Decisions: [ADR 0002](adr/0002-emberready-mvp.md) and [data foundation ADR 0003](adr/0003-data-foundation.md). Interfaces: [contracts](CONTRACTS.md). Pipeline: [data backend](DATA_BACKEND.md).

## Stack and boundaries

| Component | Choice | Responsibility |
| --- | --- | --- |
| Application | Next.js App Router, TypeScript, Node 24 LTS | UI and server route handlers in `apps/web` |
| Map | MapLibre GL JS | Client-side GeoJSON layers and selection |
| Shared domain | TypeScript in `packages/domain` | Schemas, UTC handling, proximity rules, briefing facts |
| Data job | TypeScript in `apps/pipeline` and shared `packages/data` | Raw artifacts, normalization, quality gates and snapshot publication |
| Snapshot store | Local development, bundled replay, later object storage | Immutable data and sanitized provenance |
| Package management | npm workspaces and one root lockfile | Reproducible install and common commands |
| Checks | Vitest, Playwright, accessibility checks | Domain behavior, main flow, failure states |
| External data | NASA FIRMS, public place catalog, optional NWS | Observations and supporting context |
| Audio | Grok Voice with a server token endpoint | Grounded spoken interaction and transcript |

Select supported package versions during scaffolding, pin them in the lockfile, and use the same Node major locally and in CI. Keep the existing Python repository checks.

Use one application server and a reusable batch data job. A relational database, message broker, Python service, Earth Engine account and model training are not required for the hackathon. The [data plan](DATA_BACKEND.md) specifies P0 reproducibility and later durable scheduled ingestion. The [labeling plan](LABELING_AND_ML.md) gates model research on independent labels and evaluation.

## Data flow

The server and batch job share one FIRMS adapter. The job preserves raw bytes, normalizes rows, validates quality and publishes immutable artifacts through SnapshotStore. The domain module combines a selected snapshot with a public place. UI and Voice read the same context. Replay loads a checked-in real source snapshot and applies the same domain functions with an explicit clock. Live, replay and test artifacts remain separate.

| Location | Ownership |
| --- | --- |
| `apps/web/src/app/api` | Validated endpoints, upstream calls, and errors |
| `apps/web/src/components/map` | Map layers, legends, and hit testing |
| `apps/web/src/components/briefing` | Readable briefing and source inspector |
| `apps/web/src/components/voice` | Audio lifecycle, transcript, and tool response handling |
| `apps/web/src/lib/server` | Provider adapters, cache, and server-only secrets |
| `packages/domain/src` | Shared types, context computation, and deterministic facts |
| `packages/data/src` | Shared provider parser, artifact validation and SnapshotStore |
| `apps/pipeline` | Bounded ingest, validation, replay and publication commands |
| `data/replay` | Real source snapshots and provenance manifests |
| `tests/fixtures/synthetic` | Clearly labeled synthetic edge cases only |

## API surface

| Route | Contract |
| --- | --- |
| `GET /api/places` | Small curated public place catalog |
| `GET /api/observations` | Validated bounding box, mode, time range, and snapshot response |
| `GET /api/context` | `placeId`, `snapshotId`, and `asOf` produce a `PlaceContext` |
| `GET /api/snapshots/:id/provenance` | Sanitized published manifest and quality summary |
| `POST /api/voice/session` | Mint short-lived browser credentials after request validation |
| `POST /api/voice/briefing` | Synthesize the server-generated briefing for a known context |

Do not let callers supply arbitrary upstream URLs or arbitrary text to a paid audio proxy. Resolve provider URLs and briefing text on the server. Return stable typed errors for missing credentials, invalid inputs, upstream failure, and unavailable snapshots.

## NASA adapter

Start with one VIIRS source to keep provenance and counts simple. Preserve original confidence and product metadata. Cache bounded queries for a configurable ten minutes, coalesce concurrent requests, and use timeouts and bounded retries.

An in-memory live cache is acceptable for the first demo but is per process and disappears on restart. Replay uses a verified bundled artifact, not that cache. Both resolve through SnapshotStore. The pilot adds durable shared storage and scheduled ingestion. Return an explicit unavailable-snapshot error if a process has lost a live snapshot. Do not claim production persistence before the durable adapter is implemented.

Do not replace a failed live request with replay data without changing the mode. Feed freshness and the age of the newest thermal observation are different values.

## Voice integration

First prove a real text-to-speech request with a deterministic briefing. Then add the conversational Voice session and a single read-only `get_place_context` tool.

Use server-held `XAI_API_KEY` and short-lived browser tokens. Re-check the current official Voice documentation during implementation. Keep the model configurable and record the model used in the demo evidence.

The voice tool accepts only a known place and snapshot. It returns already computed facts and source references. The model may explain those facts but must not invent coordinates, prediction scores, alert status, or advice about routes and evacuation.

Changing place, mode, or replay time cancels the current audio response and creates a new context version. Ignore late responses for the previous version. Provide start, stop, transcript, and microphone permission states.

Token expiration is not a session-duration or spending limit. Add application session limits and a deployed access or quota control. Verify provider-side budget controls if available. Never describe an instance-local counter as a durable global budget.

## UI resilience

The place list and briefing work without WebGL or map tiles. Text remains available when audio fails. Replay data works without NASA availability. Cached content carries an explicit age and mode. A replay fallback is not evidence that the live connector succeeded.

## Runtime configuration

| Variable | Visibility | Purpose |
| --- | --- | --- |
| `FIRMS_MAP_KEY` | Server only | NASA access |
| `XAI_API_KEY` | Server only | Grok Voice access |
| `XAI_VOICE_MODEL` | Server configuration | Version used for the voice session |
| `NWS_USER_AGENT` | Server configuration | Identifies the application to NWS |
| `NEXT_PUBLIC_MAP_STYLE_URL` | Public | Approved basemap style and attribution |

Verify basemap terms, tile quotas, and attribution. A free rendering library does not make every tile service free. The paid Voice API also means the project is not guaranteed to cost zero.
