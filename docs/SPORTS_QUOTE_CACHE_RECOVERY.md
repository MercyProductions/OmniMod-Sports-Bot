# Explicit quote cache recovery and rejection audit

October 21, 2026. Forecast model identity remains v6.0.45. No forecast weights, risk thresholds, provider budget, credentials or production configuration changed.

## Confirmed defects

`sports-bot/src/index.js:1022`: the explicit value-refresh command previously read the latest cache, merged a completed provider response, and made one save attempt. A concurrent update between that read and save correctly triggered revision rejection, but discarded persistence of otherwise usable prices until a later operation. Retrying the provider itself would unnecessarily consume another budget slot.

`sports-bot/src/quoteRefreshIdentity.js`, `mergeValueQuoteRefresh`: equal receipt times did not establish an order between differing explicit quote payloads, but the old `previous > fetched` test permitted replacement. A regression using two independently parsed synthetic provider responses with the same receipt timestamp demonstrates the old helper replacing the current home price of -150 with the incoming -250. This is a deterministic old-helper failure, not evidence about actual offered market prices.

## Repair

`sports-bot/src/quoteCachePersistence.js:5` freezes the issued response before asynchronous work and retries only cache reconciliation, at most three times by default. Every attempt reads current state, reapplies the established scoped forecast/event/receipt checks, uses a newly read clock and saves with the current revision. It never invokes a provider, reserves a budget slot, issues a forecast, journals a duplicate observation or sends Discord messages. Missing caches, scope mismatch and non-conflict storage failures stop rather than retrying or resurrecting state.

`mergeValueQuoteRefresh` retains its existing scope, identity, participant, start-time and newer-receipt gates. Differing explicit snapshots with equal receipt times now remain unapplied instead of selecting by arrival order. Identical snapshots remain eligible; no threshold was lowered. Quote freshness and the age of the frozen model remain subject to the existing value-analysis rules.

The cache records `priceCacheMergeAudit`: reconciliation time, events updated, and structured snapshot rejection reasons. Rejections distinguish changed/missing forecasts, ambiguous identity, games no longer pregame, participant changes, invalid receipts, newer cached quotes, conflicting equal-receipt snapshots and non-explicit price snapshots. Ambiguous issued rows are retained as rejection evidence, not chosen by array order. Rejected-row counts can include multiple conflicting snapshots for the same event and should not be interpreted as unique-event counts.

The command appends events updated and snapshot rejections to the provider status. A successful provider response therefore no longer implies that all prepared snapshots reached the current cache. The immutable provider-attempt audit and price-only journal remain separate: this cache audit is a replaceable last-reconciliation summary, not delivery or execution proof.

## Verification

- Reproduced previous full suite: 653 passed.
- Nine added tests exercise a real intervening cache write, preservation of another league's result/acknowledgement, newer forecast/quote preservation, crossing kickoff during retry, bounded retries, other disk failures, scope/missing-cache gates, caller mutation, ambiguous snapshots and equal receipt conflicts.
- The retry integration invokes the actual quote-refresh builder with an injected provider response and real cache storage. The cache write races once and succeeds on its second attempt. Provider calls remain one, external-call count one and the reserved budget count one. Original probabilities and unrelated cache state remain unchanged.
- The equal-receipt test fails against the preceding helper with the wrong retained price. It passes with the new conflict gate.
- Focused quote identity/provider-budget/attempt-audit checks: 43 passed, including real child-process exits from the existing audit tests.
- Full repaired suite: 662 passed, zero failures/skips. Syntax and whitespace checks pass. Credential comparisons and Gitleaks must pass before pushing.

Tests use synthetic/injected provider data and isolated local storage. No paid API, live Discord command or production scheduler was invoked. Neither test volume nor successful persistence proves better sporting accuracy or wagering value.

## Remaining requirements

Bounded retries can exhaust under sustained contention. A quote may become stale while an uncontended filesystem write is pending; downstream value rendering still checks freshness, but there is no atomic transaction spanning clock, storage and external market availability. Equal-receipt conflicts require later independently timed evidence; this repair does not reconstruct ordering. Targeted pregame refresh conflict recovery remains separate work.

Actual running-host/configuration/jobs verification, reviewed legacy result adoption, complete source/settlement lineage and adequate independent prospective performance evidence remain unfinished. Sports stays in progress; Crypto then Stocks remain queued. No merge, deployment, model promotion or live trading; cPanel excluded.
