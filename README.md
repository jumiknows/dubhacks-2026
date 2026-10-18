# EmberReady

Community wildfire briefings from satellite observations.

**Status:** real NASA replay and public-feed live observations, the accessible map and list, deterministic briefings, and a verified data pipeline are implemented. Actual Grok speech and a grounded conversation have succeeded through the private deployment. Twelve evaluation scenarios now have provider evidence, including eleven completed answers and one deliberate cancellation. [Human review](data/evaluation/REVIEW_PACKET.md) and hosted browser checks remain open. No wildfire model has been trained.

[Open the private demo](https://emberready.jumiknows.chatgpt.site). Access is limited to the site owner. [Test and deployment evidence](docs/RELEASE_READINESS.md) records what works and the remaining release gates.

EmberReady helps a community coordinator understand thermal observations near a Washington community, replay what changed, and hear a plain-language Grok Voice briefing with source timestamps. It combines real NASA data, an accessible map and list, and links to official information.

Start with the [implementation epic](https://github.com/jumiknows/spacex2026Hacks/issues/10), [product brief](docs/PRODUCT_BRIEF.md), and [Grok handoff](docs/GROK_HANDOFF.md).

The heatmap represents observed thermal activity. The MVP does not claim ignition prediction, fire spread forecasts, or evacuation guidance.

## Start here

You need Git, Python 3.12 or newer, and Node.js 24.

```bash
git clone https://github.com/jumiknows/spacex2026Hacks.git
cd spacex2026Hacks
git switch dev
python3 tools/check_repo.py
python3 -m unittest discover -s tests -v
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

On Windows, use `py -3` instead of `python3`.

Pick an [open issue](https://github.com/jumiknows/spacex2026Hacks/issues), assign yourself, and follow [CONTRIBUTING.md](CONTRIBUTING.md). `npm run dev` starts the replay workspace. Live observations use the public NASA NOAA-20 24-hour CSV by default. `FIRMS_MAP_KEY` selects the bounded SNPP Area API. Spoken briefing and conversation need private `XAI_API_KEY` and access configuration. See [release evidence](docs/RELEASE_READINESS.md).

## Repository map

| Path | Purpose |
| --- | --- |
| [apps/](apps/README.md) | Deployable applications and services |
| [packages/](packages/README.md) | Code shared by applications |
| `tools/` | Repository checks and development scripts |
| `tests/` | Tests for repository tooling |
| [docs/](docs/WORKFLOW.md) | Workflow, engineering decisions, and demo guidance |
| `.github/` | Issue forms, pull request template, ownership, and CI |

## Team workflow

Create a focused branch from `dev`, open a pull request into `dev`, and record the checks you ran. Promote a verified demo from `dev` into `main` through a release pull request.

Use real GitHub issue numbers in branches and pull requests. Example: `feat/12-demo-flow` with the title `feat(app): add demo flow` and `Refs #12` in the description.

## Working guides

- [Product scope and demo goals](docs/PRODUCT_BRIEF.md)
- [Architecture and component boundaries](docs/ARCHITECTURE.md)
- [Data and API contracts](docs/CONTRACTS.md)
- [Data backend, cleaning, quality gates and storage](docs/DATA_BACKEND.md)
- [Labeling, baseline experiments and Hugging Face readiness](docs/LABELING_AND_ML.md)
- [Data registry and artifact schemas](data/README.md)
- [Interactive mockup and implementation notes](docs/prototype/README.md)
- [Verified data sources](docs/DATA_SOURCES.md)
- [Grok Bot and Cursor implementation handoff](docs/GROK_HANDOFF.md)
- [Three-minute demo script](docs/DEMO_SCRIPT.md)
- [Build and sponsor evidence](docs/BUILD_EVIDENCE.md)
- [Contribution steps](CONTRIBUTING.md)
- [Branches, issues, and work queue](docs/WORKFLOW.md)
- [Engineering review standard](docs/ENGINEERING_STANDARD.md)
- [CI and repository settings](docs/CI_CD.md)
- [Demo checklist](docs/DEMO_CHECKLIST.md)
- [Repository architecture decision](docs/adr/0001-repository-workflow.md)
- [Data foundation architecture decision](docs/adr/0003-data-foundation.md)
