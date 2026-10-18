# ADR 0002: EmberReady MVP and implementation default

Status: Selected for the implementation handoff

Issues: [#6](https://github.com/jumiknows/spacex2026Hacks/issues/6), [#10](https://github.com/jumiknows/spacex2026Hacks/issues/10)

## Context

The team proposed wildfire detection, GIS visualization, changing landscapes, terrain, and mineral prediction. The challenge combines public benefit with real space data, Cursor implementation, and Grok Imagine or Voice.

## Decision

Focus on community wildfire awareness in Washington, with real NASA thermal observations, historical observation replay, accessible context, and Grok Voice. Treat terrain and landscape comparison as stretch work. Exclude mineral exploration and unvalidated fire prediction.

Use one Next.js and TypeScript application, MapLibre, npm workspaces, and a small shared domain package. Use Node 24 LTS and select supported locked dependencies during scaffolding. Retain the existing repository CI and add application checks.

Use deterministic code for all displayed counts, distances, timestamps, and attention bands. Grok explains the computed context. It does not calculate a hazard probability or issue an evacuation recommendation.

## Alternatives

- A broad Earth intelligence platform offers more layers but weakens the demo and multiplies validation work.
- A new predictive wildfire model requires data labels and evaluation that the current hackathon plan cannot substantiate.
- A separate Python GIS backend or Earth Engine pipeline adds setup and deployment dependencies before the core experience works.
- Generated disaster imagery does not provide trustworthy observation evidence. Voice has a direct accessibility role.

## Consequences

The team can divide the app into stable data, map, and voice interfaces. The key risks are provider access, obtaining a verified replay dataset, context synchronization, and clear communication of uncertainty. Test those before visual polish.

This is a selected implementation plan, not a record of completed software or validated product demand. If the team changes the stack before scaffolding, update this ADR and the related contracts once rather than letting each issue choose a different framework.
