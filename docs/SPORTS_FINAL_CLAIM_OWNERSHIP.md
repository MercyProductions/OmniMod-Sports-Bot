# Final-result claim ownership and process recovery

Development model identity: v6.0.36. Prediction formulas, risk gates and production configuration are unchanged.

## Confirmed defects

The former storage API renamed an old claim even if its worker was still running. Completion required no ownership proof. Release checked only PID, allowing an old attempt in the same process to relinquish another attempt's claim. Concurrent stale takeovers could rename a successor's record. Caller metadata could overwrite reserved identity/state fields, and punctuation-stripped filenames could alias raw IDs.

Source locations: `sports-bot/src/finalClaimStore.js:12` (immutable publication), `:36` (owner liveness), `:41` (acquisition), `:75` (completion), `:87` (release), `:93` (migration); `sports-bot/src/storage.js:130` (integrated API); `sports-bot/src/finalDelivery.js:21` (verification before transport).

## Protocol

Each event's former JSON path becomes an immutable `protocol_v2` guard. Its sibling `.json.claims` directory contains complete generation records (`claim-N.json`) and one terminal decision per generation (`decision-N.json`). Records bind exact identity, a random claim ID, hostname, PID and module-process session. Reserved fields and metadata are frozen before asynchronous work.

Content is written to a unique temporary file, synchronized, closed, then published through a same-filesystem hard link without replacing an existing record. Published generations and decisions are never renamed or overwritten. Concurrent conflicting completions can publish only one acknowledgement. A cleanup failure can leave an orphan temporary file without revoking a published claim.

The implementation uses the [Node v24.14.1 link API](https://raw.githubusercontent.com/nodejs/node/v24.14.1/doc/api/fs.md#fspromiseslinkexistingpath-newpath). Publication/collision behavior was exercised on this Windows machine, not on the unverified hosting filesystem.

Age never authorizes takeover. Automatic recovery requires the same hostname and an operating-system indication that the recorded PID is absent. Live PIDs, permission-denied/unknown probes, foreign hosts and legacy owners remain held. The existence check uses signal zero, as described by the [version-matched process API](https://raw.githubusercontent.com/nodejs/node/v24.14.1/doc/api/process.md#processkillpid-signal). PID reuse can conservatively delay recovery rather than steal a live process's claim.

A terminal handoff fences the dead generation before contenders attempt the next generation. Only the winner receives a new lease. Finishing/releasing requires that lease and the original local process session. A stale lease cannot finish or release a successor. The batch verifies ownership before invoking the publisher; its independent history protections still apply after a crash.

## API change for extensions

```js
const reservation = await claimFinalResult(dateKey, guildId, eventKey, details);
if (reservation.claimed) {
  await verifyFinalResultClaim(dateKey, guildId, eventKey, reservation.lease);
  // Perform the existing guarded transport operation.
  await finishFinalResult(dateKey, guildId, eventKey,
    { messageId, channelId }, reservation.lease);
}
```

Pass the lease as the fourth argument to `releaseFinalResultClaim`. Do not reuse leases between processes/attempts. `options.staleMs` remains in the acquisition signature for compatibility but cannot authorize takeover. Owner diagnostics are under `claim.owner`. All known source callers and fixtures were updated.

Old-format claims receive no lease. Existing scoped posted acknowledgements can still restore the cache; unverified legacy active claims require explicit reconciliation. The guard cannot be interpreted as an active timed claim by the prior worker implementation. Stop all workers before a future authorized upgrade.

## Migration and deployment requirements

Legacy migration copies top-level JSON, not ledger directories. Migrated v2 guards therefore carry `migrationRequired: true` and cannot make the new directory appear unclaimed while their ledgers remain elsewhere. Source files are preserved. A production-mode child using the actual storage modules and isolated config verifies this, and verifies that review-only operations still skip migration.

Back up/transfer each guard and entire ledger together under operator control. Do not delete them to force a send. Deployment must verify local hard-link support, one host/process namespace, access permissions, data directories and ownership. Unsupported links and unreadable records fail closed. No automatic destructive migration or owner killing is provided. No production deployment occurred.

## Verification

The complete pre-change suite passed **494 tests**. Seven targeted ownership regressions all failed against the former committed API. The repaired suite passes **507 tests, zero failed/skipped**, plus syntax and whitespace checks.

Thirteen new tests cover old live-owner receipts, missing/wrong proof, wrong release, stale completion, reserved/mutable metadata, legacy/foreign owners, filename collisions, redacted corruption errors, real child ownership, a foreign process borrowing a lease, concurrent recovery, three crash windows and conflicting terminal decisions.

The actual delivery batch is tested with persistent claims, the real publisher, a local fake Discord service and cache writes. New processes recover after crashes before send, after remote acceptance, and after acknowledgement but before cache persistence. Every case leaves one fake remote message and one cache acknowledgement, with no send on another retry. Four recovery contenders yield one active successor. These tests do not start a Discord login, scheduler timer, production service or real-money action.

## Remaining limits

This is cooperative single-host filesystem coordination, not an authenticated distributed lock. Duplicate hostnames on different machines, shared/network filesystems, adversarial local writes, power-loss durability and container PID namespaces are outside the verified contract. Traversal is bounded at 4,096 generations and then requires maintenance.

Hung live workers are not automatically displaced. Legacy active claims and migration markers require explicit reconciliation. Local claims alone cannot guarantee exactly-once delivery when remote acceptance or message visibility is uncertain; history guards remain essential, and delayed visibility has not been validated live. The logged-in scheduler and actual host remain unverified.

Correction edits, quote-only refresh selection, remaining adapter identity, compact timestamp/missingness and full revision lineage remain unfinished. Adequate outcomes have not established improved prediction accuracy or calibration. Original prospective captures are preserved; their games were still upcoming at 2026-10-21 10:42:36 UTC. Sports remains in progress before Crypto and Stocks. cPanel is excluded. No merge, deployment, promotion or live trading occurred.
