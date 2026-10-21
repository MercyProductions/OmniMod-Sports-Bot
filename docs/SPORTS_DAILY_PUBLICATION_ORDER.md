# Daily publication ownership and ordering

October 21, 2026. Forecast model identity remains v6.0.45. No model weights, risk controls, production configuration or credentials changed.

## Confirmed defect

`sports-bot/src/discordPublisher.js`, `postDailySlate`: cache revision rejection occurred after sending/editing Discord. A stale caller could therefore replace a newer remote payload and only then discover its cache conflict. The caller could also mutate the supplied forecasts while asynchronous resource discovery was pending.

Source anchors at this checkpoint: `sports-bot/src/discordPublisher.js:348` (frozen wrapper), `sports-bot/src/discordPublisher.js:355` (transport body), `sports-bot/src/dailyPublication.js:14` (ownership) and `sports-bot/src/dailyPublication.js:31` (revision preflight).

## Repair

- `sports-bot/src/dailyPublication.js` serializes publications within one process and acquires a shared, event-independent guild/date ownership claim across cooperating processes before reading the current cache revision. A stale revision rejects before message history lookup, send or edit.
- The publication claim remains active through history lookup, transport, delivery journaling and cache acknowledgement. Sends/edits verify their ownership immediately before invoking transport. This prevents an older caller from overtaking a completed newer publication through this shared ledger.
- The claim protocol reuses the already tested immutable generation/fencing implementation in `finalClaimStore.js`. It never steals a live owner by age. Automatic recovery requires a missing PID on the same host; foreign-host ownership and PID reuse remain fail-closed. Successful or failed operations release their generation; a crashed process can be recovered by the next process. No permanent "posted" terminal result is used for this reusable publication guard.
- Ownership lives under `daily-publication-claims/` within the configured private data directory, with its sibling generation ledger. Root-level legacy JSON migration does not copy this subdirectory. Backups/moves must preserve both guard and generation records together.
- `postDailySlate` freezes caller forecasts and options before its first asynchronous operation. It retains the existing formatter, duplicate-history checks, delivered-forecast selection, final result flow and cache conflict protections.

## Verification

Reproduced baseline: 637 tests passed. Four of five new publication scenarios fail against the preceding publisher; the simple simultaneous-call scenario also passes in that baseline run because its history check happens to observe the earlier send. It is not claimed as a deterministic reproduction of the old race.

Five added tests cover an obsolete publisher after a newer remote edit, simultaneous callers, a caller delayed before acquiring ownership, caller mutation during resource discovery, and an actual live publisher in another Node process. The child holds ownership inside the actual publisher before sending; the competing process is refused without another send/edit.

The existing actual-process exit/restart test now also inspects the recovered ownership decision after an exit immediately following remote acceptance. Normal failure/retry, permission failure, scoped refresh, delivery journal and accepted-send/cache-conflict tests continue to pass. The tests use the actual publisher and a local fake Discord service, not a logged-in production bot.

Full repaired suite: 642 passed, zero failures/skips. Syntax and whitespace checks pass. Changed-file credential checks and Gitleaks must pass before publication of this phase.

## Practical limits

All cooperating bot processes must share the same private data directory and supported local filesystem. Different directories, old bot versions, external writers or other hosts are outside this serialization guarantee. The underlying claim history is bounded to 4,096 generations per guild/date; exhaustion fails closed. Do not delete ownership history to bypass that gate.

Source jobs can still update the cache during transport. The outgoing snapshot remains immutable and its final cache write rejects if superseded; a subsequent publication must reload and reevaluate. This guard does not make cache, journal, warehouse and remote transport one transaction or provide automated field-specific conflict recovery.

Ambiguous requests may still be in flight at Discord after a local timeout or process exit. History recovery and ownership checks reduce duplicates but cannot prove a remote exactly-once guarantee. No live Discord concurrency or power-loss durability test was performed. An operator must preserve uncertain evidence and review unresolved remote state before assuming delivery is settled.

Sports remains in progress. Adequate independent prospective accuracy/calibration/value evidence, actual running-host/configuration/jobs verification, reviewed legacy result adoption and remaining source/settlement lineage are unfinished. Crypto then Stocks remain queued. No merge, deployment, model promotion or live trading; cPanel excluded.
