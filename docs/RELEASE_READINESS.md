# Release readiness

This integration work continues the application on `dev` from `38d003d86b526e4f5270e0508ee29b08bfd9bd69`. It was performed in ChatGPT Work, not Cursor. Existing Cursor implementation evidence is retained in BUILD_EVIDENCE.md.

## Completed checks

- The catalog contains eight communities. Every ID and coordinate matches the checked-in 2026 Census Gazetteer. Local resources were checked on official Chelan, Okanogan, Spokane, Seattle and Yakima government pages on 2026-10-18. Medical Lake uses the countywide AlertSpokane resource. Links are current resources, not historical alert claims.
- The live server handler fetched NASA's public NOAA-20 24-hour CSV. It retained 13 Washington observations from 1,168 rows, with zero quarantined rows and 1,155 spatial exclusions. The newest Washington acquisition was 2026-10-17 20:49 UTC. Retrieval time is separate. See [live evidence](evidence/live-nasa.json).
- Two real raw-file rebuilds produced identical normalized bytes and datasetVersion. Both snapshot IDs remain independently readable. See [hash evidence](evidence/rebuild.json).
- Tests simulate interruptions after artifact, manifest, directory and pointer staging writes. Each preserves the previous good current snapshot. Corrupted hashes and invalid provider bodies are rejected. A read-only bundled replay survives application restart.
- Live selection clears replay observations. Unknown and unavailable states have no reassuring no-signal band. Map construction and tile errors show a non-map fallback.
- Voice now implements speech, ephemeral sessions, one signed read-only context tool, transcript, optional transient microphone capture, stop, context cancellation, protected endpoints and process quotas. These controls are tested with synthetic responses. They are not actual Grok output evidence.
- Twelve briefing evaluation cases are frozen, six real and six synthetic. Four are held out. [Review packet](../data/evaluation/README.md). Zero actual Grok responses and zero human reviews are recorded.

## Commands and limits

Local typecheck, lint, 46 Vitest tests, 17 repository tests and repository checks passed. [CI run 39103797733](https://github.com/jumiknows/spacex2026Hacks/actions/runs/39103797733) passed all three jobs for `8d4ef4e94f1823d5d854a4925b5a8aaf33663a7a`, including the Next production build and nine Playwright tests. Browser checks include three clean replay runs, WebGL-off, blocked tiles, Live failure, missing Voice credentials, late speech cancellation and mobile width. Desktop and mobile screenshots are in its `browser-evidence` artifact, ID `12127388825`, available until 2026-11-01. Local Chromium is absent. The browser result comes from GitHub CI.

The live adapter validates Washington bounds, product and one-to-five-day windows before network access. Concurrent requests share one fetch. One retry for 429 or server errors shares the total timeout. A provider wait above one second is not shortened. Tests cover coalescing, rate limits, retry exhaustion, deadline and stale cache behavior.

## Deployment record

The [private demo](https://emberready.jumiknows.chatgpt.site) is deployed for the site owner. The Sites Vinext build passed with all application server routes. `tools/prepare_site.py` copies the application and domain source into an initialized Sites checkout while preserving hosting integration. It bundles the verified immutable replay.

| Field | Recorded value |
| --- | --- |
| GitHub application source | `8d4ef4e94f1823d5d854a4925b5a8aaf33663a7a` |
| Pushed hosting source | `ff490287365f7fb91251b8138a6c72a30c52daab` |
| Deployment | `appgdep_6ad465c73a088191a3ee850d343c33a8` |
| Saved version | `appgprj_6ad45848b77c81919e1c3cf32056e374~appgver_cbd5197676d4819190400fa1a369df5f` |
| Result | `succeeded` at 2026-10-18T06:23:11Z |
| Environment revision | `1`, private-site Voice access, no xAI key |
| Replay snapshot | `ddb23860ee372014201c236f56ab5045bbcc4a0b816a7807ea7dc14a10567c29` |

[Hosted HTTP checks](evidence/hosted-smoke.json) passed for the page, eight-place catalog, 397-row replay, 13-row live snapshot, exact live context and both provenance routes. Unknown place input returned 400. Both Voice endpoints returned 503 `missing-credential`. The checks used the supported private-site service authorization. They do not prove human sign-in, microphone permission or hosted browser behavior. GitHub browser tests exercised the Next application, while hosting uses the Vinext adapter.

Deployment is available for review. Promotion to the verified `main` release remains blocked by #23 and #32. The remaining checklist is in [DEMO_CHECKLIST.md](DEMO_CHECKLIST.md).

## Outstanding external gates

- Configure `XAI_API_KEY` privately and demonstrate actual speech and conversation. The app must not claim sponsor integration success from mocks. `FIRMS_MAP_KEY` is optional for the public-feed demo, but authenticated Area API access remains unverified.
- Have real people review actual Grok answers using the frozen cases and rubric. A developer-generated expected-fact file is not a human review.
- Confirm the organizer's submission deadline and the existing Cursor evidence with the team. No prize placement is promised.

## Recovery and access

Reopen Replay after a live provider failure. It uses the same bundled snapshot after restart. Live snapshots and request quotas are per process, capped at 32 snapshot IDs. Another instance or a restart can return `unavailable-snapshot`. Durable shared storage and global quotas remain #33.

Publication is single-writer. Staging directories are siblings of the final snapshot directory. Atomic renames protect readers from partial publication and preserve the last good pointer on a failed run. This is tested for process interruption, not machine power loss or network filesystems. A valid empty dataset needs an explicit time window and product revision.

Only an authorized private-site visitor or holder of the configured demo access code can request paid Voice. An ephemeral token expires after 60 seconds. The browser ends a session after two minutes. Token expiry and browser timers are not provider-enforced spending limits. Keep the site private and configure provider budget controls before broader access.

Rollback the hosted build by redeploying saved Sites version `appgprj_6ad45848b77c81919e1c3cf32056e374~appgver_4ea77469d69c8191bfc0e30a98847f33`, the earlier verified deployment of application source `8d0a583ad851b5090d50107efdc5c820720d567b`. Restore a local data pointer only through `data:publish` after validating its immutable manifest. Never edit bytes behind a published snapshot ID.
