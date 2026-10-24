# Horizon vector integrity and warehouse outcome metadata

## Confirmed defects

`horizonEvaluation.js:5` previously normalized any positive total after interpreting a whole vector as percentages or fractions. A public 70%/70% vector or a fractional 0.3/0.7 vector mislabeled as percentages could become a plausible forecast. Missing/null draw values silently became zero, numeric strings were coerced, and a declared winner that was not the probability maximum could still be scored.

`featureWarehouse.js:197` now freezes emitted primary outcome keys and per-candidate keys for new records. It previously stored vectors without that class metadata, unlike the repaired prediction journal. Existing rows retain their original inputs and missing metadata; no retrospective class inference is written into storage.

## Repair

Horizon scoring reuses `journalOutcomeVector` for complete numeric vectors and declared binary padding. Public vectors remain percentages; candidate fallback vectors remain fractions. Numeric strings, unsupported sides, impossible mass, contradictory declarations and missing unverified draw classes are excluded. The shared mass tolerance is 0.001 in fractional units; small display rounding may be normalized only inside that bound. Frozen selected sides must be a maximum-probability modeled outcome, with ties allowed.

The report exposes `scoringCandidates` and `scoringExclusions` for vector or frozen-selection rejections **after** its existing version/chronology/deduplication selection. These counters are not a complete raw-input rejection inventory. The existing latest-forecast descriptive policy is unchanged; it does not fall back to an earlier valid record when the selected latest vector is invalid.

`journalEvaluation.js` preserves primary declarations and carries a reference vector's own frozen emitted keys through conversion rather than incorrectly assigning the primary class declaration to the reference. Reference vectors retain their existing fractional-vector contract; this phase does not establish all reference/model class semantics.

Two existing binary fixture populations were updated to state their claimed binary class evidence explicitly. Unknown legacy binary-looking vectors are intentionally excluded rather than assumed valid to preserve their old sample counts.

## Verification

- Unchanged baseline: 712 tests passed.
- Nine added tests: seven horizon vector/selection checks and two warehouse metadata/immutability checks. Seven fail on prior source; rounding support and legacy metadata preservation were already supported.
- Focused horizon, warehouse, journal, accuracy and ML suite: 72 passed.
- Full suite: 721 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage includes 140% and incorrectly scaled mass; missing/null draw; numeric strings; unknown/incomplete classes; candidate fallback scale/declarations; nonmaximum/tied selected sides; preserved sub-1% outcomes and rounding; immutable first snapshots; and no legacy metadata backfill.
- Synthetic caller records remain unchanged. No deployed data or research-study records were edited.

## Limits and next work

These fixes may reduce descriptive report samples by exposing previously invalid evidence. That is not improved predictive performance. Brier coordinate conventions, candidate class semantics in training/registry, legacy reference contracts, result/temporal identity, historical feature availability and proper prospective performance still need separate verification. New warehouse metadata describes emitted keys; it does not certify source truth, settlement terms or statistical support.

Sports is user-confirmed offline; installed configuration and startup remain unverified. No merge, deployment, model promotion or live trading. Sports remains in progress; Crypto then Stocks remain queued.
