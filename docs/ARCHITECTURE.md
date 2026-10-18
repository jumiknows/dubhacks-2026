# EmberReady architecture

Status: implementation design. These components are not built yet.

Decision: [ADR 0002](adr/0002-emberready-mvp.md). Interfaces: [contracts](CONTRACTS.md).

## Stack and boundaries

| Component | Choice | Responsibility |
| --- | --- | --- |
| Application | Next.js App Router, TypeScript, Node 24 LTS | UI and server route handlers in `apps/web` |
| Map | MapLibre GL JS | Client-side GeoJSON layers and selection |
| Shared domain | TypeScript in `packages/domain` | Schemas, UTC handling, proximity rules, briefing facts |
| Package management | npm workspaces and one root lockfile | Reproducible install and common commands |
| Checks | Vitest, Playwright, accessibility checks | Domain behavior, main flow, failure states |
| External data | NASA FIRMS, public place catalog, optional NWS | Observations and supporting context |
| Audio | Grok Voice with a server token endpoint | Grounded spoken interaction and transcript |

Select supported package versions during scaffolding, pin them in the lockfile, and use the same Node major locally and in CI. Keep the existing Python repository checks.

Use one application server. A database, message broker, Python service, Earth Engine account, and machine learning training pipeline are not required for this MVP.

## Data flow

The server requests a bounded FIRMS feed, normalizes it, and returns an immutable snapshot. The domain module combines that snapshot with a selected public place. Both the UI and voice tool read that same context. Replay loads a checked-in source snapshot and applies the same domain functions with an explicit clock.

| Location | Ownership |
| --- | --- |
| `apps/web/src/app/api` | Validated endpoints, upstream calls, and errors |
| `apps/web/src/components/map` | Map layers, legends, and hit testing |
| `apps/web/src/components/briefing` | Readable briefing and source inspector |
| `apps/web/src/components/voice` | Audio lifecycle, transcript, and tool response handling |
| `apps/web/src/lib/server` | Provider adapters, cache, and server-only secrets |
| `packages/domain/src` | Shared types, context computation, and deterministic facts |
| `data/replay` | Real source snapshots and provenance manifests |
| `tests/fixtures/synthetic` | Clearly labeled synthetic edge cases only |

## API surface

| Route | Contract |
| --- | --- |
| `GET /api/places` | Small curated public place catalog |
| `GET /api/observations` | Validated bounding box, mode, time range, and snapshot response |
| `GET /api/context` | `placeId`, `snapshotId`, and `asOf` produce a `PlaceContext` |
| `POST /api/voice/session` | Mint short-lived browser credentials after request validation |
| `POST /api/voice/briefing` | Synthesize the server-generated briefing for a known context |

Do not let callers supply arbitrary upstream URLs or arbitrary text to a paid audio proxy. Resolve provider URLs and briefing text on the server. Return stable typed errors for missing credentials, invalid inputs, upstream failure, and unavailable snapshots.

## NASA adapter

Start with one VIIRS source to keep provenance and counts simple. Preserve original confidence and product metadata. Cache bounded queries for a configurable ten minutes, coalesce concurrent requests, and use timeouts and bounded retries.

An in-memory cache is acceptable for the demo but is per process and disappears on restart. Cache contents must never be the only copy of the replay dataset. Use a content hash or manifest ID to resolve snapshots across requests, and return an explicit unavailable-snapshot error if a process has lost one.

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
