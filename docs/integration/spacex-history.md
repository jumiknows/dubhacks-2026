# SpaceX application import

The [source repository](https://github.com/jumiknows/spacex2026Hacks) was imported into
the DubHacks application with real merge ancestry. All 36 original commits remain
ancestors of the integrated branch. The source repository was left unchanged.
The [history manifest](source-history.json) records the full commit IDs, original
branch tips, integration merges, and retained CI updates.

## Application and voice history

The primary import is `07ff80f`, merging source `origin/main` at `a0d685c`.
That source tip has the same tree as OrbiCart at `9b07a58`, plus the original
release merge ancestry. The application replaces the default DubHacks frontend
while retaining its backend, checkout, and gesture engine.

The useful voice branch `9e8214b` was merged in `db62a7b`. It adds stronger
evidence grounding, owner identity requirements for private hosting, evaluation
tools, and recorded evaluation evidence. Its historical evidence describes those
recorded runs and does not establish that the combined application was deployed.
Conflict resolution retained OrbiCart's newer audio batching, interruption handling,
and shopping tools. Incoming audio counts toward the queue limit, with 120 seconds
for community briefings and 180 seconds for the longer shopping session.

## Historical branches with equivalent changes

Merge `355090d` preserves these original tips without replacing newer application files:

| Original tip | Already integrated as | Evidence |
| --- | --- | --- |
| `592dfe0` | `247d2f0` | Equivalent repository-foundation patch |
| `a9aa99e` | `447f947` | Equivalent cleanup patch |
| `905d98f` | `0b2c55c` | Equivalent product-plan patch |
| `894ec0f` | `23b7f4f` | Equivalent data-foundation patch |
| `99a9e24` | `40ec7b9` | Identical entire trees, preserving all three original readiness commits |

The four patch equivalences were checked with `git cherry`. The readiness-tree
equivalence was checked with `git diff`. The wildfire research and mission-control
branches were already ancestors of OrbiCart and required no separate feature import.

## CI updates

Three original Dependabot histories were merged while retaining the combined CI jobs:

| Source tip | Integration merge | Action | Version |
| --- | --- | --- | --- |
| `fc13cac` | `bc32502` | `actions/checkout` | `7.0.1` |
| `df3abe2` | `66c4c16` | `actions/setup-python` | `7.0.0` |
| `46801c0` | `8c09727` | `actions/github-script` | `9.0.0` |

Their full action pins appear in the manifest and workflows.

## Feature inventory

- OrbiCart trip planning, environmental evidence, maps, product discovery, budget
  allocation, ownership choices, and Grok shopping tools come from the source app.
- EmberReady's satellite replay, public-feed observations, accessible map and list,
  community briefings, and research risk-layer implementation remain available.
- The research acquisition, feature, split, model, evaluation, and reporting code is
  retained. Model artifacts and external-provider availability remain separate from
  preserving that implementation.
- DubHacks retains its server-owned shopping plans, offer selection, mock and Stripe
  test checkout, account onboarding, calendar suggestions, AI assistant, review and
  website evidence services, and gesture engine. The previous frontend remains
  available as a legacy workspace.

The source commit titled “Added: payments” supplied product and budget controls.
Its UI still described checkout as future work. The combined application's payment
flow therefore uses the retained DubHacks backend.

## Verify preservation

Run from the repository root:

```bash
python3 tools/check_imported_history.py
python3 tools/check_repo.py
python3 -m unittest discover -s tests -v
```

The history checker requires each original full commit ID to exist as a commit and
be an ancestor of the selected ref. It disables Git replacement objects during
verification. Copying files or squashing equivalent changes cannot satisfy that
check. It checks ancestry separately from application behavior and provider setup.
