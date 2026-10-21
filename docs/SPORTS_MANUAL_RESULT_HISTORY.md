# Accepted manual-result revision history

Development identity: v6.0.39. This phase preserves accepted normalized manual results and their edits/deletions. Prediction weights, risk gates and deployment configuration are unchanged.

## Defect and verification

`sports-bot/src/intelligenceStore.js` previously replaced a same-ID result and retained only the immediately preceding JSON backup. A measured sequence of three edits produced current score 3, backup score 2 and no surviving first score in revision history. The repaired implementation produces the same current/backup values plus three audit revisions preserving score 1. This is a persistence measurement, not a prediction-performance improvement.

The previous full suite was reproduced: **535 passed**. The repaired full suite has **546 passing tests, zero failures/skips**. `npm run check` and whitespace checks pass. Eleven new tests exercise accepted edits/deletions, repeated IDs in a batch, legacy baselines, stale/missing snapshots, malformed/altered/truncated/wrong-guild history, missing/rolled-back ledgers, concurrent child writers, caller mutation, frozen grading references and a real child exit between history append and snapshot rename.

Commands:

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/manual-result-history.test.js
```

## Persistence contract

- `src/manualResultHistory.js` maintains `intelligence-<guild>.json.results.jsonl` inside the private data directory. Each accepted import/upsert/removal appends a versioned, sequence- and hash-linked record with actor, local receipt, operation, exact prior normalized records and accepted replacements/tombstones. Repeated IDs within one import retain intermediate accepted values.
- The first mutation captures the existing results snapshot as a legacy baseline. This proves only what was observed at migration; missing older edits and source publication timestamps are explicitly unverified.
- History is appended and file-synced before the normal JSON snapshot is replaced. Result reads replay validated history. A process exit after append can leave the snapshot stale; replay still returns the accepted result. The API response may have failed or been lost although the audit mutation was accepted. Inspect history before retrying; a retry is another recorded revision.
- A snapshot head marker detects missing history, a shorter valid history prefix, or a conflicting same-sequence hash. Malformed/truncated/hash-invalid or wrong-guild histories fail closed. Reads do not silently substitute the current snapshot. Deleting both the snapshot and ledger is not detectable without an independent backup/anchor.
- All cooperative intelligence writers use the existing exclusive audit-file lock in addition to the in-process queue. Locks are never stolen by age. A dead process can leave a lock that requires explicit operator review; readers can still replay an intact ledger. This is a single-host/local-filesystem contract, not distributed transactional storage.
- `manualResultMatching.js` freezes the selected result's `manualRevision` sequence/hash/index. Journal and warehouse result-source evidence retain that pointer alongside actual local receipt and source assertions. Later administrative edits cannot change the already-frozen forecast/result evidence.

## Inspecting history and deployment requirements

From a private, correctly configured `sports-bot/` checkout, `readManualResultHistory(guildId)` exported by `src/intelligenceStore.js` returns the validated revision records. The ledger file itself is private JSONL. It contains administrator identifiers, source references and notes; keep it out of public source repositories. No new Discord command was registered or invoked.

Back up the complete private data directory, including result JSONL files and intelligence snapshots. A normal `/sportsdata export` remains a current-input snapshot export; it does **not** export or restore the revision ledger. Importing an export creates newly received records, not reconstructed historical receipts. Do not edit snapshots directly once a ledger exists: result reads intentionally use the ledger.

Before any separately approved deployment, stop older writers, preserve their data, test a copy, confirm the actual data directory and restore procedure, and retain all ledger files. The old JSON-only automatic directory migration does not constitute an audit-ledger transfer. A migrated marked snapshot without its ledger fails closed. Do not mix old and new writers or delete a lock while its owner may still be running. No live host was changed or verified by this phase.

## Limits and remaining work

History preserves **accepted normalized** results. It does not archive arbitrary ignored raw import fields, rejected malformed payloads or unknown edits made before adoption. SHA-256 chaining detects accidental alteration relative to retained evidence; it is not authentication, immutable external storage or proof against a privileged writer rewriting all files. File sync plus process-crash tests do not establish power-loss guarantees.

Replaying history is linear in ledger size. No compaction, retention deletion or authenticated external anchoring is introduced. Snapshot corruption remains a hard error requiring review even if result history is intact; unrelated team/player/context records are not reconstructed from a result ledger. Mixed-collection imports are not an all-collection database transaction.

Actual running-host configuration/jobs and sufficient prospective forecast improvement remain unverified. Legacy correction baseline adoption, quote-refresh selection and remaining provider chronology still need review. Sports remains in progress, followed by the complete queued Crypto and Stocks specifications. No merge, deployment, model promotion or live trading; cPanel excluded.
