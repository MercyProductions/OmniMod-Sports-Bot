# Observe a valid collector receipt time before recording a capture

This follow-up was discovered during post-commit verification of the v6.0.12 missing-measurement repair. The complete pre-commit suite had passed 278 tests. The later committed-source subset failed two isolated-worker cases with the new numeric diagnostics:

- Child completion `1792561072513`, collector observation `1792561072512`: completion ahead by **1 ms**.
- Child completion `1792561080476`, collector observation `1792561080474`: completion ahead by **2 ms**.

These are measured cross-process wall-clock readings. They identify the rejection condition; they do not prove the operating-system or hardware cause. Earlier intermittent failures without numeric diagnostics are not retroactively explained with certainty.

## Repair

`prospectivePairs.js:22` adds `waitForCollectorClock`. After a worker returns, `prospectiveIsolation.js:99` allows a bounded wait for the collector to observe its **actual** wall clock at or beyond the declared completion. The default maximum is 50 ms, with small asynchronous pauses and a monotonic elapsed-time bound. Large offsets, invalid timestamps and a clock that fails to catch up do not pass the helper.

The collector then calls the existing receipt writer. That writer still hashes/verifies the file, reads a new real `Date.now()` and rejects a completion later than that observed receipt time. The helper does not supply a fabricated timestamp, use `max(clock, completion)`, change stored capture times, relax chronological comparisons or backdate a receipt. A timeout leaves the existing fail-closed receipt path in place. If the wait crosses kickoff, the existing paired evaluator's receipt-before-start requirement still excludes the observation from pregame comparisons.

Original capture files, source pins, receipt hashes and already recorded studies remain unchanged. No live collector run, Discord publication, deployment or model promotion was started. The forecast model identity remains v6.0.12; this follow-up changes collector behavior rather than prediction mathematics.

## Verification

One deterministic clock test verifies a small offset requires a later observed value, a one-hour offset is not waited through, a fixed clock stops within the bound, invalid timestamps fail, and invalid wait bounds are rejected. Existing malformed/future timestamp receipt tests remain in force. The focused pairing/archived-worker suite passes **17 tests**.

The complete suite after this follow-up passes **279 tests, zero failures/skips**. Configured syntax and whitespace checks pass. The source-commit verification failure and subsequent results are retained privately. This verifies handling of the observed narrow lag condition; it does not certify host clock synchronization or eliminate every possible clock/runtime failure.

Sports remains unfinished. Provider payload validation, year/season cache identity, remaining feature provenance and actual predictive performance are pending. cPanel stays excluded; no live trading is enabled.
