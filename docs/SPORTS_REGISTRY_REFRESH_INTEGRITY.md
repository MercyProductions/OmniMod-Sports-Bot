# Registry refresh integrity and cooperative ownership

Development identity: **v6.0.53**. The scheduled trial remains frozen at v6.0.52 / `03c6714...`. No source/plan substitution, production startup, model promotion or trading occurred.

## Confirmed defects in the full refresh path

The shared candidate evaluator already selected the earliest original forecast and quarantined conflicting evidence. `refreshModelRegistry` had a separate earlier Map pass that kept the last row for a narrower key. That pass removed the very evidence the validated evaluator needed:

- A later richer forecast replaced the original issue, adding challenger scores unavailable at the first prediction.
- Contradictory actual outcomes and simultaneous different inputs became a single apparently clean observation.
- Same-ID events in different leagues within one sport overwrote each other.
- Declared horizons absent from the Map key could disappear according to input order.
- The recent window was sliced from mixed raw cohorts before production/replay selection, so it could evaluate replay while the full score evaluated production.
- Same-day recent order depended on input order rather than parsed forecast receipts.
- Callers could mutate nested vectors after submitting an asynchronous refresh.

All eight conditions fail on the previous full refresh implementation. The tests call `refreshModelRegistry` and inspect the persisted registry; they do not merely call its already-correct scoring helper. Synthetic scores prove contract behavior, not market edge.

A separate pair of tests reproduced missing registry ownership: a preexisting owner lock did not stop refresh, and two real processes could read the same snapshot and both accept updates, after which one sport disappeared. That is an observed lost update in the test harness, not a hypothetical multi-process concern or proof about a production incident.

## Repairs

`modelRegistry.js:233` freezes submitted nested rows before queued IO and passes all originals to the established first-issue/cohort validator. It removes the last-row Map without loosening vector, prospective-provenance or selection-review checks. Full evaluation retains duplicate/conflict/cohort diagnostics.

The recent window is derived from the same selected canonical cohort, ordered by strict recorded instants (generated instants for replay), with a stable game-ID tie break. Unverifiable order sorts before valid observations and cannot acquire prospective proof. The existing recent-window sizes and promotion/rollback thresholds remain unchanged.

The entire registry read/evaluate/write transaction now runs under the existing exclusive audit owner-lock protocol, in addition to process-local serialization. A contending writer fails closed and can retry after the owner finishes; it cannot acknowledge a write that another cooperating writer silently erases. Existing lock bytes and state remain intact. The child-process regression tests this refusal and successful later retry preserving both sports. No age-based recovery, owner stealing, foreign-host coordination or distributed exactly-once guarantee was added.

Model identity is v6.0.53 because registry evaluation and eligibility histories must not be pooled as if this were the previous governance path. No installed model registry was rewritten and no fitted artifact was retrained.

## Windows recovery investigation

Sixty additional real multi-process dead-owner recovery repetitions passed, on top of the previous eight ownership/manual-writer repetitions. The earlier zero-successor failure did not reproduce; its underlying cause remains unknown. Strong ownership assertions and PID/refusal diagnostics remain unchanged. Passing repetitions are evidence of the exercised cases, not a proof the intermittent failure is eliminated. The registry lost-update repair is a separately reproduced defect, not an explanation for the earlier failure.

## Verification

- Unchanged default-parallel baseline: **916 passed**.
- Eight old refresh/cohort regressions fail; two old ownership tests fail, including an actual accepted-update loss.
- Ten added persistence/ownership regressions pass, including the two-process refusal/retry sequence.
- Focused from `sports-bot`: `node --import ./test/setup.js --test test/registry-refresh-integrity.test.js test/candidate-cohort-integrity.test.js test/selection-proof.test.js test/registry-availability.test.js test/v5-prediction-system.test.js test/v6-prediction-system.test.js test/audit-file-lock.test.js`: **68 passed**.
- Root full default-parallel suite: **926 passed**, zero failed/skipped. `npm run check` and whitespace checks passed.

These checks verify registry consistency, not predictive performance, economic value or the deployed state.

## Frozen trial, missing data and remaining requirements

The private v6.0.52 collector still verifies the original source/artifact and returns awaiting-trial-start with zero requests. It disables replay/registry refresh and learning, so this wrapper repair is not silently injected into that experiment. Its minimum remains 75 games/eight dates over the original 14-day period. Neither that future trial nor fixtures presently validate current v6.0.53 performance. The source-specific reporting and evidence limits remain explicit.

The latest actual free-source observation remains NHL context200 with four season candidates, zero confirmed starters and injuries403. Missing medical/source publication data remains unknown. Optional provider snapshots work under their existing checks; no actual preferred exporter is connected. No new provider request or credential change occurred in this phase.

The requirement matrix's current assessment now distinguishes actual resolved old studies, recovered thin native history, installed-but-prestart collection and current source from historical checkpoints. Historical reports retain their dated results. Sports remains incomplete; Crypto then Stocks remain queued under their full specifications. Live trading stays disabled, the Stocks automation is active and unchanged, and cPanel remains excluded.
