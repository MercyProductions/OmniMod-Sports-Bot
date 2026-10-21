# Candidate vector integrity and metadata propagation

## Confirmed defects

`sports-bot/src/candidateCohorts.js:62` accepted numeric strings, ignored unsupported outcome keys, and inferred missing draw as zero. Its callers included registry evaluation and local ML training. The warehouse stored candidate class declarations but `warehouseCandidateRowsBefore` dropped them, preventing a stricter consumer from distinguishing emitted binary classes from incomplete legacy vectors. Matched journal references had a separate coercing converter with similar missing-draw inference.

## Changes

The shared fractional candidate validator now rejects arrays, unknown keys, nonnumeric coordinates, invalid range/mass and malformed/contradictory class declarations. Missing/null draw padding requires an explicit, valid away/home declaration. Complete numeric away/home/draw vectors remain supported without a declaration. Mass tolerance remains 0.001; no strategy/risk threshold was lowered.

- `featureWarehouse.js:494`: training exports preserve `candidateModeledOutcomes` as stored. Legacy missing declarations stay missing.
- `localMl.js:189`: evidence-vector qualification consumes its own declaration. `invalidEvidenceVectorsExcluded` counts invalid vectors among selected rows whose outcomes were available at the training cutoff; temporal exclusions remain separate.
- `modelRegistry.js:32`: model and paired scoring validate each candidate with its own declaration. `invalidVectorsByModel` counts present invalid vectors in the selected cohort; absent candidates are not mislabeled invalid.
- `predictionJournal.js:105`: new issued snapshots freeze emitted candidate and reference keys. Existing issue records are not rewritten by a later snapshot.
- `journalEvaluation.js`: descriptive reference comparisons use the reference's frozen declaration instead of reconstructing missing legacy classes.
- `matchedJournalEvaluation.js`: candidates, references and market baselines share strict fractional validation; structured missing/invalid-reference exclusions remain visible.
- Duplicate cohort comparisons include candidate class metadata in simultaneous frozen-input conflict checks.

These declarations record emitted vector keys. They do not prove league settlement rules, true source completeness, calibrated probabilities or independent statistical support. Complete zero-draw vectors remain compatible under their existing score conventions; this is not a universal class-semantics/Brier-denominator redesign.

## Verification

- Unchanged baseline: 721 passed.
- Nine added tests; all nine fail against preceding source.
- Focused candidate, warehouse, journal, registry/ML and selection tests: 90 passed.
- Complete suite: 730 passed, zero failures/skips. Syntax and whitespace checks pass.
- Regressions cover string coercion, arrays/extra keys, mass, unknown/null draw, valid/contradictory declarations, registry counts, training counts and immutability, matched references, simultaneous metadata conflicts, export preservation and immutable issued journal metadata.

All regression observations use isolated fixtures. Existing production datasets, installed models and frozen prospective studies were not rewritten or retrained. Fewer eligible historical rows can result from exposing invalid evidence; this is not improved prediction quality.

## Remaining work

Candidate class semantics versus actual sport/market settlement, score-coordinate conventions, historical feature availability, strict chronology across remaining reports, complete source auditing and adequate independent prospective outcomes remain unfinished. Raw-capture adapters can have separate validation behavior and require source-specific review; this phase does not certify every caller. No consumed holdout is reused for promotion.

Sports remains user-confirmed offline; installed state/startup unverified. No merge, deployment, model promotion or live trading. Sports remains in progress; queued Crypto then Stocks requirements remain intact.
