# Repository guidance

- Read README.md and CONTRIBUTING.md before changing this repository.
- Keep work connected to its GitHub issue and use conventional commit titles.
- Read the affected application's README before running or changing it.
- Run `python3 tools/check_repo.py`, `python3 -m unittest discover -s tests -v`, and the affected application's checks.
- Explain the problem, approach, verification, and remaining limitations in pull requests.
- Keep documentation concise. Do not claim tests, deployment, or measurements that were not completed.
- Preserve contributor work and avoid adding an application framework until the team has selected it.
- The EmberReady implementation default is documented in docs/adr/0002-emberready-mvp.md. Read docs/GROK_HANDOFF.md and docs/CONTRACTS.md before implementing its issues.
- Keep live observations, historical replay, and synthetic test fixtures visibly distinct.
- Record actual Cursor and Grok use. Planning files created elsewhere are not evidence of implementation in Cursor.
- Read docs/DATA_BACKEND.md, docs/LABELING_AND_ML.md and data/README.md for data work. Reuse one parser, preserve raw lineage and validate artifacts before publication.
- The prototype is synthetic. Model training is gated research, not required for the first demo. Never fabricate labels, reviewers, metrics or Hugging Face publication.
