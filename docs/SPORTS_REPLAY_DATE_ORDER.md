# Historical replay date ordering and explicit unknown clocks

This phase repairs a reproduced retrospective learning leak. It does not certify historical source publication times, recover medical inputs or validate a new champion. Predictive model identity remains v6.0.69; the replay report has its own version/protocol. Existing frozen forward studies keep their exact source, probabilities and approval identities.

## Confirmed defects

`historicalReplay.js` sorted raw `startTime` text, but applied results whenever `dateKey` changed. Valid timezone representations can interleave those date batches. For example, a game on local October20 starting at October21 00:30Z sorts after a local October21 game written as October21 00:30-05:00, although the latter actually starts five hours later. The replay could therefore update team state using the later result before constructing the earlier forecast.

The controlled reproduction changed only the later result. Before repair, the earlier evidence home probability changed from **0.6297722391 to 0.5803005220**, and its team history incorrectly included three games. After repair, both runs produce **0.6107771632** from two prior games. These are synthetic mechanism measurements, not real forecasts or performance results.

Calendar-invalid cutoff/result dates and timezone-naive or impossible supplied event clocks were also accepted. Missing starts became invented noon timestamps in replay output. This weakened the meaning of chronological research metadata even though separate prospective training/selection gates already prevented these replay-only rows from authorizing a model.

## Implementation

- `sports-bot/src/historicalReplay.js:44` validates exact real calendar dates. Invalid explicit cutoff arguments fail with a fixed error that does not echo their values.
- `historicalReplay.js:72` excludes invalid result dates, supplied event clocks and scores before any state update. Valid excluded/future dates and row-cap omissions have separate audit counts.
- `historicalReplay.js:83` sorts complete date batches first and explicit event instants numerically within each batch. Same-date labels remain unavailable to every forecast in that batch.
- `historicalReplay.js:160` normalizes supported explicit-zone starts, including native minute precision. A missing start stays null with `eventStartStatus: missing`; date-only records remain explicitly limited retrospective research rather than acquiring an invented event time.
- Report version2 / `canonical-date-batches-event-instants-v2` declares `retrospectiveOnly: true`, `promotionAllowed: false` and structured input rejection/cap/unknown-clock counts. `sportsData.js:845` carries those diagnostics into the existing slate replay summary.

The existing minimum-history requirement, row-cap policy, forecast formulas, cost/risk thresholds and prospective eligibility gates are unchanged. Report vectors/features can change where old sorting leaked a later label. Any changed source bundle still needs exact artifact review; no registered trial is silently upgraded and no model is promoted here. Actual result-availability clocks remain unknown: even a correctly ordered prior-date replay is not a point-in-time source attestation or prospective holdout.

## Verification

Pre-edit `npm test`: **1,264 passed**. Seven of eight new tests failed on the prior source, including missing protocol/diagnostic assertions; these are not seven independent model failures. The eight cases cover future-label invariance, equivalent timestamps, same-date isolation, strict cutoff/input calendars, explicit unknown starts, minute precision/caps and existing training/selection exclusion of retrospective rows.

Focused replay/loss/selection checks: **61 passed**. Full `npm test`: **1,272 passed**, zero failures/skips. `npm run check`: **239 files**. Whitespace checks pass. These checks prove software mechanisms, not better predictive performance.

## Actual saved-history comparison

A read-only comparison at **2026-10-24T16:24:34.340584+00:00** used the 47 previously saved native NHL finals, fetched at 03:46:53.244Z with cutoff October23. Input SHA256 remained `0e177575e3361397f98221cccbf08370415b5dfc884958beca76b5c5c4abe89a`; no bytes changed. The comparison ran the prior replay module from commit `75e7ff9...` and current replay with the same unchanged dependencies. It is a specific helper comparison, not two independently archived entire production models.

Both implementations retained 47 rows and produced 11 replay predictions. The new audit rejected zero rows, had zero cap omissions and zero missing starts. All compared probabilities, feature vectors, prior-game counts and event order were numerically identical. This corpus did not demonstrate the mixed-offset defect occurring in actual native data or an improvement after repair.

| Retrospective recipe | Predictions | Mean-coordinate Brier | Log loss |
| --- | ---: | ---: | ---: |
| Evidence reference | 11 | 0.2340129028 | 0.6608666142 |
| Hybrid reference | 11 | 0.2373894232 | 0.6677306520 |

The before/after scores are identical. The small, score-only retrospective sample lacks original publication/availability and full lineup/medical context. It does not justify choosing either recipe, recalibration or a profitability claim. The existing ML-training gate produced no model/evaluation rows from the 90-game retrospective fixture; that is an eligibility control, not failed model optimization.

## Remaining full objective

Genuine injury and confirmed-goalie coverage is still missing. The last denied NHL boxscore request was not retried or bypassed; no new provider request occurred in this phase. Optional authorized-provider support remains unconnected. Adequate independent multi-date forecast/calibration/model-selection evidence, original offered-price/settlement/cost research and remaining operational verification are unfinished. Source-pinned Sports collection and Stocks schedules remain unchanged. No main merge, startup, deployment, promotion, credential change, orders or Discord posts occurred; live trading remains disabled. Sports stays in progress before the full queued Crypto then Stocks specifications.
