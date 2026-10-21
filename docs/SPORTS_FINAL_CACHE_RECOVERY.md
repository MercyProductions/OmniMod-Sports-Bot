# Scoped final-cache conflict recovery

October 21, 2026. Forecast model identity remains v6.0.45. No model weights, probabilities, risk controls, credentials or production configuration changed.

## Confirmed bottleneck

The revision guard correctly stopped stale whole-cache replacements, but `sports-bot/src/index.js:313` (`checkFinalScores`) still rejected the entire completed final refresh when a quote-only change or unrelated cache update occurred during source retrieval or Discord delivery. Durable journals and delivery claims survived, but the cache grades/acknowledgements waited for another reconciliation attempt. Repeated harmless updates could repeatedly delay them.

The first regression in `sports-bot/test/final-cache-merge.test.js` reproduces that old scheduler write contract against actual storage: original-revision persistence rejects after a quote-only update. It then demonstrates successful scoped persistence without replacing the newer quote. This is a reproduction of the previous storage call, not an imported execution of the old logged-in scheduler.

## Repair and invariants

`sports-bot/src/index.js:334` now calls `persistFinalRefresh`. `sports-bot/src/finalCacheMerge.js:36` performs a three-way merge: the exact source-request input, its completed result, and the current cache. `persistFinalRefresh` at line 88 freezes its inputs before reading and retries revision conflicts at most three times by default. It never repeats provider calls, Discord sends or grading during that retry. Other storage errors are not retried; missing caches are not silently recreated.

Each event must still resolve uniquely against the original scope. Its current event observations must match the original apart from quotes, and its current forecast/grade must match apart from value analysis. Refreshed probabilities and model identity must remain the original frozen forecast. Changed participants, forecasts, results, ambiguous/missing current events and independently newer delivery acknowledgements are rejected by event with structured reasons. A changed event does not prevent an independent unchanged event from being merged.

The merge preserves current odds, value analysis, unrelated/new events, message IDs, pending publication state and other current slate fields. Newer acknowledgement generations remain protected. Conflicting source finals retain both observations and the cleared grade supplied by final-source reconciliation; the merge does not choose a score by array order.

Source diagnostics, manual-result audit and association rejections are retained under `finalCacheMergeAudit` alongside source/target revisions, applied-event count and event rejection reasons. The existing general diagnostics/freshness fields remain those of the current slate. A partially rejected batch does not advance the global correction-check timestamp and pretend all events were reconciled. Immutable journal/claim records remain the underlying evidence; this cache audit is a replaceable last-operation summary.

## Verification

- Prior full suite reproduced: 642 passing tests.
- Eleven added tests cover the original quote-only conflict, changed forecasts, newer results/acknowledgements, league collisions, independent event progress, source conflicts, a real intervening cache write, bounded retries, other storage failures, scope mismatch and caller mutation.
- The integration test uses the actual final publisher, local fake Discord and delivery claim chain. A quote update occurs after remote acceptance and before acknowledgement persistence. The final grade and claim acknowledgement reach the cache while the newer quote and original probability vector remain unchanged.
- Full repaired suite: 653 passed, zero failures/skips. Syntax and whitespace checks pass. Secret scans must pass before pushing.

These are correctness and persistence measurements. They do not demonstrate improved sporting accuracy, calibration or profitable wagering.

## Limits and remaining work

Conservative event rejection intentionally requires the next normal reconciliation to fetch against the newer input. No stale computation is forced onto a changed forecast. The bounded retry can still exhaust under sustained contention. Pregame and quote-command conflict recovery have separate requirements and are not implemented by this final-only helper. The production scheduler was not started or deployed for this verification.

Actual running-host/configuration/jobs verification, uncertain remote transport, reviewed legacy result adoption, complete source/settlement lineage and adequate independent prospective performance evidence remain unfinished. Both frozen NHL studies cover the same two games and must not be counted as independent samples. Sports remains in progress; Crypto then Stocks remain queued. No merge, deployment, model promotion or live trading; cPanel excluded.
