# Journal outcome-space consistency

## Confirmed defect and scope

`matchedJournalEvaluation.js` formerly converted absent/null primary draw probabilities to zero and accepted numeric strings through `finiteNumber`. It ignored the frozen `modeledOutcomes` declaration, so contradictory or incomplete declarations could enter same-issue comparisons. `journalEvaluation.js` also passed ambiguous primary vectors into its legacy descriptive horizon evaluator. This differed from the operational drift report's explicit outcome-space contract.

`src/journalOutcomeSpace.js` now holds that contract and is reused by operational monitoring, matched primary comparison and descriptive journal scoring. A complete numeric away/home/draw vector remains acceptable. Null/absent draw padding requires an explicit, valid away/home declaration. Three-way declarations require all numeric coordinates; a binary declaration with positive draw mass is invalid. Unknown legacy classes are excluded without changing stored records. The shared mass tolerance is 0.001 in fractional units, replacing the matched primary converter's former 0.005 tolerance; this is evaluation validation, not a strategy threshold change.

The descriptive summary preserves `graded` as the resolved-label count and `unresolved` as the missing-label count. New `scorableForecasts` and `invalidOrUnverifiedOutcomeSpace` counts make scoring exclusions visible. Resolved excluded rows are not mislabeled as unresolved. Matched comparisons report `modeled_outcome_space_unverified` separately from invalid primary probabilities/picks.

## Verification

- Reproduced unchanged baseline: 686 tests passed.
- Six added regressions: legacy null/omitted draw, valid explicit binary padding and immutability, malformed declarations, numeric strings, zero-probability actual draws, and summary resolved/scorable accounting.
- Four targeted new tests fail against the prior report sources; all pass after repair. The other two verify supported behavior remains intact.
- Full suite: 692 passed, zero failed/skipped. Focused journal/operational/matched tests: 57 passed. Syntax and whitespace checks pass.
- Tests use isolated fixtures. No production data, model, forecast probabilities, credentials, runtime or strategy rules were changed.

## Remaining limits

This phase does not establish universal evaluation consistency. Reference candidate vectors retain their existing fractional-vector contract; explicit comparator outcome-space metadata and broader chronology/duplicate/result-conflict consistency still need review. Historical replay, training eligibility and nonjournal horizon scoring require separate source-specific audits. The summary remains descriptive and is not a selection/promotion report. Operational sum Brier and matched mean-coordinate Brier have different documented units.

The existing 13-game next-day research journal remains unmodified, unresolved and ambiguous about its legacy outcome classes. No retrospective class declaration was fabricated. Real prospective performance is still unproven. Sports is user-confirmed offline; installed state and startup behavior remain unverified. No deployment, merge, promotion or live trading. Sports remains in progress; Crypto then Stocks remain queued.
