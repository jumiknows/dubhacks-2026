# ADR 0001: Repository workflow

Status: Accepted for the repository foundation

Issue: [#1](https://github.com/jumiknows/spacex2026Hacks/issues/1)

## Context

The team needs ALEASAT-style traceability and review practices in an empty hackathon repository. There is no agreed application stack or deployment target yet.

## Decision

Use GitHub issues, conventional commits, focused pull requests, and evidence proportional to the change. Use `dev` for integration and `main` for a verified demo baseline. Separate deployable applications, shared packages, and supporting tools.

Start with Python standard-library repository checks. Choose application runtimes in a separate decision and add their real build and test jobs with the application.

## Alternatives

- Main-only development is simpler, but gives the team no separate integration baseline during the hackathon.
- Copying ALEASAT's entire pipeline would require unrelated firmware, hardware runners, and deployment infrastructure.
- Selecting a web framework during repository setup would commit the team before its demo scope is agreed.

## Consequences

Contributors have a repeatable workflow immediately. The team still needs to select its stack, implement the demo, and configure hosting. Repository checks establish a foundation and do not certify an application.
