# Grok Bot and Cursor handoff

Start with [epic #10](https://github.com/jumiknows/spacex2026Hacks/issues/10). This document prepares work for the team's bot and builders. Creating the issues has not launched a bot or assigned an account.

## Product in one sentence

Build EmberReady: a community wildfire awareness app with real NASA thermal observations, historical observation replay, and an accessible, source-grounded Grok Voice briefing.

Read [product scope](PRODUCT_BRIEF.md), [architecture](ARCHITECTURE.md), [contracts](CONTRACTS.md), and [verified sources](DATA_SOURCES.md) before coding.

## First actions

1. Connect this repository in the actual Grok Bot environment if available. Do not guess a GitHub bot username.
2. Open the repository in Cursor, pull `dev`, and read `AGENTS.md` and the project rule under `.cursor/rules`.
3. Start [access verification #11](https://github.com/jumiknows/spacex2026Hacks/issues/11) immediately. A blocked API cannot be fixed by polishing the map.
4. Start [app scaffold #8](https://github.com/jumiknows/spacex2026Hacks/issues/8) and [contracts #12](https://github.com/jumiknows/spacex2026Hacks/issues/12) with one agreed package setup owner.
5. Acquire the real replay source and place catalog in parallel. Build one complete map-to-briefing flow before optional layers.

Grok Bot can coordinate the backlog and handoffs. Application implementation must actually happen in Cursor for the supplied challenge requirement. Record the real tool use in [build evidence](BUILD_EVIDENCE.md).

## Work order

Suggested roles are responsibilities, not assignments to real people. Claim an issue before working and keep one status label on it.

| Wave | Issues | Suggested role |
| --- | --- | --- |
| Start now | [#11 access](https://github.com/jumiknows/spacex2026Hacks/issues/11), [#8 scaffold](https://github.com/jumiknows/spacex2026Hacks/issues/8), [#12 contracts](https://github.com/jumiknows/spacex2026Hacks/issues/12) | Integration and domain |
| Data preparation | [#13 real replay](https://github.com/jumiknows/spacex2026Hacks/issues/13), [#14 places](https://github.com/jumiknows/spacex2026Hacks/issues/14) | Data |
| First working flow | [#15 FIRMS](https://github.com/jumiknows/spacex2026Hacks/issues/15), [#16 map](https://github.com/jumiknows/spacex2026Hacks/issues/16), [#17 context](https://github.com/jumiknows/spacex2026Hacks/issues/17), [#19 Voice access and speech](https://github.com/jumiknows/spacex2026Hacks/issues/19) | Data, UI, Voice |
| Memorable demo | [#18 timeline](https://github.com/jumiknows/spacex2026Hacks/issues/18), [#20 grounded conversation](https://github.com/jumiknows/spacex2026Hacks/issues/20), [#21 accessibility](https://github.com/jumiknows/spacex2026Hacks/issues/21) | UI, Voice, QA |
| Verify and ship | [#23 integration QA](https://github.com/jumiknows/spacex2026Hacks/issues/23), [#9 release](https://github.com/jumiknows/spacex2026Hacks/issues/9), [#24 judging evidence](https://github.com/jumiknows/spacex2026Hacks/issues/24) | Integration and presenter |
| Optional | [#22 weather](https://github.com/jumiknows/spacex2026Hacks/issues/22), [#25 dated imagery](https://github.com/jumiknows/spacex2026Hacks/issues/25), [#26 terrain](https://github.com/jumiknows/spacex2026Hacks/issues/26) | Only after core gates |

The presenter can start the story and user-testing plan now. Their final evidence depends on working software. [#5](https://github.com/jumiknows/spacex2026Hacks/issues/5) separately tracks repository administration and teammate access.

## Coordination rules

- Read each dependency's result before marking the next issue ready. Labels are not automatically synchronized with dependency links.
- Use one branch and one focused pull request per issue. Target `dev` and link the issue with `Refs #N`.
- One owner controls root manifests, lockfiles, and shared schemas. Other builders coordinate changes through that owner.
- Use synthetic fixtures only for edge-case tests and early UI work. Switch the main demo to a verified real dataset.
- Keep missing-provider work blocked and visible. Do not replace real API evidence with an undocumented mock.
- Report changed files, commands run, results, limitations, and the next unblocked issue.
- Merge completed work into `dev` through the existing review process. Promote a verified release to `main`.

## Time budget

The issue timeboxes are estimates for experienced builders, not a promised schedule. The official submission deadline has not been supplied here.

Use the first 60 to 90 minutes for access, scaffolding, source acquisition, and contracts. By the first third of the remaining time, aim for a real observation selected on the map and a real spoken briefing. Reserve the final 20 percent for integration, recording, and rehearsal.

If time is short, cut weather, imagery, terrain, and extra languages first. If conversational audio remains unstable, keep a genuine Grok-generated spoken briefing and transcript, and explicitly mark conversational Q&A unfinished. Do not claim the full scope is complete.

## Copy into Grok Bot

```text
Work on https://github.com/jumiknows/spacex2026Hacks.

Coordinate the EmberReady build from epic #10. Read AGENTS.md,
CONTRIBUTING.md, docs/GROK_HANDOFF.md, docs/PRODUCT_BRIEF.md,
docs/ARCHITECTURE.md, and docs/CONTRACTS.md before taking work.

Start access verification #11, scaffold #8, shared contracts #12,
and real-data preparation #13 and #14. Respect each issue's
dependencies and keep root configuration under one owner.

Use Cursor for the actual application implementation and preserve
real Cursor and Grok evidence. Build one complete flow: choose a
community, inspect real NASA observations, replay the observation
timeline, and obtain a source-grounded Grok Voice briefing.

Use focused branches from dev and linked pull requests. Verify
acceptance criteria with actual commands and results. Keep live,
historical, synthetic, empty, and unavailable data distinct.

Do not invent fire probabilities, incidents, evacuation directions,
API results, tool-use evidence, or completed tests. If credentials
or a dependency block a task, record the blocker and move to a ready
task. Report the next useful handoff after each completed issue.
```

## Completion gate

Use [integration issue #23](https://github.com/jumiknows/spacex2026Hacks/issues/23), [release issue #9](https://github.com/jumiknows/spacex2026Hacks/issues/9), and the [demo script](DEMO_SCRIPT.md). A collection of closed tickets is not sufficient without a repeatable end-to-end demonstration and actual sponsor evidence.
