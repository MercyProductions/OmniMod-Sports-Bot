# Independent availability inputs and rejected summaries

October 24, 2026; development v6.0.65, implementation `736aefb38f34ebf3cdc47cece1af5bc59b9eed10`.

## Confirmed defect and repair

The previous `predictionInputsAt()` removed every automatic player and lineup when summary metadata failed its identity or observation-clock checks. That also erased a current, independently imported preferred-provider starter. An old-source regression reproduced zero retained players instead of one. This is a reproduced integration defect, not a claim that an actual provider delivered a contradictory summary.

Current source checks each original observation before reconciliation:

| Path | Result |
| --- | --- |
| Rejected summary plus current, independently bound preferred-provider observation | Preserve that observation; confirmation and medical status remain separate. |
| Rejected summary plus independently bound MLB scoreboard projection | Preserve the projection, without confirmation or medical clearance. |
| Rejected summary plus its player/roster/injury rows or unclassified legacy automatic rows | Exclude those rows and record `summary_parent_unavailable`. |
| Role/statistics borrowed from a rejected summary | Rebuild the view from remaining raw inputs; do not retain the borrowed fields. |
| Future, expired, conflicting, withdrawn, wrong-event or wrong-team provider assertion | Exclude it with a structured provider reason. |

Summary-dependent lineup ratings, participation aggregates, automatic context, environment and advanced dataset still clear when that summary is rejected. Valid independent inputs do not rescue its confidence, medical completeness or derived statistics. A valid summary injury still restricts the player; only an unusable parent removes its dependent assertion.

## Per-source binding

The adapter now records `availabilityEventIdentity` and `availabilitySnapshotHash` on its accepted original rows. The new internal `sports-provider-player-event-v1` identity binds native NHL player namespace/ID, event ID, exact start, side and both team abbreviations. The inference checker compares these with the current game and provider-specific snapshot receipt/hash/reference, including observation/receipt/expiry chronology and the existing maximum 30-minute window. Ambiguous team sides reject at import. A postponed start, swapped opponent or final game cannot reuse the old assertion.

This is local consistency checking of user-supplied assertions, **not provider authentication, independent publication evidence or medical verification**. The external exporter schema/configuration remains unchanged. Exporters do not need to invent internal binding fields: the adapter creates them after accepting a fresh source snapshot. Older materialized preferred-provider rows without binding are excluded as `provider_event_binding_unknown`; obtain a fresh authorized snapshot instead of backfilling legacy provenance. Original stored rows are not rewritten.

Issued evidence now retains each selected provider's individual snapshot identity, event binding, source observation, receipt, expiry, status and input state. It does not borrow the last provider's clock for another provider's health assertion. Binding objects in the returned coverage are copied, so subsequent input mutation cannot change them. Unknown health and individual injury reports still do not establish complete team coverage.

Relevant current lines: `src/availabilityProvider.js:24` (unique side) and `:36` (binding emission); `src/availabilityProviderScope.js:6` (inference checks); `src/inputChronology.js:42` (scope gate), `:62` (independent observation selection), `:98` (remaining parent-derived exclusions); `src/evidenceCoverage.js:125` (separate original source receipts). Paths are under `sports-bot/`.

## Verification and real-evidence limits

Baseline: **1,126 passed**. Sixteen new scenarios cover parent rejection, metadata/health dependency removal, import ambiguity, event/player/snapshot/clock mismatches, legacy rows, restart, withdrawals, scoreboard independence, actual inference and journal evidence. Focused: **112 passed**. Full default-parallel `npm test`: **1,142 passed**, zero failed/skipped. Syntax: **224 files**; whitespace and public-file secret checks passed. Postcommit isolated-source/provider/chronology checks: **68 passed**. See the [phase checklist](SPORTS_INDEPENDENT_INPUT_CHECKLIST.json).

A read-only input-filter check used all 21 games from the saved v61 capture at their original per-game cutoffs. It retained both original MLB pitcher projections and changed no capture bytes. The sample contained zero preferred-provider rows and zero unusable summary parents, so it does **not** validate this repair with real alternate-provider data. No new forecast, full-context model replay, model comparison, training or provider request occurred in that check.

The separately frozen v52 trial completed its sixth checked capture at **2026-10-24T11:11:31.870Z**: 12 distinct games, one date, zero finals, six receipts/61 provider blobs, 10 requests/three failures in this run and 67 cumulative checked requests. Its original 104-file manifest, source archive, plan/artifact and first forecasts verified unchanged. This repeated observation is not another 12 independent games. The original model was not replaced with v65. The hourly trial needs at least 75 independent games/eight dates/14 days plus bounded final collection; adequate performance evidence is not available yet.

Actual injury/confirmed-goalie coverage remains missing. The saved v61 summary ledger still has six HTTP 403s and no accepted summaries/injury rows; no preferred provider is connected. This repair prevents loss or misuse of available independent inputs, and does not manufacture missing data. Existing heuristic/model, calibration, uncertainty, risk and price qualification requirements remain. It can change predictions when those newly valid inputs are present, so independent forward validation is required before any promotion.

Live trading stays disabled and research emergency stop enabled. No orders, Discord posts, paid requests, credential changes, production startup, merge, deployment or model promotion occurred. All three automation configurations, including Stocks, remain byte-identical. Sports stays in progress before the complete Crypto and Stocks specifications.
