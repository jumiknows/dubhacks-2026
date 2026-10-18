# Engineering review standard

A reviewer should be able to answer four questions without reconstructing the work from chat.

## Problem

Link the issue. Describe the current behavior and why it needs to change. State an observable acceptance criterion.

## Approach

Explain what changed and why. Record an [architecture decision](templates/adr.md) only when the choice affects interfaces, data, deployment, dependencies, or future work.

## Verification

List the commands and results. For a manual check, record the setup, expected result, and observed result. For a performance or accuracy claim, include the measured value, units, sample size, and environment.

Use the relevant level of evidence: static checks, unit tests, integration tests, a user flow, or a deployed smoke check. Do not describe a local test as production verification.

For a bug fix, show the reproduction before the fix and the corrected behavior. For UI changes, include screenshots at the sizes affected. Put substantial experiments in an [engineering note](templates/engineering-note.md).

## Risks and limitations

State known failures, untested paths, and follow-up work. Link a follow-up issue when work remains. Include recovery steps for a migration or deployment change.

## Depth

Use enough detail to support the decision. A small documentation change can have one sentence per section. A new protocol, external integration, or algorithm may need a linked note with sources and measurements.

This adapts ALEASAT's public [contributor guide](https://github.com/jumiknows/Aleasat-Mission-Software/blob/main/alea-gsw/CONTRIBUTING.md) and [proposed engineering review standard](https://github.com/jumiknows/Aleasat-Mission-Software/pull/16). It does not claim aerospace certification or standards compliance.
