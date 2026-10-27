# Warehouse input truth, forecast identity and disputed finals

Development model v6.0.30. Baseline dc43951: 405 passing tests. Source only; no deployment, promotion or live trading. Scoring formulas and weights are unchanged.

## NFL unit-audit result

The [published team dictionary](https://nflreadr.nflverse.com/articles/dictionary_team_stats.html) distinguishes official pass attempts from EPA and CPOE. The [inspected upstream generator](https://github.com/nflverse/nflfastR/blob/4fc75e88b308ed592e11700e580e9e5380bdc46b/R/calculate_stats.R#L211) sums passing EPA and averages available CPOE observations. Broad attempts are not its exact nonmissing CPOE sample count. The upstream file was pinned and hashed privately; its version is not independently tied to the saved 2024 data producer or historical publication state.

Local inspection and a regression confirm that cpoeDifference, passingEpaDifference and rushingEpaDifference are not consumed by the current football specialist. epaDifference is consumed. No reason was found to rescale CPOE or add it to the strategy. Existing /60, /38 and /24 transformations are heuristic scaling, not measured per-play denominators. The historical yards/third-down/turnover EPA proxy is not actual play-level EPA. No weights or proxy formulas changed.

## Confirmed defects and fixes

- [Compact inputs](../sports-bot/src/featureWarehouse.js#L94) converted null/blank numeric values to zero and unknown environment flags to false. New snapshots use nullable measured numbers, nonnegative safe integer counts and explicit nullable booleans. Genuine zeros and false flags survive. Unknown participation fields and explicit null advanced measurements remain unknown. Zero factor multipliers are no longer replaced by one.
- [Forecast identity](../sports-bot/src/featureWarehouse.js#L60) omitted league, model and horizon. Keys now include guild/date, league/native ID, canonical scheduled start, model, horizon and canonical issue time. Original timestamp text stays immutable; equivalent formatting cannot duplicate a forecast.
- [Input association](../sports-bot/src/featureWarehouse.js#L330) formerly keyed games only by native ID. Lookup now checks namespace and known start times. An unscoped caller can associate only a uniquely matching event. Immediate cloning prevents callers from mutating probabilities or inputs during a queued write.
- [Final grading](../sports-bot/src/featureWarehouse.js#L344) formerly matched only native ID and ignored finals-only batches. Grading now isolates event scope and can resolve an archived forecast without issuing another. Identical duplicate finals are compatible; contradictory outcomes or scores cannot select the last row as truth.
- [Disputed outcomes](../sports-bot/src/featureWarehouse.js#L370) clear eligible actual-side/correctness fields, retain the prior undisputed grade and bounded conflict observations, and remain excluded from learning after later unverified batches. Inventory counts disputed prediction records, not unique games. Controlled adjudication remains unfinished.

## Storage and compatibility

New input snapshots identify sports-compact-inputs-v2 and disclose their bounded scope. Existing scalar/player limits remain; these are not complete raw source archives. The container remains version 2 and snapshotPolicy remains first_issue_immutable_v1. A separate identityPolicy identifies league_start_model_horizon_issue_v2.

Old snapshots are not relabeled or reconstructed. Lost missingness and collapsed forecasts cannot be recovered without authoritative original evidence. Later display updates and final grades preserve first-issued probabilities and inputs. The permanent journal and original prospective captures are unchanged. Changed or missing start-time scope may require explicit reconciliation instead of guessed association.

## Actual verification

Twenty integration tests exercise the real warehouse store. Seventeen fail against baseline; three existing-behavior controls already pass. Cases cover missing/zero/false distinctions, factor multipliers, identity collisions, cross-league input/grade contamination, different scheduled dates, canonical issue times, queued mutation, finals-only updates, disputed-result exclusion, legacy ambiguity and inactive CPOE fields. Positive EPA sensitivity confirms that the inactive-field check is not testing an inert scorer.

Complete suite: 425 passed, zero failures/skips. Syntax and whitespace checks pass. These are synthetic warehouse/scorer fixtures, not new forecasts or accuracy observations. No live market provider was queried; the definition audit read public upstream documentation/source only. No accuracy, calibration or economic improvement is established.

## Remaining work

Warehouse disputed results need controlled source-backed adjudication. Other compact market/timestamp contracts, complete input lineage, legacy evidence, sample adequacy, units/proxy validation, roster transitions, running-host verification and adequate prospective outcomes remain incomplete. Original NHL captures are unchanged. cPanel is excluded and blocked providers were not retried. Sports remains in progress, followed by Crypto and Stocks.
