# Historical starter observation integrity

Development model: OmniMod Evidence Ensemble v6.0.18. Baseline 310 tests at commit 268af02. Source only; no deployment, model promotion or live trading.

## Confirmed defects

Historical player parsing coerced flags with Boolean(): missing/null became false, while the string false became true. The learner counted every appearance in starter-rate denominators. Merging groups ORed contradictory true/false observations into a start, and that result could teach starter-pair interactions. Cached booleans could not establish whether the original provider supplied a real boolean or an erased coercion.

Four initial regression tests failed against these paths. Additional integration controls cover pair learning and frozen per-game diagnostics. This proves the mechanisms; their frequency in actual production forecasts remains unknown.

## Repairs and references

- `sports-bot/src/advancedMetrics.js:244` and `:264`: historical boxscore/roster starters accept only actual booleans. Missing and nonboolean values remain null. Explicit false is a measured reserve assertion, not missing. Truthy malformed strings cannot establish appearance on their own.
- `sports-bot/src/advancedMetrics.js:198`: retain raw boolean starterObservations while merging groups. A unique observed assertion survives unknown rows; contradictory booleans become null with starterEvidenceConflict. Later repeated assertions cannot erase the conflict. Group order does not select the answer.
- `sports-bot/src/advancedMetrics.js:339`: starterRate uses only nonconflicting boolean observations carrying the historical-starter-v1 contract. starterSamples and starterConflictSamples are separate from total boxscore appearances. Unknown rate and unknown learned starter status remain null; genuine zero reserve rates remain zero. Legacy coerced flags without provenance do not certify the new rate.
- Impact and expected-roster ordering use an explicit .5 prior where the historic rate is unknown, rather than coercing unknown to a measured zero. Continuity averages only available rates. These are existing heuristic models requiring forward validation, not claims that .5 is calibrated.
- `sports-bot/src/advancedMetrics.js:392`: starter-pair learning requires observed, nonconflicting current-contract starters. It does not backfill missing starter observations from statistics or a lineup prior.
- `sports-bot/src/participationProjection.js:49`: projections distinguish an observed rate from a role prior and an explicitly supplied legacy rate with unknown provenance. Existing current-role priors remain .82/.22. Current starter hints require strict true; current confirmed-start and availability handling are retained.
- `sports-bot/src/advancedMetrics.js:702` and `sports-bot/src/evidenceCoverage.js:72`: propagate and freeze starter sample counts, conflict counts and evidence labels alongside workload/performance coverage.

## Verification

Six new tests cover missing/null/nonboolean flags, true starts versus explicit reserve flags, non-dilution by unknown observations, conflict order independence, uncertifiable legacy booleans, conflicting versus valid starter-pair controls, and production profile application into frozen evidence while retaining a current confirmed starter. Some checks share a test case; six is the test count, not the number of input variants.

Complete suite: **316 passed, no failures/skips**. Syntax and whitespace checks pass. All added records are synthetic. Current lineup/team/athlete identity, availability conflict and isolated prospective regression coverage remains in the suite.

## Remaining limitations

A boolean is still a provider/manual assertion, not independently attested historical participation. This contract does not reconstruct preexisting coerced flags without their original summaries. Explicit legacy/manual starter-rate inputs remain usable estimates but are labeled unknown provenance and have no certified starter sample count unless supplied. More complete role, minute/snap and active-status semantics need source-specific validation.

League-specific workload denominators, external season calendars, remaining team-feature defaults, native source publication chronology, running-host validation and sufficient matched forward accuracy/calibration/costed returns remain incomplete. The original prospective captures are preserved. cPanel is excluded; live trading remains disabled. Sports remains in progress, followed by Crypto then Stocks.
