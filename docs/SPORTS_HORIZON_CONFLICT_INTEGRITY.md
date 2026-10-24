# Horizon forecast and result conflict integrity

## Confirmed defects

Equal-time different frozen forecasts were selected by input order. Actual labels could disagree across horizons, guild copies or model versions without excluding their event from descriptive scores. A disputed result record could coexist with a clean-looking copy that continued to score. Overall latest-forecast selection operated only on already scorable rows, allowing an invalid latest horizon to disappear and an older clean horizon to represent the event.

## Repair and references

- `sports-bot/src/horizonEvaluation.js:110`: result identity uses canonical league/native event/scheduled start, independent of guild/model/horizon. Contradictory labels and declared disputes from chronologically valid pregame input rows block the event across selected populations. They do not change persisted labels or constitute adjudication.
- `horizonEvaluation.js:112`: canonical frozen-input hashes compare probability vectors, class metadata, selected side, candidate inputs, model choice and input snapshot. Equivalent issue timezone strings normalize before hashing.
- `horizonEvaluation.js:171`: latest within-horizon issue selection happens before vector scoring. Contradictory result/dispute or different simultaneous latest inputs produce structured exclusions; there is no fallback to an earlier same-horizon issue.
- `horizonEvaluation.js:211`: overall selection checks the latest raw eligible issue across horizons before selecting its scored record. Conflicting latest horizon inputs exclude overall scoring while unambiguous horizon-specific scores can remain. An unscorable latest issue cannot silently fall back to an older horizon. Indexed scored-issue lookup avoids a new repeated linear search.

`scoringCandidates` now counts selected-version, eligible event/guild/horizon groups before conflict/vector exclusions. `scoringExclusions` counts affected groups. `conflictingResultEvents` and `disputedResultEvents` are distinct canonical events detected in eligible input rows across versions/guilds. `overallSimultaneousForecastConflicts` and `overallLatestForecastNotScorable` describe the overall event/guild selection. These populations overlap and must not be added as independent losses/games. Existing source/latest descriptive policy remains otherwise unchanged.

## Verification

- Unchanged baseline: 739 passed.
- Ten added tests. Eight targeted defect regressions fail on old source; two preservation checks cover identical duplicates and equivalent offset/case copies.
- Focused horizon, closing market, journal, accuracy and model suite: 69 passed.
- Full suite: 749 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage includes input-order conflicts; cross-horizon/guild/version contradictory labels; explicit disputes; cross-horizon simultaneous forecasts; independent start dates; invalid latest overall issues; no older fallback; consistent duplicate weights; and immutable caller records.

Tests are isolated fixtures. This verifies report-selection behavior, not the factual correctness of an imported final, improved prediction accuracy or economic performance. Original stored records, study captures and installed models are unchanged.

## Remaining limits

The horizon report is descriptive and does not authenticate arbitrary arrays, enforce a historical as-of cutoff on label availability, or verify journal hash chains/adjudication receipts. Guild/horizon correlation and game-IID bootstrap assumptions still need separate review; no new independent-sample claim is made. Broader summary selection/chronology, historical feature availability, provider clocks, source completeness, executable prices and settlement truth remain unfinished.

Sports is offline; installed configuration/startup unverified. No merge, deployment, promotion or live trading. Sports remains in progress; Crypto then Stocks remain queued.
