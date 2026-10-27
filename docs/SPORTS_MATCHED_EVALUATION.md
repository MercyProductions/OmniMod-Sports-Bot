# Matched forecast evaluation — October 20, 2026

## Confirmed report weaknesses

The pre-change development baseline had 147 passing tests. The journal's reference comparison selected rows merely because a reference probability object existed. Invalid reference vectors could therefore enter the primary population while being dropped by the reference scorer. The selected-outcome binary summary counted every issued horizon/revision, so repeated forecasts of one game increased its apparent sample count. The report did not provide paired uncertainty estimates for differences between the issued champion and frozen challenger/reference vectors.

`journalEvaluation.js` now validates reference vectors before either side enters the older descriptive reference report. Its binary summary uses the first issued forecast per event/version across guilds and horizons. The authoritative new `matchedForecastComparisons` section is provided by `matchedJournalEvaluation.js` and read through the existing hash-checked `audit:predictions` command.

## Matched methodology

1. Accept only lifecycle-issued, observed-pregame records with generated <= issued < start, known event/version/horizon identity and valid primary probability mass.
2. Select the first issued record per guild/event/model-version/horizon before inspecting comparator availability. Later revisions remain auditable but cannot be cherry-picked for good outcomes.
3. Use only results observed no earlier than scheduled start and no later than their journal receipt; respect an explicit report as-of time. Later corrections cannot leak into an earlier report. Schedule changes and conflicting game outcomes are excluded rather than resolved in favor of a model.
4. Compare the issued champion with each predeclared evidence, hybrid, specialist, ML, Elo and market vector frozen at that same issue. Each comparison uses identical primary/reference observations and matching two-way/three-way probability spaces. A missing reference is not reconstructed.
5. Market matching additionally requires offered quote timestamps no later than generation and at most 30 minutes old for every represented outcome. This is a declared reporting filter, not a production betting rule. It does not prove execution, independence or an available closing price.
6. Within a model version, give each league/event/start-time identity one total weight, shared across its guild/horizon observations. Compute accuracy, mean-coordinate multiclass Brier, multinomial log loss and selected-outcome calibration. Preserve game count separately from forecast count.
7. Resample complete games jointly for paired primary/reference and difference intervals: 300 deterministic bootstrap replicates by default, bounded to 100–2,000. Return null intervals below eight distinct games. Higher accuracy differences and positive reference-minus-primary Brier/log-loss differences favor the issued forecast descriptively.

The same comparison is reported by frozen sport, league, horizon, confidence bucket, favorite/underdog class, season/type, roster-transition band, injury and starter coverage, source receipt freshness and market-price availability. Missing metadata remains unknown; season type is not inferred as regular, and starter records are not described as a verified full lineup. Model versions are separate populations. New journal records freeze available sport/season metadata; older inputs are never backfilled.

The earlier horizon summary remains a latest-forecast descriptive view with its own documented selection rule. Use the explicitly named matched section for paired differences, game weighting and first-issue comparisons. Neither view is connected to registry promotion.

## Verification

`npm --prefix sports-bot test`: **157 passed**. `npm --prefix sports-bot run check`: passed. Ten added regression tests cover malformed/missing references, issuance/result/schedule chronology, first-issue selection, repeated game/guild/horizon cluster invariance, conflicting finals, outcome-space mismatch, quote timestamps, version/coverage strata, as-of correction isolation and numerical three-way Brier calculations. The existing journal test now confirms that two graded horizons still yield one binary game observation.

`npm --prefix sports-bot run audit:predictions` ran read-only in the development environment. It contains no prospective issued forecasts or matched real-game results; no before/after accuracy difference is available. Test fixtures establish implementation behavior only.

## Still unfinished

- A complete frozen v6.0.0 pipeline comparison requires matched point-in-time inputs and separately recorded baseline predictions. Elo and candidate components are not substitutes for that missing full baseline.
- Game-cluster intervals do not eliminate cross-game dependence within teams, dates or leagues. They are descriptive, unadjusted for multiple model/stratum comparisons, and cannot justify model selection or deployment.
- The model-registry chronology, repeated evaluation of holdouts, per-sport calibration and controlled shadow-selection requirements still need their dedicated audit.
- Offered prices and forecast accuracy do not establish costed wagering returns, fill quality or settlement correctness.
- Isolated prospective collection, actual Sports hosting/runtime verification and live source coverage remain unverified. No model was promoted and no live bot was changed.
