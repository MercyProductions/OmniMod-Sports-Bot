# Model decision and forecast horizon binding

## Confirmed defects

At source `d583452fd75cc73c7389291f2dc2dfaf8c09829f`, `predictionEngine.js` requested a registry scope from `modelContext.forecastHorizon` or defaulted to Daily, but did not return that scope in the prediction. `predictionJournal.js` independently classified its permanent identity using stage and post-computation generation lead time. A specifically requested Daily forecast 90 minutes before a game was consequently journaled as T-90. This was reproduced through the real predictor and journal, not an evaluator-only mock.

The slate builder also resolved registry scope from the stage without passing remaining lead time. An initial late-opening `daily` scan could therefore request a Daily model while its journal cohort was T-90. A second real builder/scoreboard/journal fixture reproduced the missing explicit scope. Both old-source regression cases failed; the old test source and output are preserved privately.

These are model-selection/measurement defects. A scope mismatch can choose the wrong approved cohort or misattribute performance; it is not evidence that a particular previous prediction lost because of it.

## Development v6.0.69

`src/forecastHorizonScope.js` selects one scope from an explicit supported request or the information-time bucket. Unsupported explicit requests fail with a fixed error. Unknown event starts are marked as a default without verified start; normal issuance still requires a valid pregame event time.

- `predictionEngine.js` passes that exact horizon to registry selection and returns `horizon` plus `forecastHorizonEvidence` containing the scope, origin and information cutoff.
- `sportsData.js` resolves the stage with remaining lead time and uses the same clock for the model's input cutoff. A late initial scan therefore uses the existing timing bucket consistently. Explicit caller scopes remain explicit.
- The permanent journal honors the emitted horizon and checks declared evidence against input/coverage clocks and generation time. Contradictory or future evidence cannot issue an eligible forecast. The declaration is frozen with the original record.
- Operational reporting distinguishes bound declarations, missing/legacy declarations and invalid supplied evidence. This is local consistency evidence, not independent authentication of the running process or publisher.

The legacy horizon normalizer is unchanged. Old records, cached predictions and their existing inferred identities are not backfilled or relabeled. Identical legacy retries preserve their original hash-chain bytes. New source/version/artifact identity remains separate from old model approvals and registered trials. No formula or risk/value threshold is lowered. **Scope selection changes can change which approved model is used, so numerical or predictive equivalence is not assumed.**

## Verification

Baseline: **1,247 passing tests** before modification. Added **nine tests** covering the two integration regressions, explicit versus inferred scopes, clock-boundary crossing, invalid requests/evidence, immutable declarations, legacy identity preservation and operational coverage.

- Focused scope/provider-refresh/selection/journal/horizon/operational checks: **107 passed**.
- Full default-parallel `npm test`: **1,256 passed**, zero failures/skips.
- `npm run check`: **237 files**. CRLF-aware whitespace checks passed.

The earlier separately frozen v67 capture contained 21 predictions, none generated within 120 minutes of kickoff; minimum lead was about 266 minutes. That inventory is not a reconstruction of missing model decisions. It does not establish whether other historical forecasts were affected.

## Actual current-source capture

A new pre-outcome engineering intent pins source `746fc0c903999a85cf6bdffda3946590cebf6f45` against the original baseline `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`. Baseline collection ran **2026-10-24T15:27:29.621–15:27:31.030Z**; current collection ran **15:27:31.152–15:27:33.330Z**.

Both roles returned 21 pregame forecasts: **12 NHL, eight NBA and one MLB**. The matched inspector retained **21 contemporaneous pairs**, with a 2,309 ms issuance gap, no unmatched/rejected pairs and no finals. Current scope declarations were **20 Daily and one T-90**. A read-only audit of the actual current journal verified **21 bound declarations, zero missing/invalid declarations**, with unchanged journal bytes. The T-90 row is an initial near-game scan classified under the existing bucket policy, not a completed targeted refresh at exactly 90 minutes.

The baseline retains legacy inferred scopes; no declaration is invented for it. Pairing remains descriptive and does not establish equivalent scoped-champion provenance. Provider availability varied compared with earlier captures: the old baseline also returned 21 here. Source snapshots were separate and roughly contemporaneous, not identical inputs.

Workers used the existing cold-start profile with learning, local ML, warehouse, replay, paid odds, official corroboration, boxscore collection and Discord/orders disabled. Baseline made **18 public requests/14 unsuccessful responses**, current made **31/14**, within the 32-request worker cap. No policy blocks occurred. Neither role had calibration samples or actionable predictions. Current coverage still had no fresh accepted summary, injury assertion or confirmed critical-role side; the optional alternate provider remains unconnected. This is not installed-learner, alternative-feed or all-league validation; no NFL forecast was collected.

These games overlap other engineering studies and the registered v52 trial. The intent forbids training or model selection from this diagnostic, pooling overlapping versions as independent games, or treating it as an untouched holdout. **There is no accuracy, calibration or profitability result yet.**

The existing final-only heartbeat now includes this exact fifth archived study. Only its prompt and update timestamp changed; name, status, cadence, expiry and target stayed fixed. It can reconcile eligible real finals but cannot create more forecasts, rewrite initial records, activate models or enter trades. The two registered-trial collectors and Stocks automation files remain byte-identical. Both registered trials retain their old source/artifacts; they do not silently validate v69.

## Source and Windows investigations

One direct free NHL boxscore probe at **14:50:00Z** returned **HTTP403**. The response/receipt hash was saved; no second event, altered headers or access workaround was attempted. The earlier successful FUT response contained no player-by-game goalie rows. No parser was invented for unavailable pregame confirmation data.

Official NBA reports are available at the [current report index](https://official.nba.com/nba-injury-report-2026-27-season/). Automated reuse permission was not established from the [terms](https://www.nba.com/termsofuse); no scraper was enabled. Existing authorized feed/snapshot support remains available without purchasing another subscription.

The historical zero-successor Windows ownership failure also remains unproven. A credential-free, real-process stress investigation completed **40 cases with four concurrent contenders each**, every case acquiring exactly one fenced successor. Each private store/diagnostic is retained. No anomalous count or fixture failure occurred; **this does not establish the old failure's cause or prove it fixed**. No production claim protocol was changed.

The unchanged v52 collector's tenth checked invocation completed at **15:34:45.330Z**: 12 distinct games/one date/zero finals, ten receipts and 97 provider blobs; ten free requests/three failures this run, 107 cumulative checked requests. Original source/plan/artifact/first forecast evidence and both-plan family integrity verified. Repeat captures do not increase independent sample size, and saved scheduling is not uninterrupted-wake proof.

## Remaining work

Clinical/confirmed-goalie source access, adequate independent multi-date proper-score/calibration evidence, real executable-price/cost/settlement evidence, the unresolved ownership incident and actual host/startup verification remain incomplete. Sports is user-confirmed offline. No main merge, deployment, startup, model promotion, credential change, order, Discord post or paid request occurred. Live trading stays disabled. Full Sports completion remains ahead of Crypto, then Stocks.
