# CI and delivery

## Checks included now

| Check | What it verifies |
| --- | --- |
| `Repository checks` | Tracked-file hygiene, JSON syntax, local Markdown file links, Python compilation, and tooling regression tests |
| `PR evidence` | Conventional title, a same-repository issue reference, and completed Problem, Approach, Verification, and Risks and limitations sections |

CI runs for pushes to `main` and `dev`, and pull requests into either branch. Editing a pull request description reruns its evidence check. Manual runs are also available in Actions.

Run the local checks from the repository root:

```bash
python3 tools/check_repo.py
python3 -m unittest discover -s tests -v
git diff --check
```

`check_repo.py` checks Git-tracked files. Stage new files before running it. It checks local file targets in inline Markdown links, not remote URLs or heading anchors. Its environment-file check is a hygiene guard, not a complete secret scanner.

`PR evidence` checks the supplied metadata. It does not prove that an issue exists or that a claim is correct. Reviewers verify those facts. Dependabot's bot-generated dependency pull requests are exempt from the human evidence template.

Actions are pinned to commit SHAs. Dependabot checks GitHub Actions updates weekly. The label workflow runs on changes to the label configuration on `main` and can also be run manually. It creates or updates the configured labels without deleting existing labels.

## Add application checks with the first application

Add the runtime version, reproducible dependency install, formatting or lint checks, type checks where applicable, meaningful tests, and production build. Add an integration or browser smoke test for the demo's primary user flow.

Use path filters only when all shared dependencies are covered. Keep required check names stable and ensure required jobs report a result for every pull request.

No application build, deployment, hosting environment, or production URL is configured yet.

## Repository settings

Workflow files do not enable branch protection. The owner should create an active ruleset targeting `main` and `dev` with:

- Pull requests required
- One approving review and code owner review
- Stale approvals dismissed after new commits
- Conversations resolved
- Required checks `Repository checks` and `PR evidence`
- Force pushes and branch deletion blocked

Keep merge commits available for releases from `dev` to `main`. Squash feature pull requests. Keep automatic branch deletion off while `dev` is a long-lived release source, and delete merged feature branches manually.

Add at least one teammate with write access and extend `CODEOWNERS` before depending on code owner reviews for work authored by the repository owner. A pull request author cannot approve their own pull request.

The repository connection used for setup cannot change administrative rulesets or collaborator access. Track that remaining setup as an issue instead of treating the documented rules as enforced.
