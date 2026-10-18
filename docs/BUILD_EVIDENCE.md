# Build and sponsor evidence

## Initial planning record

The repository foundation and this planning handoff were created through ChatGPT with the GitHub connection. This does not count as evidence that the application was implemented in Cursor or that Grok Bot has worked on it.

No authenticated Grok Voice call, FIRMS key-based fetch, application demo, user study, or application deployment has been completed by this planning task.

The data specifications, JSON schemas and interactive synthetic design reference were also prepared through ChatGPT. No operational pipeline, human-labeled dataset, training run, model metric or Hugging Face upload has been completed. Mockup interactions are not Grok API evidence.

## Append actual evidence

| Time | Tool or environment | Issue and commit | Action completed | Evidence location | Result or limitation |
| --- | --- | --- | --- | --- | --- |
| 2026-10-18 | Cursor cloud agent on this repository | #10, branch `cursor/land-emberready-app-d9fa` | Rebuilt the EmberReady workspace after the parent agent branch `cursor/land-emberready-app-7cc1` could not be fetched | This file, `apps/web`, `apps/pipeline`, `packages/domain`, `packages/data`, `data/replay` | Parent transcript and store were not accessible. The application was reconstructed here. Commands and results belong in the pull request after they run. |
| 2026-10-18T04:34:28Z | Public NASA FIRMS archive download | #13 | Retrieved NOAA-20 VIIRS C2 7-day CONUS and Hawaii CSV | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv` | 712541 bytes. SHA-256 `d94310ccd14dd8552bd428116259b74eae6ba264d140b44a46fe8cc9ecefd0e0`. 8441 data rows before the Washington filter. No `FIRMS_MAP_KEY` call. |
| 2026-10-18T04:26:00Z | US Census Gazetteer download | #14 | Retrieved the 2026 Washington place file and selected 12 named communities | `data/places/2026_gaz_place_53.txt` | SHA-256 `ea15e505da225db4290d9f318cc6fa08701cd9c953e6cae33209dfb432807e11`. The minute is the retrieval window. The HTTP Date header was not stored. |
| 2026-10-18 | Cursor, Node v24.22.0, Next.js 15.5.28 | #10, commits `f87b441` and `a5754a1` | Ran the repository and application checks and opened the replay UI | Pull request #42 | On the snapshot commit, `npm ci`, `npm run typecheck`, `npm test` (22 tests), `npm run build`, `python3 tools/check_repo.py`, and `python3 -m unittest discover -s tests -v` passed. Live `GET /api/observations?mode=live` returned 503 `missing-credential`. `POST /api/voice/session` returned 503. No Grok audio was generated. |
| 2026-10-18 | Cursor, Node v24.22.0, Next.js 15.5.28 | #10 #12, commit `fc15749` | Retested after the map height fix and synthetic parser fixture | Pull request #42 | `npm ci` added 217 packages. `npm run typecheck` passed. `npm test` passed 24 tests. `npm run build` passed. `python3 tools/check_repo.py` passed for 108 tracked files. `python3 -m unittest discover -s tests -v` passed 17 tests. `npm run test:browser` passed 1 test before this documentation row. The production build rewrote `apps/web/next-env.d.ts` with a `.next` reference. That edit was restored and is not committed. |
| 2026-10-18 | Cursor, Node v24.22.0, Next.js 15.5.28 | #8 #10, commit `e8a49f5` | Repeated the required checks after adding lint to CI | Pull request #42 | `npm ci` added 217 packages. `npm run typecheck` passed. `npm run lint` passed. `npm test` passed 24 tests. `npm run build` passed with the expected missing Next.js ESLint plugin warning. `python3 tools/check_repo.py` passed for 108 tracked files. `python3 -m unittest discover -s tests -v` passed 17 tests. `apps/web/next-env.d.ts` was restored after the build. |

For implementation, record relevant Cursor sessions, prompts or plans, accepted changes, and linked commits. Capture concise screenshots or a short recording without credentials or private conversations.

For Grok Voice, record the endpoint, model, test time, sanitized response or session identifier if available, and a clip of the actual application interaction. Do not publish tokens or raw microphone recordings from people who did not agree to recording.

For Grok Bot, record the real planning or coordination action and its output link or screenshot. GitHub issue creation alone is not proof of bot participation.

For NASA, preserve the source manifest and checksum. Record live-fetch success separately from replay success.

For user testing, record the task, consent to notes, completion time, observations, and changes made. Do not claim clinical, emergency-response, or population-level outcomes from a few demo tests.

## Submission check

Confirm the organizer's current deadline, category rules, disclosure requirements, and sponsor API interpretation. Cite the provided challenge text as the planning basis until an official submission URL is recorded.

## Integration continuation, 2026-10-18

The application status above records earlier work. The current integration state is in [release readiness](RELEASE_READINESS.md). ChatGPT Work completed the catalog correction, publication recovery, live public NASA feed, map fallback, Voice wiring and review packet. This work is not additional Cursor evidence.

The public NASA live handler succeeded with 13 retained Washington observations. Its actual timestamps, source URL, count reconciliation and raw checksum are in [live-nasa.json](evidence/live-nasa.json). No authenticated Area API request or Grok call is claimed. Two independent raw rebuilds reproduced the hashes in [rebuild.json](evidence/rebuild.json). Twelve review cases exist with empty human-review arrays.

GitHub CI passed 46 Vitest tests, nine browser tests and 17 repository tests for application source `8d4ef4e94f1823d5d854a4925b5a8aaf33663a7a`. [Run 39103797733](https://github.com/jumiknows/spacex2026Hacks/actions/runs/39103797733) includes desktop and mobile screenshots. Browser checks cover three clean replay rehearsals, WebGL and tile failures, failed Live selection, missing Voice credentials, delayed speech cancellation and mobile width. These are automated checks, not a human briefing review or a real Grok conversation.

The owner-private [EmberReady deployment](https://emberready.jumiknows.chatgpt.site) succeeded on 2026-10-18. The application was packaged from that tested GitHub source. [Hosted HTTP evidence](evidence/hosted-smoke.json) records successful catalog, replay, live, context and provenance responses. Voice returned 503 `missing-credential`. Hosted browser interaction has not been verified. Exact deployment, version and rollback identifiers are in [release readiness](RELEASE_READINESS.md).

## Actual Voice execution, 2026-10-18

After private runtime configuration, the hosted speech route returned a 1,203,840-byte MP3. A real ephemeral-token session called the deployed context tool and returned both transcript and 24 kHz PCM audio. [Provider evidence](evidence/voice-provider.json) contains source selection and checksums without credentials. [Boundary checks](evidence/voice-boundary.json) show rejected context changes and HTTP 401 for an expired token.

Two bounded offline provider runs exercised twelve frozen scenarios each. Each produced eleven complete answers and one deliberate harness cancellation. [The current review packet](../data/evaluation/REVIEW_PACKET.md) contains actual responses and empty human-review records. The first run exposed a playback-buffer fault and grounding errors, which are preserved in [findings](evidence/voice-findings.json). The revised prompt was exercised again. These are actual xAI calls performed through ChatGPT Work, not additional Cursor work or human review. No microphone audio was captured.
