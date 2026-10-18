# Contributing

## Start a task

1. Open or pick an issue with a clear outcome and acceptance criteria.
2. Assign yourself and set `status:in-progress`. Keep one status label at a time.
3. Create a branch from the latest `dev`.

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feat/12-demo-flow
```

Replace `12` with your issue number. Use `feat`, `fix`, `docs`, `test`, `ci`, or `chore` as the branch prefix.

## Make a focused change

Use `apps/` for runnable applications and `packages/` for shared code. Each application must document its own install, run, test, and build commands.

Keep commits small enough to review. Stage the files you intend to change.

```bash
git diff
git add path/to/file
git commit -m "feat(app): add demo flow (#12)"
```

Commit and pull request titles use `type(scope): description`. The scope is optional. Supported types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.

## Verify and open a pull request

```bash
python3 tools/check_repo.py
python3 -m unittest discover -s tests -v
git diff --check
git push -u origin feat/12-demo-flow
```

Open the pull request into `dev`. Fill in the four sections in the template and add `Refs #12`. Include the actual commands and results. Add screenshots for visible UI changes and a reproduction case for bug fixes.

Run the affected application's checks as well. Repository checks alone do not verify application behavior.

Set the issue to `status:review` and request a teammate's review. `CODEOWNERS` currently names the repository owner until component owners are agreed.

## Merge and release

- Resolve review feedback and wait for CI to pass.
- Squash feature pull requests into `dev` with a clear title and issue reference.
- Open a release pull request from `dev` into `main` after the [demo checklist](docs/DEMO_CHECKLIST.md) passes.
- Use a merge commit for `dev` into `main` to preserve the shared history.
- Use `Closes #12` in the release pull request when the issue is complete. GitHub closing keywords take effect when merged into the default branch, `main`.
- Delete merged feature branches. Keep `dev` and `main`.

For urgent fixes, branch from `main`, use the same review and checks, then merge `main` back into `dev`.

## Handoff

Leave the run command, current blocker, and next useful step in the issue. Record architecture decisions in a short [ADR](docs/templates/adr.md) when another contributor would otherwise need to rediscover the reasoning.
