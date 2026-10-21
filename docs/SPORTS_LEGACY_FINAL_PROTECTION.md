# Protect original results during legacy/lost-acknowledgement recovery

The forecast model remains v6.0.45. This phase changes delivery verification, not probabilities, trading risk limits or production configuration.

## Confirmed defect

`src/discordPublisher.js` discovered existing bot-authored results by scoped or legacy event footer. If the expected revision footer differed, it could then edit the existing message even when local cache/claim evidence did not supply the original frozen forecast. A current cached pick could replace the historical pregame pick after local-state loss. Event identity was being used as permission to rewrite forecast history.

The correction path also verified that a remote message belonged to the event, but did not require its current digest to equal the preceding digest held by the local claim. An unobserved remote revision could therefore be overwritten.

## Repair and behavior

- `postFinalResult` still discovers matching legacy/scoped messages, but discovery alone no longer authorizes an edit or a replacement send.
- An exact expected result digest can restore a lost acknowledgement with **no edit or send**. The digest binds event, score/outcome and frozen model/selection/vector identity; it is not inferred from similar-looking text.
- A correction requires bound previous message/channel IDs and a valid previous revision digest. Before editing, the remote footer must match that predecessor. An already-accepted desired revision remains recoverable after a timeout without another edit.
- Legacy bare/scoped messages without adequate revision evidence, changed cached forecasts and unexpected remote revisions remain untouched. `finalDelivery.js` records `correction_baseline_unverified`, releases its attempted claim and suppresses automatic rapid retries for that item. Healthy independent events remain publishable.
- No baseline is fabricated from the current cache, a team-name match, a displayed confidence number or the final outcome.

This deliberately tightens earlier legacy tests: two tests that treated event identity as sufficient to recover/rewrite a legacy result now require preservation. They still verify that one league's protected legacy message does not suppress another league's independent event.

## Verification

Baseline full suite reproduced: **625 passed**. Restoring the old publisher and batch workflow reproduced **four targeted failures**: changed-cache overwrite after local-claim loss, bare/scoped legacy rewriting, unexpected remote revision overwrite and an unbound boolean edit flag authorizing a correction.

Repaired full suite: **631 passed, zero failed/skipped**, plus syntax and whitespace checks. Six new regressions cover those failures and positive recovery of exact matching revisions and accepted-send timeouts. Existing correction, owner-fencing, failure/restart and source-refresh tests continue passing. Test transport is a local fake service; production Discord was not contacted or edited.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/result-correction-lifecycle.test.js test/final-delivery-integrity.test.js
```

## Remaining legacy and operational limits

This is **not** automatic adoption of an unverifiable legacy baseline. Older messages without a digest/original frozen evidence may remain uncorrected until independently reviewed original data is available. Missing original probabilities cannot be reconstructed from a rounded displayed confidence. No reviewed-adoption tool or production migration is claimed complete by this guard.

Digest recovery relies on the bot-authored message and cooperative claim protocol; it is not external authentication or an atomic remote compare-and-swap. Another uncooperative writer can still race a Discord edit after its read. Actual host/configuration/jobs, legacy evidence availability, cache transactions and prospective predictive improvement remain unverified.

Deployment requires separate approval, a private-data backup and isolated validation with the real configuration. Preserve old messages, claims, journals and caches; do not delete them to force a send. Sports remains unfinished, followed by the complete Crypto and Stocks requirements. No merge, deployment, model promotion or live trading; cPanel excluded.
