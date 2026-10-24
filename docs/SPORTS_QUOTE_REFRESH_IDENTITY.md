# Quote-refresh event and forecast identity

Development model identity: v6.0.40. This phase repairs quote selection, cached value views and delayed-response merging. Prediction probabilities, value-policy thresholds, risk gates and provider request budgets are unchanged.

## Confirmed defects

The previous `src/valueQuoteRefresh.js` joined forecasts and games by native ID alone, then used the same ID-only maps to replace quotes and issue price snapshots. A forecast from one league could qualify a different league's game sharing that ID. Updates could cross leagues or scheduled starts and create a price snapshot for the wrong forecast. Conflicting same-event observations were chosen by array order. Caller-owned input objects remained mutable across budget/provider awaits, and an event could start during the request without a second pregame check.

`src/index.js` repeated ID-only joins in both the paid-refresh cache merge and ordinary cached-value reads. An asynchronous response could replace newer quotes or compute values from a forecast different from the one used to request and journal the price observation.

## Repairs and relevant source

- `src/valueQuoteRefresh.js:69` clones the slate and captures options before waiting. Selection requires explicit league/start/ID scope, a unique source observation and an unambiguous scoped forecast. Mismatched or missing scopes and conflicting observations cannot consume request credits. Identical duplicate observations coalesce.
- `src/valueQuoteRefresh.js` keys updates by league/start/ID, not native ID. Only matching forecasts receive price snapshots; other league/start observations retain their quotes and model data. Games that started during the request cannot issue a new pregame price decision. A consumed request slot remains consumed even when no future market remains.
- `src/quoteRefreshIdentity.js` reuses the existing scoped association helpers. `refreshScopedPredictionValues` computes values only for a uniquely bound forecast/game. It applies the existing six-hour reuse limit using the original forecast timestamp when a separate model-as-of field was absent. Ambiguous/legacy unscoped rows remain visible with unavailable value analysis; they cannot display a borrowed opportunity.
- `mergeValueQuoteRefresh` checks guild/date, scoped event, full frozen forecast identity apart from value/snapshot metadata, scheduled future status, unchanged ordered team names and quote receipt ordering. A changed forecast, changed event or newer known quote prevents replacement. It does not overwrite probabilities, predictions or unrelated slate metadata from a delayed response.
- The `/sports value` handler and `readOrBuildTodaySlate` now call these shared helpers. Price observations still link to original forecasts; they do not create new winner forecasts or qualify additional calibration samples.

## Verification

The existing full suite was reproduced: **546 passed**. Temporarily restoring the previous quote-refresh implementation reproduced **seven targeted failures** covering league selection, cross-league replacement, different starts, missing/mismatched scope, conflicting observations, caller mutation and an event starting during the request. Repaired full suite: **557 passed, zero failed/skipped**. Syntax and whitespace checks pass.

The eleven new tests cover those defects plus cache merge conditions, ordinary value views, duplicate coalescing, actual isolated daily-cache persistence and price-journal linkage. Existing eleven quote-refresh tests continue to cover admin-only invocation, disabled/local-only budgets, missing credentials, cooldown/caps/concurrent claims, failed requests, stale quotes and calibration exclusion.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/quote-refresh-identity.test.js test/value-quote-refresh.test.js
```

All provider responses in these tests are injected synthetic fixtures. No paid API request, Discord login, wager or real-money order was made. These results establish implementation behavior, not predictive or economic improvement.

## Remaining limits and deployment requirements

The actual logged-in command handler and running host/jobs remain unverified. Helper integration, persistence and journal behavior were tested without starting the production bot. Cache merging still uses the existing read-modify-write storage path; it is not an atomic transaction across independent cache writers. A writer changing the cache after the latest read can still race the final write. Missing/unknown quote receipts cannot establish that one quote is newer than another, and no new source authentication is claimed.

Provider event-name matching and its existing time tolerance are unchanged. This phase prevents local forecast/game cross-association; complete upstream market identity, timestamp and settlement evidence still require audit. Strict explicit scope can suppress value analysis for legacy caches until a fresh model slate is built.

Any deployment requires separate approval, private-data backup, verification of the actual running source/configuration and testing in an isolated host copy. Sports remains in progress: legacy correction baseline adoption, remaining source lineage, actual host verification and sufficient prospective accuracy evidence remain unfinished. Crypto and then Stocks remain queued under their complete specifications. No merge, deployment, model promotion or live trading; cPanel excluded.
