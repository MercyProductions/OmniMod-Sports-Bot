# Targeted pregame cache and journal coordination

October 21, 2026. Forecast model identity remains v6.0.45. No model weights, risk thresholds, credentials, provider budgets or production configuration changed.

## Confirmed sequencing defect

The targeted scheduler built against its original cache, read a newer cache, then called completion/journaling before saving with the original revision. A harmless quote update could make the final save fail after issuance/completion had already been journaled. A changed forecast could also be replaced in that candidate before the cache save rejected it. The original source-request input was not part of that completion decision.

The new regression executes the preceding completion-function contract with a changed current NBA forecast: it accepts both refreshed league forecasts. The coordinated path rejects the changed NBA event before issuance while completing the unchanged NHL event. This is a synthetic reproduction of the old scheduler contract, not execution of the logged-in old scheduler.

## Implementation

- `sports-bot/src/storage.js:193`, `updateDailyCache`, shares the replacement writer's per-process queue and exclusive owner-file lock. It reads current state, invokes a bounded local callback, checks the returned revision/scope, freezes the result and atomically replaces the cache with the next revision. Invalid output and callback errors leave the cache unchanged. Callbacks must not invoke provider or Discord requests, or nest another cache transaction.
- `sports-bot/src/pregameCachePersistence.js:16`, `persistPregameRefresh`, freezes the build inputs before waiting. Inside the cache critical section it checks current event observations, unique frozen forecasts and scoped refresh-window state against the original source-request input. Quote-only/value-only changes can survive; changed or ambiguous events/forecasts are blocked with structured reasons.
- The existing freshness and journal-issuance gates remain authoritative. The validation clock is sampled after acquiring cache ownership, so a build delayed behind another writer is checked against the then-current start time. Source completion and validation times are recorded separately. `validatedAt` is not claimed as an atomic disk-commit timestamp.
- `sports-bot/src/pregameRefresh.js` accepts cache-blocked event keys and records their rejection reasons without treating them as completed or eligible new forecasts. Journal refusal of an already rejected/mutated identity remains a separate gate. Independently issued immutable forecasts are not revoked by a later rejected attempt.
- `sports-bot/src/index.js:386` now uses the coordinated path. Provider/build work finishes before entering the critical section; Discord and warehouse work occur afterward. Warehouse selection now uses complete league/start/event keys rather than native game IDs alone.
- Current message IDs, result acknowledgements, odds and unrelated state survive. Accepted forecasts receive value analysis against current cached quotes while their model probabilities remain the issued values. Unsolicited rebuilt games do not replace unrelated current observations. Accepted refreshes retain pending-delivery state until the existing publication path acknowledges them.

`pregameCacheMergeAudit` records original/current revisions, source completion, validation time, applied-event count, cache-conflict reasons and source diagnostics. The journal retains the full refresh attempt, source rejections and issuance history. The cache audit is a replaceable last-operation summary.

## Verification

- Prior full suite reproduced: 662 passed.
- Ten new tests cover concurrent quotes/metadata, changed forecasts with independent league progress, delay past kickoff, frozen queued inputs, stale writers, journal failure, missing/foreign scopes, stale summaries, rejected journal identities, already completed windows and invalid updater output.
- A real Node child attempts to write while the parent holds the update transaction. The child is refused by the owner lock; the owner's write remains intact.
- Original probabilities remain preserved in separate journal forecasts. No cross-league native-ID substitution is accepted.
- Focused cache/journal/scoped-refresh tests: 41 passed. Full repaired suite: 672 passed, zero failures/skips. Syntax and whitespace checks pass. Secret checks must pass before pushing.

Tests use isolated files and synthetic source observations. No production Discord login, scheduled job, live provider call or wager was used. These measurements establish exercised sequencing behavior, not improved predictive accuracy.

## Boundaries and deployment requirements

This coordinates cooperating local writers; it is not a multi-file atomic transaction. The journal can succeed before a later cache I/O failure or process exit. Valid independently issued forecasts remain evidence, while a missing cache acknowledgement must be reconciled from preserved state. Journal and cache writes have distinct durability boundaries. Validation time does not prove exact remote publication time or provider clock truth, and I/O can span a start boundary after validation.

An interrupted cache transaction leaves its owner lock for explicit review; it is not stolen by age. Keep all processes on matching source and the same supported local data directory, and preserve journal, cache and claim evidence. No automatic lock deletion, deployment or legacy global-cache migration is authorized by this phase.

Actual host/configuration/jobs, uncertain remote requests, reviewed legacy result adoption, full source/settlement lineage and sufficient independent prospective performance remain unverified. Both frozen NHL studies cover the same two games. Sports stays in progress; Crypto then Stocks remain queued. No merge, deployment, model promotion or live trading; cPanel excluded.
