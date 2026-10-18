# Team workflow

## Branches

| Branch | Purpose | Changes arrive through |
| --- | --- | --- |
| `main` | Stable demo baseline and default branch | Verified release or urgent fix pull request |
| `dev` | Integration of the team's work | Focused feature, fix, test, or documentation pull request |
| `type/issue-description` | One task | Commits linked to a real GitHub issue |

QA and user acceptance are checks on the same release candidate. Add separate environment branches only if the deployment system needs them.

## Issue labels

Use one priority and one status label, plus an appropriate type.

| Group | Labels |
| --- | --- |
| Type | `type:task`, `type:bug`, `type:decision` |
| Priority | `priority:P0` demo blocker, `priority:P1` core work, `priority:P2` optional improvement |
| Status | `status:backlog`, `status:ready`, `status:in-progress`, `status:review`, `status:blocked` |

Close an issue when its acceptance criteria are met and the completed work reaches `main`. Remove its status label when closing. An issue is blocked only when it states what is missing and who or what can unblock it.

## Work queue

The issue list is the working backlog:

- [Ready](https://github.com/jumiknows/spacex2026Hacks/issues?q=is%3Aissue+is%3Aopen+label%3Astatus%3Aready)
- [In progress](https://github.com/jumiknows/spacex2026Hacks/issues?q=is%3Aissue+is%3Aopen+label%3Astatus%3Ain-progress)
- [Review](https://github.com/jumiknows/spacex2026Hacks/issues?q=is%3Aissue+is%3Aopen+label%3Astatus%3Areview)
- [Blocked](https://github.com/jumiknows/spacex2026Hacks/issues?q=is%3Aissue+is%3Aopen+label%3Astatus%3Ablocked)

A GitHub Projects board is optional and is not created by repository files. If added, link this repository and use Backlog, Ready, In progress, Review, Blocked, and Done columns. Avoid maintaining a second task list in Markdown.

## Traceability

Use `Refs #12` while contributing to an issue and `Closes #12` when a pull request into `main` completes it. Use issue numbers from this repository.

Each issue needs a problem, a bounded outcome, and acceptance criteria. Each pull request needs evidence that supports the claimed outcome. Large design or measurement details belong in a linked engineering note.
