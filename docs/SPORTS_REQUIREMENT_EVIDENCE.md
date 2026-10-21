# Sports requirement-to-evidence checkpoint

This is a current-state index for the Sports reliability assignment, not a completion certificate. Earlier audit reports retain their original version, test count and historical observations. At the original checkpoint the implementation identified itself as v6.0.7; the archived prospective challenger remains commit `d73fd5f0c097c5c0cfa57f48801dce505c415073`. A later source repair does not retroactively change that experiment.

The user excluded cPanel from further work. Deployed source, configuration, registry and scheduler remain unverified. No deployment, live Discord modification, promotion or wager is authorized by this report.

## Requirement matrix

Status describes the whole requirement. Passing fixture coverage proves the exercised mechanism, not live coverage or better accuracy.

| Requirement | Inspectable source and regression evidence | Current status / remaining proof |
| --- | --- | --- |
| Preserve baseline and review branch | Tag `baseline/pre-readme-sports-audit-2026-10-20`, baseline `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`; PR #1 targets main and remains open. | Verified preservation; no merge/deployment. |
| Cache freshness and failures | `src/providerCache.js:58`; cache and accuracy regression tests reject invalid/future receipts and exercise bounded failure cooldown. | Fixture verified. Native publication time and permitted provider access remain separate requirements. |
| Historical dedup, version and horizon separation | `modelEvaluation.js`, `candidateCohorts.js`, `horizonEvaluation.js`, `matchedJournalEvaluation.js:104`; accuracy and matched-journal tests. | Fixtures cover missing timestamps, repeated observations, incompatible cohorts and conflicting results. Real historical matched records remain insufficient. |
| Manual precedence, missing MLB/soccer data | `predictionEngine.js`, `advancedDatasets.js`, `advancedMetrics.js`; prediction-system and advanced-model tests. | Targeted fixtures cover stale/manual identity conflicts and zero versus missing features. This does not attest populated live advanced fields. |
| Explicit provisional-to-issued lifecycle | `sportsData.js:946`, `pregameRefresh.js:115`, `predictionJournal.js:108`; journal test at line 177 rejects stale targeted refreshes and retries. | Verified in fixtures: rejected observations cannot become eligible issued forecasts. |
| Delivery, failures, restart and immutable grading | `prediction-journal.test.js:193` reimports journal module, omits failed-transport acknowledgement, deduplicates delivery and appends grading. Scheduler integration enters `buildJournaledPregameRefresh` at `index.js:405`. | Journal persistence verified; module reimport is not an operating-system crash/recovery or real Discord transport test. End-to-end transport and abrupt termination remain unverified. |
| Missed windows, provider failure, postponed/canceled games and corrections | `pregameRefresh.js`, `finalReconciliation.js`; journal, operational-audit and prediction-system tests. | Fixtures cover terminal build failure, stale retries, expired windows, postponed/canceled exclusions, repeated finals and revisions. Real overnight provider corrections not yet observed in the paired study. |
| Per-game evidence coverage | `evidenceCoverage.js:29`, frozen via `predictionJournal.js`; evidence-coverage tests examine projected roles, missing samples, numeric zero, injury reports and selected manual inputs. | Working reporting. Late scratches, bullpen availability and underlying publication freshness explicitly remain unverified; completeness is false. |
| Critical-role contradictions | `evidenceCoverage.js:62`, `dataValidation.js:2`, `participationProjection.js:18`; `evidence-coverage.test.js:76`. | Reproduced unavailable confirmed pitcher incorrectly satisfying coverage. Repaired shared status classification; unavailable rows no longer count as confirmed coverage. Unknown medical status remains unknown. |
| NFL QB, NBA rotations, MLB pitchers/bullpen, NHL goalies, soccer lineup/draw | Sport/participation models and per-game coverage expose available roles and missingness. | Partial. A feature name or fixture does not prove actual league coverage. The live prospective sample is NHL only and has missing enrichment. No claim of validated league-specific predictive value. |
| Point-in-time input integrity | `inputChronology.js:14`, `predictionEngine.js`, learning-context/feature-fit modules; input and feature chronology tests. | Known-future inputs and late labels excluded. Untimestamped legacy facts and nested revision lineage are not fully point-in-time attested. |
| Matched accuracy, Brier, log loss, calibration and intervals | `matchedJournalEvaluation.js:104`; matched tests exercise three-way mass, frozen references, as-of revisions and per-game bootstrap weighting. | Evaluator verified with fixtures. Two actual pregame pairs remain unresolved; no measured comparative improvement. |
| All requested strata and correlated snapshots | Evaluator includes sport, league, horizon, confidence, favorite, season/phase, roster transition, injury/lineup coverage, source freshness and market data. | Implemented strata may be unknown/empty. Same-game weighting is supported; broader day/team dependence remains a limitation. |
| Chronological selection and unsupported champions | `localMl.js`, `modelRegistry.js`, `hybridArtifact.js`, `selectionProtocol.js:36`; selection, feature-fit and hybrid tests. | Exact fit/recipe identities and single-use prospective holdouts tested. Scheduled registry refresh explicitly passes `allowPromotion:false`. No real selection trial justifies a new champion. |
| League calibration and uncertainty | Existing calibration/uncertainty plus operational drift reports; evidence/uncertainty fixtures. | Research incomplete. No adequate league-specific prospective evidence to choose a superior model or recalibration. |
| Original prices, fees, settlement and independence | `oddsPricing.js`, `oddsValue.js`, `priceResearch.js:10`; odds/price-research tests. | Formula and eligibility fixtures verified. No observed paired-study offered-price execution evidence or demonstrated after-cost edge. Counterfactual return is not a filled wager. |
| Operational metrics | `operationalAudit.js:6` and audit CLI; tests cover refresh failures, missing coverage, delivery unknown, overdue finals, drift and as-of cutoffs. | Offline metrics working; actual remote runtime remains unverified and cPanel excluded. |
| Isolated frozen-baseline research | `prospectiveIsolation.js`, `prospectivePairs.js`, archived worker/collector scripts; integration fixtures execute both archived sources with separate state and verify receipt integrity. | Actual two NHL pregame pairs captured before kickoff, receipts 838 ms apart. Cold-start, sequential provider samples; not identical inputs or deployed learner state. No production learner mixing. |
| Final outcome collection | Archived-worker reconciliation executes bounded pending dates and preserves original probabilities/timestamps in fixtures. | Current read-only live-study report has four role/game observations not started, zero final requests, two unresolved pairs. Live final retrieval still awaits eligible events. |

## Reproduced defect in this continuation

A direct call to `buildEvidenceCoverage` with a confirmed MLB pitcher, `status:'Out'` and missing numeric availability returned `criticalStarterStatus:'confirmed_record_present'` and omitted `away:critical_starter_unconfirmed`. `projectPlayerParticipation` already gave this player zero participation. The inconsistency affected reported evidence and potentially coverage strata; it did not establish an erroneous paper wager or change the original participation calculation.

The repair shares the existing unavailable-status predicate between participation and coverage. It also excludes inactive and zero-availability lineup rows from confirmed starter counts. The regression exercises Out, ruled-out notes, suspension, inactive and numeric zero. A confirmed role with unknown medical availability can still be a confirmed record; it is never a clean bill of health. Conflicting duplicate provider assertions still require broader provenance/reconciliation work.

## Verification and evidence boundaries

Before this edit: `npm test` passed 232 tests, zero failures/skips; `npm run check` passed. After this edit: 233 tests passed, zero failures/skips, and configured syntax checks passed. Full logs remain outside Git. The historical baseline had 109 tests; increased regression coverage measures software verification, not prediction quality.

The read-only paired report was regenerated from verified private capture receipts. It still reports two paired pregame forecasts, two unresolved games, no established performance and no promotion permission. It performs no provider requests. Both versions' wager decisions remain withheld; forecast comparisons are not wager recommendations.

## Remaining work in execution order

1. Finish source-level audits of input contradictions and feature lineage, with reproduced regressions before each correction. Preserve current frozen captures and model identities.
2. Collect finals for the two original games once eligible; retain missing, revised and conflicting results. Expand prospective sampling over independent dates and leagues without selecting only successful forecasts.
3. Obtain permitted enrichment coverage or document source-specific unsupported fields. Do not evade access denial or infer an injury-free lineup from an empty response.
4. Exercise real transport failure/retry and abrupt process recovery in an isolated harness; do not post to production to demonstrate a fixture.
5. Preregister disjoint model/league evaluations before judging candidates. Report proper scores, calibration, intervals, missingness and costed-price research only when sufficient real records exist.
6. Maintain an explicit deployment review checklist. cPanel inspection is excluded, deployed state remains unknown, and no automatic deployment or promotion is permitted.

Sports is unfinished. Crypto and Stocks remain queued in that order after Sports verification; this checkpoint does not redefine the complete goal around passing tests.

## Player identity continuation

Development v6.0.8 repairs team-scoped lineup joins and conflicting-ID historical matches; see [defects, fixtures and remaining limits](SPORTS_PLAYER_IDENTITY.md). The latest full suite passes 237 tests, zero failures/skips; syntax checks pass. The initial verification encountered intermittent capture chronology failures, documented in that report; chronology gates were preserved. Archived v6.0.7 pregame evidence is unchanged.
