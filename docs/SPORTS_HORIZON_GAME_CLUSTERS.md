# Horizon equal-game weighting and uncertainty

## Confirmed defect

The descriptive horizon report counted selected guild/event rows as separate samples and bootstrapped individual rows. Copies of one game could dominate point estimates or make a seven-game population exceed the eight-row interval gate. String/input order also changed a deterministic bootstrap's sampled rows. This violated the requirement to account for correlated forecasts of the same game.

## Repair and contracts

`sports-bot/src/horizonStatistics.js:31` groups already validated scored rows by canonical league/string native ID/explicit-zone scheduled start, excluding guild. Each game has one unit of weight in each table; its record-level scores share that weight. This is an average of recorded forecast scores, not an ensemble probability or a newly selected trading model.

- `sampleSize` and `gameClusters` now mean distinct scoped games. `forecastCount` preserves raw selected record count. `unscopedForecastCount` reports records lacking game identity; such records cannot manufacture independent game clusters.
- Accuracy, Brier, log loss and calibration use equal-game weights. Calibration bins expose probability/frequency and their game weight.
- Closing-edge averages give one weight to each game with at least one eligible snapshot; within-game available edges are averaged. `closingSampleSize` is games, and `closingForecastCount` is quote-bearing records. No missing quote is filled with zero.
- `horizonStatistics.js:13` resamples pre-aggregated game clusters for 300 percentile-bootstrap replicates. Accuracy, Brier and log-loss bounds are null below eight scoped games. Canonical game/metric order makes input order immaterial. Replicate cost depends on game count, not guild-copy count.
- `horizonEvaluation.js` delegates summaries and explicitly describes latest eligible per-guild issue selection followed by equal-game weighting. Horizon/stratum populations overlap; their counts are not independent or additive.
- `sportsData.js:831` retains the distinct game and forecast-record counts in compact diagnostics.

Consumers of `sampleSize` must use its new game-count meaning rather than infer alert count. Existing reports remain unchanged on disk. One sub-1% regression fixture now supplies the league identity its known-game assertion requires; unknown legacy scope is not guessed.

## Verification

- Unchanged baseline: 760 passed.
- Ten added tests. Five report integration regressions fail on the previous horizon implementation; five analytic/scope tests verify the new statistics helper directly.
- Focused statistics, horizon, market, model and accuracy suite: 52 passed.
- Full suite: 770 passed, zero failures/skips. Syntax and whitespace checks pass.
- Twelve guild copies of one game remain one game and cannot produce intervals. Thirty-five records from seven games remain below the interval gate. Unevenly copying one game does not alter its weight; uniformly duplicating guild copies preserves point estimates and interval bounds. Reversing arrays preserves results.
- A hand-computed mixed-copy fixture validates weighted accuracy, Brier, log loss, calibration-bin weights and eligible-game closing edge. Missing scope and equivalent league/ID/time aliases are covered; distinct leagues/start dates remain separate.

All numeric comparisons are isolated fixture results, not real improved forecasting or economic returns. No forecast probabilities, installed models, production datasets, source/provider jobs or runtime changed.

## Limits and remaining evidence

Game-cluster bootstrap does not resolve cross-game day/team/league dependence, model selection bias, multiple comparisons or sparse calibration buckets. Eight games is an interval display gate, not a statistically sufficient promotion standard. UTC event-date counts are context, not proof of independent dates. Different guilds can have different forecasts within a game; these share one game's weight and are not independent trials. Strata can overlap the same game.

Source truth, historical feature/result availability, outcome/settlement semantics, journal-ID collision handling, full raw-capture equivalence and adequate independent prospective performance remain unfinished. Sports remains offline; installed configuration/startup unverified. No merge, deployment, promotion or live trading. Sports in progress, followed by queued Crypto then Stocks requirements.
