# Sports prediction accuracy audit — 2026-10-20

## Decision and evidence

The audit confirms defects in provenance, evaluation populations, refresh completion, feature missingness and final reconciliation. It does **not** establish why historical win rate reportedly declined, or prove that the repairs improve future accuracy. The available private local evidence covers one dated slate (2026-09-24): 29 games/predictions, none graded in that daily snapshot; the separate warehouse has 174 prediction rows and only five graded rows, without model-version identifiers, and no market snapshots or warehouse result rows. These populations cannot support a matched before/after comparison or betting-return claim. Private files were archived outside this repository; no credentials/runtime archives belong in Git.

All seven repositories preserve their original commit under `baseline/pre-readme-sports-audit-2026-10-20`. Sports baseline commit: `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`. The repair branch is `docs/setup-and-prediction-audit-2026-10-20`; the repaired prediction identity is **OmniMod Evidence Ensemble v6.0.1**. The npm package version remains 6.0.0 for compatibility. Source preservation is not a historical performance comparison.

## How a forecast is produced

1. `sportsData.js` gets supported-league schedules and available event summaries/history, with cached provider responses and optional official corroboration. HTTP/data failures and cache fallback must remain visible.
2. `autoEnrichment.js`, `advancedDatasets.js`, `advancedMetrics.js`, participation and situational modules construct team/player/context evidence. Manual intelligence can add context; it must not silently replace newer observations.
3. `predictionEngine.js` combines evidence, Elo, sport-specific estimates, optional learned candidates, market context, calibration and uncertainty. Heuristic probability estimates are not independently demonstrated accuracy.
4. `oddsValue.js` separately evaluates an offered price, freshness, evidence, calibration and bookmaker independence. The predicted team and a qualifying wager are different decisions. A likely winner can have negative expected value at the available price.
5. Pregame refresh windows update evidence before kickoff. Publication uses Discord embeds and durable daily state. Computing a forecast does not establish successful Discord delivery.
6. Final reconciliation grades the frozen side against the observed final. Versioned journals, warehouse evaluation and model-registry research have different retention and eligibility policies.

## Confirmed defects and repairs

| Area | Confirmed mechanism / implication | Development repair and verification |
| --- | --- | --- |
| Provider freshness | A future cache timestamp could have negative age and appear fresh. | Future/invalid receipts are unusable; do not reuse their conditional-cache metadata. `providerCache.js`; regression fixture. |
| Evaluation timing | Missing prediction/start times could enter a graded evaluation because validity was checked only when both existed. | Require valid pregame chronology. `modelEvaluation.js`; unknown-time regression. |
| Evaluation populations | Versions and forecast horizons could be pooled, counting correlated snapshots as extra evidence. | Explicit model/version/horizon cohorts; latest-per-game overall full-outcome scores; separate horizon counts. `modelEvaluation.js`, `horizonEvaluation.js`, `candidateCohorts.js`; cohort/duplicate regressions. |
| Forecast preservation | Updating a warehouse snapshot could overwrite the original issued probabilities/features while retaining other older fields. | First-issued forecast remains immutable; later finals update outcome information. Store model identity and capture policy. `featureWarehouse.js`; immutability regression. |
| Challenger comparison | Missing/malformed candidate vectors and mixed cohorts could invalidate comparisons; legacy/replay evidence could support an unjustified promotion. | Require valid matched vectors/outcome spaces and prospective, versioned provenance in production promotion. Refuse unsupported saved champions. `modelRegistry.js`, `candidateCohorts.js`; malformed/cohort/promotion tests. |
| ML chronology | Chronological row order alone did not prove training labels existed before holdout forecasts. | Require prospective records and all training labels resolved before the first holdout forecast before acceptance. Otherwise retain research metrics only. `localMl.js`; synthetic chronology fixture. |
| Historical replay | Processing earlier kickoffs as completed could expose their final labels to later kickoffs on the same date. | Conservative prior-date-only updates; explicitly report unavailable historical completion/as-of evidence. `historicalReplay.js`. Replay is not prospective validation. |
| Refresh completion | Rebuilding a slate could reset prior completion markers; fallback/failed evidence could appear completed and overdue scheduling could be unclear. | Preserve markers, require summary retrieval/revalidation during the attempt and a new pregame forecast; failed/stale windows stay pending. Separate failed publication retry. `pregameRefresh.js`, `index.js`; refresh regressions. |
| Manual precedence | Old/unknown manual records could override newer automatic evidence; context matching could fall through an explicit mismatched event ID. | Prefer newer automatic observations, reject invalid/future/expired overrides and explicit context identity conflicts. `predictionEngine.js`; three precedence tests. |
| MLB lineup feature | One missing lineup xwOBA was effectively treated as zero, manufacturing a large differential. | Difference is unknown unless both lineups are known; retain coverage classification. `advancedDatasets.js`; one-sided-lineup regression. |
| Soccer xG feature | Genuine zero, missing xG and score-derived fallback were conflated. | Preserve zero; identify shot proxies separately; leave unsupported xG unknown instead of substituting final score. `advancedMetrics.js`; zero/missing regressions. |
| Source provenance | Newly calculated profiles could conceal the age of the history from which they were derived. | Carry original history receipt times by side; unknown is unknown. `autoEnrichment.js`, `sportsData.js`. Receipt time still does not establish a fact's native update time. |
| Final reconciliation | Current-date checks could miss an overnight final; later cached horizons could displace earlier forecasts. | Revisit bounded prior pending dates, grade every journaled horizon/version and retry failed final delivery. Preserve canonical event IDs. `finalReconciliation.js`, `sportsData.js`, `index.js`; final/journal regressions. |
| Friend setup | A default Discord application ID belonged to the original installation. | Require the operator's own client ID with a token; blank public template. `config.js`, `.env.example`; config regression. |

The original-source regression runs reproduced six initial audit failures and three missing-data feature failures before their repairs. This is evidence of those defects, not evidence that they caused a particular day's losses. No coefficients, confidence thresholds, EV thresholds or bookmaker-count requirements were loosened to manufacture picks.

## Prediction and outcome records

The new mandatory `prediction-journal.jsonl` records every eligible computed pregame forecast, including withheld forecasts, independently of the optional warehouse. It freezes the chosen team, full probabilities, model/horizon, prediction and scheduled-start times, available offered odds/bookmakers/native timestamps, receipt/cache metadata and reference vectors. Finals append linked results for all original horizons; score corrections append revisions. Late/unknown legacy observations remain unverified, not backdated pregame evidence.

The writer uses an exclusive lock, append/sync and a verified digest chain. Malformed/torn/edited records fail visibly. This detects accidental corruption, not an attacker rewriting the entire file. Full-file verification at each write is a scalability limitation. A crashed process may leave a lock that needs careful operator recovery. The journal currently attests computation, **not Discord delivery**, user fills or bet execution. Details and recovery procedure: [PREDICTION_RECORDS.md](PREDICTION_RECORDS.md).

`npm --prefix sports-bot run audit:predictions` verifies local records and prints aggregate versioned/horizon results without provider requests. It distinguishes full-outcome proper scores from selected-side binary scores. Elo and available market references use matched events; the Elo reference is not the complete baseline pipeline. Market inputs can be stale or already used by the model and are not independent confirmation.

## Sport-by-sport assessment

| Family | Current evidence/model areas | Remaining validation / missingness concerns |
| --- | --- | --- |
| NFL / NCAAF | Football profiles, team form/strength, participation, schedule/context and specialist candidates. | Starting-QB/injury and unit continuity require timely source evidence; heuristic weights and uncertainty need league-specific forward calibration. A high upstream API percentage is not the bot's probability. |
| NBA / NCAAB / WNBA | Basketball ratings, pace/efficiency proxies, rotation/participation, schedule/rest and candidate models. | Late scratches, minutes restrictions and college roster turnover can dominate; absent reports cannot mean a healthy starting lineup. League populations must be evaluated separately. |
| MLB | Baseball specialist, starter/bullpen/batting/lineup fields where supported. | One-sided lineup defect repaired. Confirmed lineups, pitcher changes, bullpen availability and park/weather timestamps remain critical; missing advanced fields do not establish equivalent coverage. |
| NHL | Hockey scoring/strength evidence and goalie/player participation where available. | Confirmed starter versus projection, preseason lineups and small-sample team form need explicit uncertainty. A few hockey matches cannot validate the full system. |
| Soccer | Three-way outcome handling, xG/shot evidence, team/player/context fields. | Zero/missing-xG defect repaired. Shot proxies differ from native xG; league-specific draw calibration, correlated goal assumptions and lineup coverage remain research issues. |
| Tennis | Individual-player/surface/profile evidence where sources provide it. | Serve/return/surface fitness, retirements and market settlement require verified inputs; sparse coverage should not be presented as a rich player model. |
| Combat | Fighter/profile/form context where available. | Opponent strength, weight class, cancellations and method/round settlement are incompletely modeled. Do not infer betting edge from a favorite alone. |

The model family and feature names are not proof those fields are populated in a particular game. Audit coverage per forecast. Hand-chosen coefficients, draw priors, independent-scoring approximations and heuristic uncertainty remain assumptions needing validation. Existing price-value guards intentionally withhold unsupported settlement cases; the audit does not remove them.

## Odds and independence

Existing tests exercise American-odds conversion, expected return, quote freshness, multiple-bookmaker requirements, event identity and settlement restrictions. Those guards remain in place. Free schedule odds may be absent, old or single-book. A paid key improves available coverage only if the account/endpoint supplies the required market and timestamps; request/cost caps still apply. A current HTTP response containing an old quote is an old quote. Do not fabricate odds when unavailable or substitute closing odds for an earlier achievable price.

Model-versus-consensus difference is not automatically realizable edge. The model can include market information, and bookmakers may share inputs. A fair comparison needs a clearly separate baseline, same information cutoff, actual offered price and instrument-specific settlement. No ROI/backtest was manufactured from the small local data store.

## Verification and deployment state

- Preserved baseline suite: **109 tests passed**.
- Repaired development suite: **134 tests passed, zero failed/skipped**, using `npm test` from the repository root.
- Configured JavaScript syntax checks: `npm run check` passed.
- Added coverage: cache/evaluation/warehouse regressions, journal persistence/integrity/locking/corrections, cohort and promotion guards, manual precedence, MLB/soccer missingness, overnight reconciliation and configuration identity.
- These are deterministic unit/integration fixtures. They do not verify production provider entitlements, live lineup accuracy, Discord delivery or future forecast performance. No live worker or paid provider probe was started for this audit.
- Setup READMEs are published separately. Sports behavior changes remain on a review branch; no production deployment or live credentials were changed.

## Required next evidence

1. **Blocked on archives:** obtain original pregame snapshots and results from both reported performance periods, preserving dates/version/odds/source times. Do not retroactively guess absent metadata.
2. **Pending forward paper validation:** run v6.0.1 in an isolated research environment with its own data directory; retain all eligible games, unresolved outcomes, failures and corrections. Do not duplicate production posting.
3. **Pending paired comparator:** freeze a separately identified baseline using the same as-of inputs and event population. Do not compare newly repaired forecasts against an older easier sample.
4. **Pending statistical report:** proper scores, reliability/calibration, sample size and intervals by league, horizon, confidence, favorite/underdog, data coverage and calendar period; account for correlated days/guilds/horizons. Declare exclusions before scoring.
5. **Pending costed wagering research:** only where actual offered prices/settlement/fees and feasible timing exist; report profit/loss, drawdown, exposure and uncertainty alongside accuracy. Win rate alone is insufficient.
6. **Pending operational validation:** source entitlements, native fact timestamps, delayed Discord retry behavior, provider budget, full-journal growth/locking/recovery and bounded final lookback. Older unresolved finals require reconciliation.
7. **Pending review/deployment:** review the repair diff and operational migration, preserve runtime backups, then explicitly schedule any production update. No automatic promotion is justified by these tests alone.

## Source entry points on the repair branch

- [providerCache.js:58](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/providerCache.js#L58) — inspect the repair-branch diff for the changes discussed above.
- [modelEvaluation.js:99](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/modelEvaluation.js#L99) — inspect the repair-branch diff for the changes discussed above.
- [horizonEvaluation.js:21](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/horizonEvaluation.js#L21) — inspect the repair-branch diff for the changes discussed above.
- [candidateCohorts.js:2](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/candidateCohorts.js#L2) — inspect the repair-branch diff for the changes discussed above.
- [featureWarehouse.js:312](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/featureWarehouse.js#L312) — inspect the repair-branch diff for the changes discussed above.
- [modelRegistry.js:100](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/modelRegistry.js#L100) — inspect the repair-branch diff for the changes discussed above.
- [localMl.js:175](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/localMl.js#L175) — inspect the repair-branch diff for the changes discussed above.
- [historicalReplay.js:59](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/historicalReplay.js#L59) — inspect the repair-branch diff for the changes discussed above.
- [pregameRefresh.js:53](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/pregameRefresh.js#L53) — inspect the repair-branch diff for the changes discussed above.
- [predictionEngine.js:490](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/predictionEngine.js#L490) — inspect the repair-branch diff for the changes discussed above.
- [advancedDatasets.js:21](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/advancedDatasets.js#L21) — inspect the repair-branch diff for the changes discussed above.
- [advancedMetrics.js:202](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/advancedMetrics.js#L202) — inspect the repair-branch diff for the changes discussed above.
- [predictionJournal.js:88](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/predictionJournal.js#L88) — inspect the repair-branch diff for the changes discussed above.
- [finalReconciliation.js:2](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/finalReconciliation.js#L2) — inspect the repair-branch diff for the changes discussed above.
- [sportsData.js:741](https://github.com/MercyProductions/OmniMod-Sports-Bot/blob/docs/setup-and-prediction-audit-2026-10-20/sports-bot/src/sportsData.js#L741) — inspect the repair-branch diff for the changes discussed above.
