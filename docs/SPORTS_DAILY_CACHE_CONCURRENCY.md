# Daily cache revision protection

October 21, 2026. Forecast model identity remains v6.0.45. No forecast weights, risk gates, production configuration or credentials changed.

## Confirmed defect and repair

`sports-bot/src/storage.js`, `writeDailyCache`: temporary-file rename prevented partial JSON reads but did not prevent a delayed whole-object write from replacing newer forecasts, quote decisions or final acknowledgements. Reading the latest cache immediately before writing was not a transaction. Final and targeted-refresh jobs also performed asynchronous work against an earlier snapshot, so taking a newer revision immediately before writing would incorrectly authorize stale results.

Writes now freeze their input before waiting, serialize within the process, acquire the existing exclusive owner-file lock across cooperating processes, read the current target under that lock and compare an expected revision. The persisted revision increments only on a successful replacement. A stale write throws `DAILY_CACHE_CONFLICT` and leaves the newer file unchanged. Legacy files without a revision are revision zero and upgrade on their next successful write. Invalid revisions and malformed JSON fail closed. An existing lock is never stolen based on age.

`sports-bot/src/index.js`: initial builds, final reconciliation and targeted refreshes use the revision of the cache from which their source work began. Price updates compare the revision of the latest cache used by their scoped merge. Pending-delivery acknowledgements retain the revision returned by the publisher; a concurrent new payload cannot be silently acknowledged by an old write. All successful callers retain the returned revision.

`sports-bot/src/discordPublisher.js`: successful transport is journaled before cache persistence. A subsequent cache conflict therefore cannot erase evidence that the rendered forecasts reached the fake/real transport boundary. Cache persistence still fails explicitly; it does not pretend that the newer cache contains the delivered payload.

## Verification

- Reproduced prior full suite: 631 passed, zero failures/skips.
- Five new storage regressions exercise stale whole-object snapshots, competing local writes, a separate process with a stale snapshot, existing owner locks, malformed bytes and legacy/invalid revisions. They fail against the preceding storage implementation; the stale-snapshot case explicitly observes a missing rejection.
- A sixth regression uses the actual publisher and local fake Discord boundary: a cache update during accepted send remains intact, delivery is journaled, and the stale save rejects.
- Existing transport/restart fixtures now carry the revision they actually read. Each transport test starts with its own cache state rather than relying on unconditional overwrites from prior tests. The isolated migration fixture copies the new lock dependency.
- Full repaired suite: 637 passed, zero failures/skips. `npm run check` and whitespace checks pass.

## Limits and next work

Conflicts do not automatically retry stale computations. The scheduler or administrator must reload and reevaluate; final delivery claims and immutable journals preserve independently committed evidence for recovery. A conflict may delay cache acknowledgement until the next eligible check. There is no automatic lock-owner recovery for daily-cache locks; an interrupted owner requires review.

This is optimistic revision protection for cooperating local-filesystem writers, not a distributed transaction spanning providers, journals, warehouse and Discord. In particular, two processes can still edit a daily Discord post out of order before detecting a cache conflict. Safe remote publication sequencing and field-specific conflict recovery remain unfinished. Legacy global-cache fallback and old external writers require controlled migration/review; an unconditional external file replacement does not participate in this protocol. No power-loss durability guarantee is claimed.

Sports remains in progress. Actual running-host source/configuration/jobs, evidence-reviewed legacy correction adoption, complete source/settlement lineage and adequate independent prospective performance evidence remain unverified. Crypto then Stocks remain queued. No merge, deployment, promotion or live trading; cPanel excluded.
