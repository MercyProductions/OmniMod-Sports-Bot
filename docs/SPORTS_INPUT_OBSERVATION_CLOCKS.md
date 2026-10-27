# Input observation clock integrity

## Confirmed defects

The inference input guard used permissive `Date.parse`. Timezone-free clocks depended on the machine timezone; impossible dates such as February 30 normalized into another day. Such inputs could be labeled observed before a historical cutoff. Nested invalid history receipts could therefore retain dependent profiles. Date-only historical profile updates were treated as precise observations.

The learning-context guard excluded only finite future cutoffs. A declared invalid, date-only or missing cutoff inside an existing audit object could leave Elo, calibration, outcome validation, feature learning, drift and performance-history parameters active. This is a confirmed input eligibility defect; it is not evidence that an actual wager or historical game score was wrong.

## Repairs and contracts

- `sports-bot/src/inputChronology.js:1` reuses the existing strict zoned, real-calendar timestamp parser. Arbitrary strings, objects, booleans, numeric years, impossible dates and timezone-free datetime values are invalid observation clocks.
- Line 9 rejects nonfinite direct information cutoffs. Line 18 validates every enumerated nested receipt; known invalid/future observations still invalidate their inseparable automatic aggregates.
- Date-only legacy metadata is validated as a calendar day and remains `unknown`, including when another field has a valid clock. A future calendar day is conservatively excluded using the existing UTC date-key convention. This does not assign a source observation instant or prove publication freshness. Untimed/date-only legacy profiles remain available under the existing disclosed legacy policy; no point-in-time completeness claim is made.
- Line 94 validates a declared learning audit cutoff and clears the six guarded learned-state collections for invalid or future cutoffs. With no audit, legacy learned state remains explicitly unknown; it is not silently treated as verified. Separately loaded registry/ML artifact validation is outside this six-collection guard.
- Line 100 emits `sports-input-cutoff-v2`. Inference identity is **v6.0.46** because eligibility behavior changed. No prior prediction or model artifact is rewritten or retrained.

Observation receipts are still assertions, not independently authenticated source publication times. A valid clock alone does not establish a feature's original availability, correct season/roster, full league coverage or an accurate prediction.

## Verification

Reproduced prior full suite: 809 passed. The initial eight new tests all failed on the previous source. A ninth boundary regression covers date-only future observations and unknown final availability. Tests include invalid clock-dependent probabilities, nested aggregate invalidation, learned-state exclusion/immutability, valid explicit offsets, leap years and absent legacy audit disclosure.

From `sports-bot`: `node --import ./test/setup.js --test test/input-observation-clock.test.js test/input-chronology.test.js test/learning-context-cutoff.test.js test/advanced-provenance.test.js` — **44 passed**. Root `npm test` — **818 passed**, zero failures/skips. `npm run check` and whitespace checks passed. New test/source syntax checks are included in the project check command.

A read-only report of the frozen next-day v6.0.45 study at **2026-10-22T04:59:24.181Z** retained 13 unresolved pairs, no pairing rejections and zero eligible final-query tasks/requests. All four protected manifest/ledger/capture hashes remained unchanged. The report uses its archived source identities, not v6.0.46.

The earlier actual two-game result comparison still belongs to baseline v6.0.0 versus the pinned v6.0.45 challenger: identical 1/2 accuracy, Brier 0.250961 and log loss 0.695072884138028. It does not validate v6.0.46. No forward performance improvement or cost-adjusted edge is established.

## Remaining work

Actual feature publication lineage, unknown legacy inputs, source access failures, lineup/injury completeness, independent prospective samples, statistical model selection and offered-price settlement evidence remain incomplete. Preserved studies cannot be relabeled to cover new inference versions. Sports is user-confirmed offline. No startup, merge, deployment, model promotion, Discord transmission or live trading occurred. Sports remains in progress; Crypto then Stocks remain queued.
