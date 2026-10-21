# Sports journal event association and disputed labels

Development model identity: v6.0.32. This phase changes evidence eligibility, not prediction weights, risk limits or deployment configuration.

## Confirmed defects

The journal previously built a last-write-wins map keyed only by native game ID. Shared IDs could suppress another league's result, and contradictory observations could choose whichever final appeared last. Issued forecasts could also be graded against a different scheduled start. A later dispute had no durable eligibility overlay: report readers independently selected the last result, so an earlier accepted label remained usable.

The original committed writer was replayed against the nine new event-integrity regressions: seven failed and two passed. This is synthetic defect reproduction, not an accuracy backtest. The complete pre-change suite had 447 passing tests.

## Implemented behavior

- [Event association](../sports-bot/src/journalEventMatch.js) indexes all observations for a native ID, then filters by available league and exact canonical scheduled start. Byte-equivalent canonical object content coalesces; conflicting content is ambiguous, including conflicting source/context fields. No arbitrary newest observation wins.
- [Journal issuance and grading](../sports-bot/src/predictionJournal.js) persist structured, deduplicated association rejections without anchoring a failed candidate as an issued forecast. A unique valid retry can issue. Known start changes cannot reuse an already anchored forecast ID.
- Shared-ID acknowledgements include scoped forecast proofs. The compatibility game-ID acknowledgement is withheld if any supplied prediction with that ID is unverified. This prevents the existing refresh caller from acknowledging partial success as complete success.
- Ambiguous observations or a same-league start mismatch create a durable result conflict. Both an ungraded forecast and a previously graded forecast become unresolved for downstream evidence use. A conflicting start is conservatively quarantined even if the provider may have reused its native ID; operator investigation remains necessary.
- A later unique final can resolve the conflict only with a receipt strictly after the conflict was recorded, at or after the original start, and no later than the current observation clock. The new result explicitly references the conflict ID. Cached, missing and future receipts cannot readmit the label. Original forecasts and earlier results remain unchanged; the new outcome's availability is never backdated.
- [Shared result eligibility](../sports-bot/src/journalResults.js) is consumed by journal summaries, matched evaluations, operational monitoring, offered-price research, unfinished selection reviews, warehouse-review preparation, and current reviewed warehouse learning proofs. Cutoff-aware reports apply their cutoff before evaluating conflicts. A disputed result is unresolved, not a loss or a profitable outcome.
- [Quote refresh](../sports-bot/src/valueQuoteRefresh.js) carries the original forecast horizon; price linkage requires the original generation, event start, league and model/horizon. Quote-only observations do not issue another predictive forecast.

Journal summary and operational diagnostics expose association rejection and pending conflict counts. Historical GRADED lifecycle events remain in the audit chain; current eligibility comes from the shared result state, not that historical state alone.

## Verification

`npm test`: **460 passed, zero failed, zero skipped**. `npm run check` passes. New tests cover league collisions, independent delivery/results, incomplete shared-ID acknowledgements, schedule mismatch, ambiguous issuance and retry, identical duplicates, conflicting finals with and without prior results, durable idempotence, stale/future recovery receipts, explicit reconciliation, immutable forecasts, original-horizon quote linkage, cutoff-aware matched scores and price returns, selection blocking, and invalidation of an applied warehouse learning proof.

All observations in these regressions are synthetic. No real final was resolved, operator adjudication applied, Discord message sent, model promoted, deployment performed, or trading enabled. No change in predictive accuracy, calibration or after-cost performance has been established.

## Remaining work and operational limits

Event identity is not yet uniformly scoped throughout the mutable slate, Discord publisher, refresh bookkeeping or upstream discovery. The journal now fails closed at its boundary; those other components need a separate caller-by-caller audit. Previously finalized research reports are immutable and are not automatically retracted by a later conflict. Source receipts attest collection time, not independently authenticated source truth. Full raw revision lineage and other compact timestamp contracts still require work.

Exact-start matching intentionally does not silently relabel postponed/rescheduled games. A reused native ID or genuine schedule correction can therefore remove an old label pending explicit reconciliation. A fresh receipt can resolve only observations matching the original start; this is not general schedule adjudication. Missing leagues in legacy predictions can associate only when the remaining ID/start observations are unique.

Actual-host version/configuration and scheduled jobs remain unverified; cPanel is excluded. The original two-game prospective baseline/challenger captures are preserved, with insufficient outcomes to establish improvement. Sports remains in progress, followed by the full queued Crypto and Stocks work. No merge or production deployment is authorized by this phase.
