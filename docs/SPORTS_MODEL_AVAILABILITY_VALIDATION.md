# Model availability validation and missing-data causes

## Confirmed validation defects

A registry champion could pass artifact/cohort checks even when its review, promotion or registry state did not exist at a historical forecast cutoff. Missing approval clocks were also accepted. Inference did not pass its own cutoff to registry selection. Local ML artifact availability used permissive date parsing, accepting normalized impossible dates or inferred timezones.

These were reproduced with registry and inference regressions. They are eligibility defects, not proof that a particular real forecast used a future model. No installed or production champion was changed.

## Repairs

- `sports-bot/src/modelRegistry.js:89` requires a strict, completed review timestamp before the decision instant. Existing model version, sport, candidate, artifact and hybrid source-recipe checks remain.
- Line 95 requires review finalization <= promotion <= evaluation <= forecast cutoff, with all those clocks present and calendar/zone valid.
- `modelDecisionForSport` requires the registry revision to have an explicit valid timestamp no later than inference. Unsupported chronology returns the evidence baseline with `provenance_revalidation_required`, without mutating stored state or reconstructing an older registry.
- `applyCandidateDecision` validates its explicit ISO decision clock and requires the review to exist by then before any authorized promotion could occur. The scheduled registry path still sets `allowPromotion:false`. No promotion was requested or performed in this work.
- `sports-bot/src/predictionEngine.js:667` supplies the actual inference cutoff to the registry guard.
- `sports-bot/src/localMl.js:275` uses the existing strict timestamp parser for training and final training-label clocks. Artifact hash, feature schema, fit and acceptance checks remain in place.

Model identity is **v6.0.48** because inference eligibility changed. Existing v6.0.45 studies remain pinned and cannot validate this new version. Registry schema remains v1; previously accepted entries with missing clocks require fresh provenance review, not invented timestamps. Coverage schema remains v2 with additive provider-mapping evidence.

## Missing-data investigation

The raw next-day study captures show different causes for unavailable inputs:

| Frozen role | Known summary identity blockers | Summary data present | History failures | Calibration history |
| --- | --- | --- | --- | --- |
| Baseline v6.0.0 | No mapping audit recorded | 0/13 | NHL and NFL HTTP 403 | 0 eligible forecasts |
| Challenger v6.0.45 | 12 NHL mappings unverified | 0/13 | NHL and NFL HTTP 403 | 0 eligible forecasts |

The baseline attempted six capped NHL summary requests; all returned 403. Its missing mapping audit does not establish correct provider identities. The challenger correctly skipped all 12 native NHL events because their ESPN event mappings were unverified, then attempted the one eligible NFL summary, which returned 403. Native official IDs must not be guessed into another provider's event-ID namespace.

The existing official NHL corroboration reads its score feed and returns zero confirmed starters; schedule corroboration is not confirmed-goalie, injury or roster coverage. The isolated study also deliberately disables optional official corroboration and historical boxscore collection. The score fallback's availability does not imply these richer inputs are available.

`evidenceCoverage.js` now preserves supplied summary mapping status/reason in each new report, with its lack of independent timestamp verification explicit. When no enrichment exists, a known unverified mapping becomes `summary:provider_event_mapping_not_verified`; an absent legacy audit stays unknown. Independently supplied summary data is not described as missing solely because another provider mapping failed. Existing captures and frozen reports are untouched; no new provider request was required for this investigation.

## Verification

Prior unchanged full suite: **826 passed**. Eleven added tests fail against the previous registry/inference/ML/coverage sources, with assertion failures rather than fixture exceptions. New behavior passes all eleven. Three existing positive-path fixture files now supply explicit valid chronology; promotion, rollback, hybrid recipe binding and ML activation tests still pass.

From `sports-bot`: `node --import ./test/setup.js --test test/registry-availability.test.js test/elo-conflicts-hybrid-binding.test.js test/v5-prediction-system.test.js test/v6-prediction-system.test.js test/selection-protocol.test.js test/evidence-coverage.test.js` — **70 passed**. Root full suite — **837 passed**, zero failures/skips. Root syntax and whitespace checks passed. Tests prove exercised safeguards, not a better forecasting model.

## Actual model evidence and remaining validation

The frozen next-day baseline and v6.0.45 challenger scored identically over 13 resolved games: 10/13 correct, Brier 0.2334843076923077, log loss 0.6600681637547575. Neither these identical outputs nor the earlier two-game sample establish a preferred evidence/hybrid/ML model. There is no adequate current-version league-specific calibration or independently validated improved ML champion.

Selection requires an exact preregistered artifact, at least 14 days, 75 games and eight dates under the existing research protocol. The small two-role capture study is not that selection trial. Review/hash fields in a local registry are not independent authentication of a research claim; full report/plan/decision binding, source publication lineage and ongoing forward evidence still need review. No missing data, historical model approval or performance result was fabricated.

Sports remains user-confirmed offline. Live trading stays disabled. No deployment, merge, champion promotion, orders or Discord posts occurred. The Stocks market-session automation file remains byte-identical and marked active. Sports remains in progress, followed by Crypto, then Stocks; cPanel remains excluded.
