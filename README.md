# SpaceX 2026 Hacks

Team hackathon workspace with ALEASAT-inspired contribution and review practices.

**Status:** repository foundation is ready. The application stack and demo scope still need to be selected.

## Start here

You need Git and Python 3.12 or newer for the repository checks. No Python packages are required.

```bash
git clone https://github.com/jumiknows/spacex2026Hacks.git
cd spacex2026Hacks
git switch dev
python3 tools/check_repo.py
python3 -m unittest discover -s tests -v
```

On Windows, use `py -3` instead of `python3`.

Pick an [open issue](https://github.com/jumiknows/spacex2026Hacks/issues), assign yourself, and follow [CONTRIBUTING.md](CONTRIBUTING.md). There is no application server to start yet.

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

- [Contribution steps](CONTRIBUTING.md)
- [Branches, issues, and work queue](docs/WORKFLOW.md)
- [Engineering review standard](docs/ENGINEERING_STANDARD.md)
- [CI and repository settings](docs/CI_CD.md)
- [Demo checklist](docs/DEMO_CHECKLIST.md)
- [Repository architecture decision](docs/adr/0001-repository-workflow.md)

The workflow draws on [ALEASAT Mission Software](https://github.com/jumiknows/Aleasat-Mission-Software). This repository has its own code, issue numbers, owners, and deployment decisions.
