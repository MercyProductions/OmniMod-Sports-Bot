# Receipt-backed cross-version pairing and observed finals

## Implementation

The isolated collector now appends a content-hashed capture receipt only after a worker's frozen capture bytes and chronology have been verified. Receipts form an ordered hash chain in private `capture-ledger.jsonl`; the existing exclusive collector lock serializes writes. A failed later worker does not erase an earlier receipt. Broken/truncated chains fail closed. Analysis verifies the original capture bytes against receipts and source commits against the pinned manifest.

Older captures without receipts are counted as unindexed legacy evidence and excluded. Their issuance times are not guessed or backfilled. Offline captures remain synthetic/rehearsal evidence and cannot enter live-market scoring.

Read-only reporting:

```powershell
npm --prefix sports-bot run research:prospective -- --action=report --directory=C:/private/sports-study
```

The report selects the first qualifying receipted pregame forecast per role/event/horizon, including league, event ID, scheduled start and team-side names. Generation must fall inside its collection interval, both receipts must precede kickoff, and the sequential issuance gap must be at most two minutes. Later same-horizon revisions cannot replace a less favorable original. Missing counterpart, bad chronology, invalid probability vectors and oversized gaps have explicit rejection counts.

Baseline probabilities come from the archived baseline executable, preserved as the matched evaluator's `evidence` reference column; they are not relabeled as a simple Elo baseline. Challenger probabilities retain their original model version. The comparison records each source commit and receipt gap. Logical paired rows are derived read-only from actual pregame receipts; they are not represented as production Discord journal events.

Subsequent indexed captures can supply observed finals for an existing event. Latest observations from each role are retained; contradictory scores/winners stay unresolved. Changed scheduled starts or team identity cannot grade the original event. An actual final must pass the existing sport-aware result validator and be observed after scheduled start. Earlier as-of reports ignore later captures, so corrections remain traceable through the original receipt chain.

Matched scores, calibration, strata and game-cluster intervals reuse the existing evaluator. The report never promotes a model and does not infer that a small descriptive sample establishes performance. Sequential provider observations can differ; this is not identical-input inference or a completed preregistered trial. Cross-midnight pending-game fetching still needs integration: observing finals only in later current-date captures is not complete reconciliation coverage.

## Verification

Baseline `db93d6465e7a0406dff8b5a3c50e4e1c14532bc1`: 212 tests reproduced before this phase. Current suite: 218 passing, zero failures/skips; configured syntax and whitespace checks pass.

Tests cover original vector scoring with later finals, as-of result availability, exclusion of offline/late/widely separated observations, conflicting finals, immutable first-horizon selection, changed schedules, missing/boolean probability rejection, receipt-chain and frozen-byte tampering, and collector-to-receipt integration. Synthetic fixtures are never evidence of improved real forecasts.

A bounded real-data rerun and actual report at **2026-10-21 03:57 UTC** produced two new verified receipts, zero paired pregame forecasts and 28 rejected non-pregame rows. Two older unreceipted captures remain excluded. No pregame accuracy, proper-score improvement, calibrated probability improvement or after-cost return can be measured from this sample. Existing 403 history/summary limitations remain unresolved.

No production data, learner, source, Discord messages, paid requests, live orders or model promotions were changed. Sports remains in progress before Crypto and Stocks. Next work includes cross-date pending-final retrieval, permitted provider coverage repair, actual pregame observations, deployed-host inspection and the full requirement-to-evidence map.
