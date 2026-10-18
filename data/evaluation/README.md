# Briefing review packet

Twelve frozen cases are indexed in [frozen-cases.json](frozen-cases.json). Six use the real NOAA-20 replay. Six are clearly labeled synthetic edge cases under `tests/fixtures/synthetic/briefing`. Eight cases are for development and four are held out.

Status: [actual responses are ready for review](REVIEW_PACKET.md). Each of two provider runs contains eleven completed answers and one deliberate cancellation, with six real and six synthetic scenarios kept separate. Zero human decisions are recorded. Deterministic expected facts come from the domain code. These are evaluation cases, not wildfire training labels.

1. The private deployment has verified xAI access. Keep provider credentials private and use bounded runs.
2. Capture the exact question, returned context, provider/model, prompt revision, transcript and timestamp for each case. Save sanitized text artifacts under `data/evaluation/responses/`. Do not save microphone audio or credentials.
3. Have a person review facts, provenance, uncertainty, scope and accessibility using `docs/LABELING_AND_ML.md`. Record their reviewer ID, timestamp, response path, pass/fail decision and notes in the selected run's `reviews.json`. Preserve the frozen case files. Use a second independent reviewer where available. Report actual reviewer coverage.
4. Any unsupported fact or mismatched context fails. Report passed/total reviewed cases separately for real and synthetic inputs. Resolve disagreements explicitly.
5. Keep the held-out cases unchanged during prompt work. If tuning uses those answers, freeze a new holdout before claiming generalization.

Use `npm run verify:evaluation` to validate schema, frozen hashes and split coverage. It does not execute Grok or certify a human review. Do not regenerate the frozen packet during prompt tuning.

The offline harness supplies synthetic contexts only to xAI during evaluation. They never enter public NASA routes. Context-switch cancellation in the recorded runs is a harness control, not a browser interaction. The application browser and human microphone checks remain separate.

## Recorded runs

- [First provider run](responses/2026-10-18-first-provider-run/run.json) exposed a playback buffer limit and two grounding errors.
- [Revised prompt run](responses/2026-10-18-grounding-revision/run.json) records the corrected count and unavailable-data instructions.
- [Findings](../../docs/evidence/voice-findings.json) preserve the observed problems and remaining review questions.

The original holdout was inspected before the second run. Its labels remain preserved for traceability, but it is no longer an untouched evaluation set. Freeze new held-out cases before making a generalization claim. No factual pass rate is claimed from transport success.

## Repeat a bounded run

From the repository root, use Node 24, Python 3.12 and `websockets==16.0`:

```bash
node --import tsx apps/pipeline/src/export-evaluation.ts artifacts/evaluation-inputs.json
python3 tools/evaluate_voice.py --run-id my-review-run
```

The key prompt hides input. A run makes at most twelve paid Voice sessions, each capped at 90 seconds and four tool calls. It saves sanitized transcripts, context, prompt hashes, audio checksums and timing, without saving credentials or microphone audio. Existing run folders are never overwritten. The current commands are for manual verification and do not run in CI.
