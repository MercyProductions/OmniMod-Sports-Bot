# Specialist score means, missing inputs and current-source observation

October 24, 2026; development v6.0.67, implementation `90e7442d96d0493609da51419a852b6d7bcb6862`.

## Confirmed defects

Four old-source regressions reproduced:

1. Football calculated its win probability from the scoring difference once, but added that difference again when producing expected scores.
2. Negative game counts could make shrinkage divide by zero and produce nonfinite expected scores.
3. Boolean or blank scoring rates could become measured zero through numeric coercion.
4. Low observed point totals plus a directional adjustment could produce negative expected scores in football/basketball.

The football example below is a **controlled fixture**, not a real game or wager. Both teams have eight declared games; away scoring/allowance rates are 10/30 and home rates 30/10. The existing NFL prior and shrinkage produce means 16.25 away and 26.25 home, a 10-point margin.

| Output | Old implementation | Repaired implementation |
| --- | --- | --- |
| Mean margin used for the normal win probability | 10 | 10 |
| Expected away/home score | 11.25 / 31.25 | 16.25 / 26.25 |
| Difference of expected score means | 20 | 10 |
| Expected total | 42.5 | 42.5 |

This fixes a mathematical inconsistency. It does not by itself improve winner accuracy: ordinary valid-input NFL win probabilities in this case are unchanged. Current callers expose/store expected scores as diagnostics; the source search found no existing automated spread/total execution based on this field.

## Changes and boundaries

- Football score means now share one total and the same margin used for its probability. Basketball uses the same consistency helper. Existing coefficients, NFL/college/basketball deviations and 30/28-point caps remain.
- The mean margin is additionally bounded by the expected total so both score means remain nonnegative. This physical constraint can change probabilities for affected low-total inputs; it requires forward validation. It does not change any strategy, price, uncertainty, approval or risk threshold.
- Strict shared numeric parsing keeps booleans, blanks, objects and nonfinite values unknown. Genuine zero rates remain observed. Negative rates are unknown; only positive safe-integer declared game counts contribute shrinkage weight. A zero count remains distinguishable from a missing count.
- Scoring priors remain the existing values. `scoringEvidence` records declared counts, effective count weights, observed rates and fallback values. Declared counts do not independently verify a source period, publication time or statistical adequacy.
- An unusable aggregate score total or composite margin makes the Gaussian specialist abstain. The primary path falls back to its evidence vector, and does not label an unavailable specialist active. The original registry selection status is retained separately; no registry or champion is modified.
- Football and basketball specialist IDs advance to `v2`; overall model identity is v6.0.67. Existing source/artifact/version gates remain. Prior experiments are not relabeled or used to certify this source.

`scoreDistribution` identifies an **uncalibrated normal approximation to margin**, with its mean, deviation and total. This is not a full joint score distribution: nonnegative means do not give the normal margin law nonnegative joint-score support. Raw specialist probabilities and these assumptions now appear in `sportModel`; new issued journal records copy them into `specialistForecast`. Existing journal entries are not backfilled or rewritten. The first stored specialist forecast remains unchanged on retries.

Existing primary home-Elo/neutral-site policy was not changed. Fixtures verify swapped-opponent symmetry and no additional specialist venue term at a fixed primary logit. Actual venue/source truth and venue-specific calibration remain separate requirements.

Current code under `sports-bot/`: `src/sportModels.js:73` (input/count evidence), `:104` (normal mean constraints), `:113` (unsupported-input abstention), `:211` (basketball), `:225` (football); `src/predictionEngine.js:841` (fallback label), `:874` (specialist metadata); `src/predictionJournal.js:108` (immutable specialist snapshot).

## Verification

Baseline **1,170 passed**. Twenty new cases exercise the four reproduced defects, mean/total invariants, a known normal-probability value, opponent symmetry, unchanged caps, strict numeric missingness, zero/count distinction, Poisson input handling, unsupported-source fallback and immutable issuance. Focused **71 passed**; full default-parallel `npm test` **1,190 passed**, zero failed/skipped. Postcommit journal/selection/archived-worker checks **59 passed**. Syntax **227 files**; whitespace and public-source secret checks passed.

## Actual separately pinned v67 observation

The current-source diagnostic archives baseline `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed` and challenger `90e7442...`, with separate state, verified source/support files, capture/network receipts and empty account environments. A pre-outcome capture-intent file declares this an engineering diagnostic, **not a registered selection trial or untouched final holdout**. It overlaps previous versions and the original v52 study.

| Actual capture | Baseline | v67 |
| --- | --- | --- |
| UTC interval, October 24 | 12:33:34.517–12:33:35.728 | 12:33:35.819–12:33:37.892 |
| Pregame forecasts | 12 NHL | 12 NHL, 8 NBA, 1 MLB |
| Public requests / failures / policy blocks | 16 / 12 / 0 | 31 / 14 / 0 |
| Calibration samples | 0 | 0 |
| Actionable predictions | 0 | 0 |

The paired inspector admits **12 contemporaneous NHL pairs**, with a 2,169 ms capture-receipt gap; the nine NBA/MLB forecasts lack baseline counterparts and are not losses. No game had started at the last eligibility check; no outcome scores were available. Current output has nine directional leans and twelve withheld forecasts. All eight NBA point-model outputs had finite nonnegative score means consistent with their stored margins. There were **no NFL forecasts** in this capture, so it supplies no real forward NFL validation.

The existing bounded profile disables learning, local ML, historical replay, advanced datasets, paid odds, official-source corroboration, Discord and orders. It is a cold-start pipeline comparison, not an installed learner snapshot or all-market study. The repaired official-source path from v66 is not exercised by this profile. Missing injury/confirmed-goalie data and source failures remain visible. Request evidence and every original forecast are preserved; no new configuration or strategy was enabled in production.

The existing final-only heartbeat was extended to include this exact fourth study. Its name, schedule, status and target are preserved; only its prompt and update timestamp changed. It must not collect new forecasts, retrain, promote, adopt orphaned evidence or replace archived source. Original v59/v60/v61 studies stay unchanged. The original frozen v52 trial and Stocks automation files remain byte-identical. Scheduler continuity still depends on the PC/Codex being available.

The original v52 collector separately completed its seventh checked capture at **12:14:26.257 UTC**: 12 distinct games/one date/zero finals, seven receipts/70 provider blobs, 10 requests/three failures this run and 77 cumulative checked requests. Its source, registered plan/artifact and first forecasts remain unchanged; repeated observations do not increase independent games. Its 75-game/eight-date/14-day requirements do not validate v67.

## Remaining work

This phase establishes the exercised arithmetic/data-handling corrections and preserves a genuine current-source pregame sample. It establishes no accuracy, calibration, model-selection or economic improvement. Adequate independently governed forward evidence, original-price/settlement/cost research, remaining source/season/sample/venue truth and operational recovery/startup proof remain unfinished. NHL injury/confirmed-goalie coverage is still missing; no alternate preferred provider is connected.

No live trading, orders, Discord, paid requests, credentials changes, startup, merge, deployment or model promotion occurred. The research emergency stop remains enabled. Full Sports stays in progress before full Crypto, then Stocks.
