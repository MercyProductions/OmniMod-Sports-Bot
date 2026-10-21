# Manual result identity, receipts and conflict handling

Development model: v6.0.38. This repairs result ingestion and evaluation integrity. It does not change prediction weights, risk thresholds or production configuration.

## Confirmed defects and repairs

- `sports-bot/src/intelligenceStore.js:98` previously discarded event scope from automatic result IDs. Identical scores for same-team doubleheaders collapsed into one record. Scoped records now retain game ID and canonical start time in their keys. Explicit administrator record IDs remain supported.
- `sports-bot/src/intelligenceStore.js:259` accepted malformed scores through numeric coercion and discarded source scope/receipts. Nonnegative measured scores are now required; zero remains valid. Optional timezone-qualified timestamps, score basis and HTTP(S) source references are preserved. Unknown neutral venue remains unknown. Editing a result requires reaffirming its source check.
- The former private matcher in `sportsData.js` chose the first date/league/team match. `sports-bot/src/manualResultMatching.js:9` now requires a unique scoped source observation and exact ordered team pair. Provided IDs/start times never fall back on mismatch. Legacy records can match a unique pair, but remain explicitly identity-unverified. Ambiguous doubleheaders and conflicting source observations are rejected.
- Conflicting manual scores previously depended on iteration order. They now create auditable conflicts, invalidate displayed correctness, quarantine journal labels (`predictionJournal.js:267`) and dispute warehouse outcomes (`featureWarehouse.js:353`). Original pregame forecasts remain unchanged.
- The old matcher read `updatedAt`, although imports store `recordedAt`. Local receipts now remain distinct from optional operator-supplied observation times and provider fetch receipts. Manual journal results do not borrow a provider timestamp.
- Soccer overrides previously removed extra-time context. Manual soccer grading now requires an explicit regulation score basis. Unknown/full-game scores cannot establish regulation-market outcomes.
- `finalResultRevision.js` accepts reviewed, uniquely scoped manual correction evidence only with a later valid local receipt, an actor, an explicit source check and an HTTP(S) reference without embedded credentials. Corrections edit the existing result and preserve the original forecast. These are operator assertions, not independent verification of a publisher or authentication of the underlying result.

## Administrator inputs

Existing `/sportsdata result-add` required fields remain date, league, ordered away/home names and scores. Added optional fields:

| Command option | JSON field | Meaning |
| --- | --- | --- |
| `result_id` | `id` | Stable administrator record ID; use deliberately when editing an existing record |
| `game_id` | `gameId` | Exact local or explicitly mapped upstream event ID |
| `start_time` | `startTime` | Exact scheduled timestamp including timezone |
| `score_basis` | `scoreBasis` | `unknown`, `regulation`, or `full_game` |
| `source_reference` | `sourceReference` | Public HTTP(S) reference; never include credentials |
| `source_checked` | `sourceChecked` | Administrator assertion that this revision was checked |
| `observed_at` | `observedAt` | Optional source observation time; never inferred publication time |

For doubleheaders, supply both event ID and start time. Receipt must be after the event start and no later than the evaluation clock. An observation must be after start and no later than receipt. Missing observation time is explicitly labeled as a local recording receipt. Command changes require registration when deployment is separately approved; no registration or production restart was performed.

`manualResultAudit` in daily/final-refresh slates records applied/rejected record IDs and structured reasons. Diagnostics summarize applied and rejected counts. Rejections include ambiguous event, scope mismatch, invalid scores/basis/start, unverified receipt chronology and conflicting manual results. These records are evidence of local handling, not proof of real source correctness.

## Verification

The previous committed suite was reproduced: **521 passed**. Restoring the previous importer and actual final-refresh matcher reproduced **three targeted failures**: collapsed doubleheader scope, invalid-score acceptance and assigning an override to the wrong game. Restored repaired sources pass **535 tests, zero failures/skips**, including 14 new manual-result tests. `npm run check` and whitespace checks pass.

Tests cover real importer/store operations, the actual final-refresh path with a stubbed scoreboard, journal/warehouse quarantine, admin command handling and local fake Discord correction transport. They do not establish live provider reliability or improved forecasting accuracy. Full reproducible command: `npm test`; focused command from `sports-bot/`: `node --import ./test/setup.js --test test/manual-result-integrity.test.js`.

## Remaining work and limits

- Explicit-ID imports can still replace a manual store row. A full immutable raw manual-edit revision ledger remains unfinished; the prediction journal freezes result evidence when observed, not every intervening administrative edit.
- A result conflict is not automatically eligible again merely because a manual row was removed. Existing journal conflict resolution and warehouse adjudication requirements remain in force.
- Legacy rows without valid receipts cannot certify chronology. Unscoped corrections cannot authorize an automatic Discord correction. Previously collapsed doubleheaders cannot be reconstructed without independent records.
- URLs are references only; this feature does not fetch or authenticate them. Administrator assertions do not independently prove a publication timestamp, reviewer identity outside Discord, or source truth.
- The actual running host, configuration, jobs and prospective predictive improvement remain unverified. Current source is development-only; no merge, deployment, model promotion or live trading was performed.
- Sports remains in progress. Crypto and then Stocks remain queued under their complete specifications. cPanel is excluded.
