# Operational drift cohort and outcome-space integrity

October 21, 2026. Forecast model identity remains v6.0.45. This changes monitoring and future journal metadata; it does not change model probabilities, fitting, risk limits, recommendations or promotion behavior.

## Confirmed defects

The preceding `operationalAudit.js` chose one forecast per raw league/game/start/version before checking the other observations. Contradictory cross-guild final labels could disappear behind that first choice. Equivalent timezone spellings/casing could duplicate games, and different forecast horizons were combined in one drift cohort. Tied maximum-probability outcomes were selected using object-property order instead of the frozen pick. An actual draw with explicit zero forecast probability was dropped rather than penalized.

A real read-only check found a separate representation bottleneck: all 13 forecasts in the preserved next-day challenger journal have `draw:null`, because the engine emits two-way vectors without a draw key and the journal padded its percentage object with null. That journal did not freeze the emitted outcome space. Its legacy ambiguity must not be silently rewritten as a measured zero.

## Repair and source anchors

`sports-bot/src/operationalDrift.js:22` now selects canonical event/model/horizon cohorts. It quarantines conflicting/disputed outcomes across guilds, reused forecast IDs with incompatible frozen payloads and simultaneous incompatible earliest forecasts. Identical copies have one game weight. The first eligible issued forecast remains selected even if a later one has a result; resolution is not a selection criterion.

Probabilities and the frozen selected maximum are validated. Ties use that frozen selection. Explicit zero probabilities remain in Brier/log-loss scoring, including a zero-probability draw that actually occurs. Unknown outcomes, missing horizon/selection and invalid or timezone-naive chronology are excluded with structured reasons. Horizon cohorts can share games and must not be summed as independent evidence.

`sports-bot/src/predictionJournal.js:89` freezes `modeledOutcomes` from the keys the predictor actually emitted. For future explicitly binary records, null padding is recognized as a structurally absent model outcome, without changing the frozen percentage payload. Contradictory/incomplete declarations fail closed. Legacy records with missing draw probability and no declaration remain excluded as `modeled_outcome_space_unverified`; no profile-based guess or retrospective metadata rewrite is performed.

`sports-bot/src/operationalAudit.js:31` delegates monitoring and emits **`sports-operational-audit-v2`**. Raw operational counts remain distinct from qualified drift cohorts. Brier retains this report's existing sum-of-squared-errors convention across away/home/draw; it is not the mean-coordinate Brier used by the matched comparator. Score definitions are explicit. The default sample requirement remains 30 games in each window, and every supported comparison is still descriptive with `automaticAction:false`.

`sports-bot/scripts/audit-operations.js:5` adds an optional strict, explicit-zone historical cutoff. Bare, duplicate, empty or invalid cutoffs fail with a redacted error. Default behavior remains a current-time read-only report:

```powershell
node sports-bot/scripts/audit-operations.js --journal="C:/private/sports/prediction-journal.jsonl" --as-of=2026-10-21T14:05:15.439Z
```

The cutoff filters recorded evidence; it does not prove provider publication time or exact disk availability in the past.

## Verification

- Reproduced baseline: 672 passing tests.
- Fourteen added tests cover conflicting/disputed game labels, horizons, canonical timestamps, ties, explicit zero losses, identity conflicts, first unresolved forecasts, duplicates, missing metadata, binary declarations and actual journal/CLI integration.
- Eleven initial new tests fail against the preceding reporter. Two failures assert newly exposed diagnostics for preserved behavior (duplicate weight and no fallback to a later resolved forecast), rather than additional old scoring defects. The other cases reproduce cohort/selection/scoring problems.
- One earlier fixture incorrectly gave guild copies of the same game opposite results while expecting first-choice scoring. It now uses consistent labels; dedicated regressions require conflicting labels to be quarantined.
- The integration test uses the actual journal writer and result-only grading path, then invokes the real read-only CLI. Explicit binary metadata is preserved, the expected Brier sum is 0.32, an earlier cutoff excludes the later result, invalid cutoffs fail, and journal bytes remain unchanged.
- Full repaired suite: **686 passed, zero failures/skips**. Focused monitoring/journal checks and syntax/whitespace checks pass. Secret comparisons and Gitleaks must pass before pushing.

## Actual preserved research journal

At the fixed cutoff October 21, 14:05:15.439 UTC, the new report reads the existing 13-game next-day challenger journal: 13 issued observations, no delivery acknowledgements, 13 unresolved results, zero overdue results and zero scored drift cohorts. All 13 are also explicitly marked with unverified legacy outcome space; they are not reported as bad numerical forecasts or silently normalized into a cohort. Before/after file hashes match.

This report is not a production-host attestation. No live command, provider request, model training or Discord login was used. Future journal metadata repairs do not retroactively fix the frozen legacy sample. Other evaluators' legacy outcome-space interpretations require separate consistency review; do not assume their samples or Brier units match this report.

## Remaining limits

Pending outcomes and changing source/roster coverage can bias descriptive drift. A model-version label alone does not establish identical fitted artifacts, regimes or source configuration. No significance test, automatic rollback or model-selection approval is introduced. Team/day dependence remains, and real predictive improvement is unproven.

Actual host/configuration/jobs, adequate independent prospective outcomes, full source/settlement lineage, universal fetch auditing, interrupted-owner review and evidence-reviewed legacy adoption remain unfinished. Sports stays in progress; Crypto then Stocks remain queued. No merge, deployment, model promotion or live trading; cPanel excluded.
