# Local price-receipt chronology — report v3

The price audit now retains the provider fetch clock needed to test whether a quote was locally available at the frozen decision time. This repairs research provenance; it does not improve a forecast's probability, establish an executable price or recover missing medical data. Predictive model identity remains **v6.0.69**. Registered source archives and their approval identities are unchanged.

## Confirmed gap and repair

`predictionJournal.js` previously preserved bookmaker update times but discarded `game.odds.fetchedAt` from its immutable odds snapshot. `priceResearch.js` checked quote updates against evaluation/append times without an independent local fetch-receipt check. A fabricated qualified decision with an old quote fetched after its evaluation could therefore enter a counterfactual scenario. Controlled reproductions establish this mechanism, not an actual misplaced wager or an observed profit error.

New initial forecasts and linked price-only observations freeze `odds.sourceReceipt` using `oddsReceiptSnapshot` in `oddsPricing.js`. It records a canonical explicit-zone local fetch/revalidation time, a fixed schema/kind and an explicit missing/invalid status. Invalid input text is not copied into this receipt. A local receipt is not a provider publication timestamp or proof of continuous offer availability.

Report schema **sports-frozen-price-research-v3** requires:

1. A verifiable declared local receipt, otherwise `provider_receipt_unverified`.
2. Receipt no later than the frozen evaluation, otherwise `provider_receipt_after_decision`.
3. Selected quote update no later than that receipt, otherwise `quote_update_after_provider_receipt`.
4. All existing event/model identity, same-book outcome, quote freshness, original price, uncertainty-selection and result-conflict requirements.

The resulting clock order is quote update <= local receipt <= evaluation <= journal observation < event start. Price refreshes may legitimately arrive after the original model generation: their exact linkage retains the original probabilities and model time. The report includes receipt age and quote-to-receipt lag in milliseconds; neither is a source-publication or execution-latency measurement.

Legacy receipts are never inferred from journal append time, backfilled from the current slate or written into archived forecasts. An identical legacy issuance retry preserves its original bytes and hash chain. A valid non-wager forecast is still issued when its price receipt is missing; unsupported price research remains excluded. Report results can consequently differ from v2 for old qualified decisions with insufficient receipt evidence. Existing model/value thresholds and scoring formulas are unchanged. Any changed source bundle still needs its own exact artifact review; this phase does not promote a model or substitute source in either registered trial.

## Verification

The pre-edit full baseline passed **1,256 tests**. Six initial focused tests failed on the previous implementation, including missing chronology gates, absent frozen/report fields and legacy exclusion. Eight new tests cover the real journal issue and linked price-refresh paths, legitimate later prices with frozen model identity, missing/invalid receipts, late receipt/update rejection, equivalent explicit instants, unchanged costs/input records and byte-preserving legacy retry.

Focused price/journal/value checks pass **68 tests**. Full `npm test` passes **1,264 tests**, zero failures/skips. `npm run check` parses **238 files**. Whitespace checks pass. Test results verify software behavior, not forecasting quality or after-cost performance.

## Actual read-only evidence

At **2026-10-24T16:08:29.533157+00:00**, the current audit CLI read the original v52 and current v69 journals with credentials absent and HTTP/fetch calls blocked. Both journals were byte-identical afterward:

| Preserved study | Issued forecasts | Frozen qualified price decisions | Supported scenarios | First exclusion |
| --- | ---: | ---: | ---: | --- |
| Registered v52 trial | 12 | 0 | 0 | 12 `no_frozen_qualified_price_decision` |
| v69 engineering diagnostic | 21 | 0 | 0 | 21 `no_frozen_qualified_price_decision` |

These overlapping studies are separate cohorts, not 33 independent games. Neither has local receipt fields in its original forecast rows; those rows remain unchanged. The absent-decision gate was decisive, so downstream receipt, settlement and cost gates were not evaluated for those rows. There is no observed zero P&L or measured positive/negative expectancy. All performance/profit fields remain null and promotion stays disallowed. The explicit sensitivity assumptions (1% per stake, 2% profit commission, 1% profit haircut) are illustrative, not verified bookmaker tariffs. Zero provider requests, orders or Discord posts occurred.

## Remaining full-scope work

Real original offered prices, book-specific settlement/void/overtime terms, executable limits/fills and independent costed outcome evidence remain unverified. Injury/confirmed-goalie coverage remains missing; the earlier official NHL boxscore denial was not retried or bypassed. Adequate independent multi-date proper-score/calibration and model-selection evidence is still required. The source-pinned Sports collectors and final reconciliation schedule remain unchanged, as does the Stocks automation. Sports remains offline; no production startup, main merge, deployment, promotion or trading occurred. Crypto then Stocks remain queued after full Sports completion.
