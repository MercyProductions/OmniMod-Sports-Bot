# Scoped Sports refresh and Discord event identity

Development model identity: v6.0.33. Strategy weights, probability formulas, risk gates and production configuration are unchanged. Evidence eligibility and event association are stricter.

## Confirmed defects and changes

- [Refresh scheduling and completion](../sports-bot/src/pregameRefresh.js) used bare native IDs for window state, rebuilt summaries, predictions, accepted/rejected sets and journal acknowledgements. A second league could consume another event's completion or replace its forecast. Refresh requests now carry league, native ID and canonical scheduled start throughout completion, state, merging, issuance and terminal diagnostics.
- [Shared slate identity](../sports-bot/src/slateEventIdentity.js) resolves predictions to unique game observations. Conflicting prediction payloads for an event fail closed. Display league names are not substituted for machine league keys. The journal's existing canonical observation matching is reused rather than creating another last-write-wins resolver.
- A completion state is stored under an explicit event key. A native-ID alias remains for uniquely scoped events, with the same bound event key. Unbound legacy completion windows are not evidence of a current scoped refresh and are retried once; a changed start or league does not inherit completion. Accepted events retain their previous windows.
- [The scheduler](../sports-bot/src/index.js) passes scoped refresh targets and scoped horizon keys to [the actual slate builder](../sports-bot/src/sportsData.js). The builder preserves an untargeted event's original forecast even when another event has the same native ID. Its cached forecast index is constructed once per build, not once per game. Ambiguous snapshots cannot be selected arbitrarily.
- Old cached forecasts without a game start are preserved for display when their original cached event match is unique, but remain explicitly unverified, ungraded and ineligible for calibration. No missing receipt or original issue time is reconstructed. Known conflicting start times cannot use this legacy fallback.
- [Market capture](../sports-bot/src/featureWarehouse.js) receives scoped targets, honors scoped horizon labels, and groups movement history by league/native ID/start/guild. Distinct starts no longer collapse into one market record when capture time and stage coincide. Legacy rows without matching start evidence do not silently acquire it.
- [Discord slate presentation](../sports-bot/src/discordPublisher.js) associates each row with its own event. Ambiguous or missing associations display an explicit event-data-unavailable message and hide forecast/price details. Such rows are excluded from delivery acknowledgements; correctly matched rows can still be acknowledged. Discord size limits and existing send/edit/restart behavior remain tested.
- Terminal refresh journal entries now preserve league and canonical start, include structured association rejection reasons, and distinguish scoped terminal attempts. Previously written hash-chain records remain unchanged; no legacy journal is rewritten.

## Source locations for review

Locations in this development revision: `sports-bot/src/pregameRefresh.js:16` (due windows), `:40` (bound state), `:55` (completion), `:128` (journal handoff); `sports-bot/src/slateEventIdentity.js:9` (unique forecast resolution); `sports-bot/src/index.js:413` (scoped targets); `sports-bot/src/sportsData.js:659` (frozen forecasts); `sports-bot/src/featureWarehouse.js:243` and `:402` (stage and snapshot grouping); `sports-bot/src/discordPublisher.js:199` (presentation and delivery subset).

## Measured verification

The complete pre-change suite passed 460 tests. All seven new refresh/display regressions failed when replayed against the prior committed refresh, publisher and journal implementation. After repair, the complete suite passes **470 tests, zero failed or skipped**, and `npm run check` passes.

The new coverage includes independent window scheduling, fresh versus stale same-ID events, scoped durable issuance and terminal logs, ambiguous bare-ID requests, changed starts, unbound legacy state, contradictory forecasts and game observations, distinct final-score displays, a simulated Discord write with only the visible matched forecast acknowledged, an actual local-only targeted slate build, and real warehouse snapshot persistence with distinct leagues and start times. Existing offline legacy preservation assertions now also require explicit unverified identity and no grading/calibration eligibility.

All data in these tests are synthetic and all transport uses a local fake Discord service. No external market-data call, real forecast, production-data rewrite, operator adjudication, model promotion, deployment or live trade is part of this phase. Tests demonstrate association and lifecycle integrity, not improved prediction accuracy or positive economic value.

## Remaining limits and next steps

This is not a claim that every provider adapter and mutable result path now has scoped identity. Upstream `gamesMatch`, targeted source merging, carry-forward odds, result-refresh matching, final reply/claim keys, quote-only refresh selection and other native-ID callers still require focused audit. Some provider request filters remain native-ID lists and may fetch extra summaries; the scoped completion gate prevents those extra observations from becoming approved refreshed forecasts. Full raw revision lineage and compact timestamp/missing-value contracts remain incomplete.

Legacy state can trigger another eligible pregame refresh after upgrading. Existing message editing/recovery still governs Discord deduplication. Schedule corrections require explicit reconciliation rather than silently replacing an original issued event. Previously finalized research reports are immutable and do not automatically retract when later evidence changes.

Actual running-host version/configuration and jobs remain unverified. The two original prospective baseline/challenger pairs remain preserved; adequate independent outcomes and demonstrably improved calibration/accuracy have not been established. Sports remains in progress before Crypto and Stocks. cPanel is excluded. No merge or production deployment is performed or authorized by this source-only phase; live trading remains disabled.
