# ADR 0003: Reproducible data first, evaluated models later

- Status: accepted for implementation handoff
- Date: 2026-10-18 UTC
- Parent: [data epic #29](https://github.com/jumiknows/spacex2026Hacks/issues/29)

## Context

The team wants a startup-quality data backend and a clear path through cleaning, labeling and model training. ADR 0002 allowed a small application without a database. A transient cache alone is insufficient for reproducible research or a durable pilot.

## Decision

Add a TypeScript batch pipeline, raw artifact retention, strict quality gates and an immutable snapshot-store interface. Reuse the shared domain contracts and FIRMS adapter. P0 includes reproducible offline replay, an inspectable manifest and a reviewed briefing benchmark. The application remains one Next.js backend.

Use a local artifact store and bundled replay initially, then a managed scheduler and private object storage for the pilot. Add Postgres/PostGIS only when query and workflow requirements justify it. This extends ADR 0002's data design without making infrastructure or model training a prerequisite for the hackathon.

Research labels, leakage-resistant splits, CPU baselines and Hugging Face publication are explicit later gates. The observation attention rule remains separate from any experimental prediction.

## Consequences

The team can trace and reproduce data without operating a large platform. More disciplined manifests and failure handling add work to the core pipeline. The demo's live cache can still be process-local, which must remain visible until durable storage ships. No new performance, prediction, startup demand or competition outcome is established by this decision.

## Alternatives

- Train a large model immediately: lacks a validated target and independent labels.
- Build a full streaming platform: increases operating work before regional scale is known.
- Keep only API responses in memory: fastest prototype, but loses auditability and restart continuity.

See [data design](../DATA_BACKEND.md) and [labeling protocol](../LABELING_AND_ML.md).
