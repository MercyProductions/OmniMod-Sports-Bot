# Current-model prospective collection and scoped research association

The forecast engine remains v6.0.45. This phase collects new isolated evidence, repairs the prospective evaluator/planner and refreshes the requirement matrix. It does not deploy, change prediction weights, activate a model or enable trading.

## Actual collection

A private collection plan was saved before preparing a new study. It requested the first returned eligible observations from NBA/NHL/NFL/MLB for the current Chicago date, using bounded existing worker settings and a maximum paired receipt gap of 120 seconds. It was not a powered or independently registered model-selection trial.

- Baseline source: `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`, model v6.0.0.
- Challenger source: `1ffc59452dc387d65f7c5cd1355015376684a6f0`, model v6.0.45.
- Baseline collection: October 21, 2026, 12:44:23.638–12:44:24.720 UTC.
- Challenger collection: 12:44:24.868–12:44:25.517 UTC.
- Result: two receipt-verified role captures, two NHL pregame pairs, 788 ms receipt gap. Both games are scheduled for 23:30 UTC that day. Both roles withheld wager recommendations.
- Worker profile: archived tracked source, separate empty learner/data directories and credential-free environments; paid odds, advanced datasets, historical replay, local ML, Discord and live orders disabled. Shared installed dependencies are verified by path/lock; this is not an OS sandbox or a copy of the deployed learner.

Primary ESPN access returned 403; NHL CDN returned 404; official NHL schedule fallback supplied the two games. Other scoreboard diagnostics did not produce additional eligible slate games. NHL history/summaries were unavailable; the repaired challenger did not assume ESPN-native mappings for official NHL IDs. Critical starters, injury coverage and adequate history/calibration remain unavailable. No provider access denial was bypassed.

At 12:49 UTC, read-only reports showed two unresolved pairs and four role/game observations not started. No final queries were eligible or performed. Proper-score comparisons cannot establish improvement before outcomes exist, and this sample would remain far too small afterward. No paid price or executable wager evidence was collected.

The original study's manifest, receipt ledger and capture hashes were checked before and after reporting and remained identical. Its v6.0.7 challenger is preserved. Both studies cover the same two games; do not count them as four independent games. Private plans, manifests, hashes, raw captures and reports remain outside the public repository.

## Confirmed evaluator defect and repair

`src/prospectivePairs.js` previously used native-ID-only maps in both comparison and pending-final planning. Repeated IDs across leagues or starts could drop a game or attach a forecast to the wrong source observation. Contradictory forecast rows could qualify by first-row selection, and contradictory finals inside one capture could be silently reduced to the last row.

The evaluator now reuses the existing scoped game/forecast association helpers, coalesces identical observations, rejects mismatched declared scope and conflicting forecasts, and quarantines ambiguous final observations rather than grading or stopping their queries. Final work plans preserve the original league/start-bound forecast. Frozen capture objects are never rewritten. A later unique role observation may replace that role's disputed final state; cross-role disagreement remains unresolved.

The report schema is now `sports-isolated-paired-report-v2`. This changes read-only evaluation semantics, not the pinned engines or already-issued forecasts. Legacy forecasts with no declared league/start can still bind only to a unique source observation; that does not independently attest missing metadata.

## Verification

Reproduced full baseline: **618 tests pass**. Restoring the old prospective evaluator reproduced **six targeted failures** involving league/start collisions, mismatched scope, conflicting forecasts/source observations and conflicting finals. Seven added regressions pass, including frozen-input preservation.

Current full suite: **625 passed, zero failures/skips**, plus syntax and whitespace checks. Existing archived-worker tests verify source/state isolation and final reconciliation; new actual collection verifies the bounded public-data path. No production process or Discord destination was changed.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/prospective-pairs.test.js test/prospective-isolation.test.js
```

## Remaining requirements

Obtain eligible observed finals without relabeling missing outcomes, expand independent-date/league evidence, retain unmatched/withheld observations and assess proper scores with uncertainty. Resolve permitted source coverage and publication lineage, book-specific settlement, legacy result adoption, concurrent cache persistence and actual host/version/configuration/jobs. Do not promote based on one small sample or repeatedly select favorable holdouts.

The [requirement matrix](SPORTS_REQUIREMENT_EVIDENCE.md) distinguishes verified mechanisms from incomplete live and performance evidence. Sports remains unfinished; full Crypto and Stocks requirements remain queued in that order. No merge, deployment, model promotion or live trading; cPanel excluded.
