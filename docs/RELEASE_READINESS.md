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

Local typecheck, lint, 41 Vitest tests, 17 repository tests, repository checks and production Next build passed during implementation. The expanded Playwright suite is checked into CI, with desktop/mobile screenshots uploaded as `browser-evidence`. Local execution could not launch because Chromium is absent. CI results must be recorded before calling the browser gates complete.

The Sites Vinext build also passed with all application server routes. Hosting uses the same application and domain source with a verified bundled replay. `tools/prepare_site.py` copies the source into an initialized Sites checkout while preserving hosting integration. The site stays owner-private. The release record will include its actual deployment URL and source version after publication.

## Outstanding external gates

- Configure `XAI_API_KEY` privately and demonstrate actual speech and conversation. The app must not claim sponsor integration success from mocks. `FIRMS_MAP_KEY` is optional for the public-feed demo, but authenticated Area API access remains unverified.
- Have real people review actual Grok answers using the frozen cases and rubric. A developer-generated expected-fact file is not a human review.
- Confirm the organizer's submission deadline and the existing Cursor evidence with the team. No prize placement is promised.

## Recovery and access

Reopen Replay after a live provider failure. It uses the same bundled snapshot after restart. Live snapshots and request quotas are per process, capped at 32 snapshot IDs. Another instance or a restart can return `unavailable-snapshot`. Durable shared storage and global quotas remain #33.

Publication is single-writer. Staging directories are siblings of the final snapshot directory. Atomic renames protect readers from partial publication and preserve the last good pointer on a failed run. This is tested for process interruption, not machine power loss or network filesystems. A valid empty dataset needs an explicit time window and product revision.

Only an authorized private-site visitor or holder of the configured demo access code can request paid Voice. An ephemeral token expires after 60 seconds. The browser ends a session after two minutes. Token expiry and browser timers are not provider-enforced spending limits. Keep the site private and configure provider budget controls before broader access.

Rollback a hosted build by redeploying the previous saved Sites version. Restore a local data pointer only through `data:publish` after validating its immutable manifest. Never edit bytes behind a published snapshot ID.
