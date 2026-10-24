# Feature learner chronology and frozen-fit repair

## Confirmed defects

The previous `buildWalkForwardFeatureModels` sorted examples by schedule date, then updated weights after every scored row. Its validation was an evolving online procedure, while runtime received a final refit with a separately calculated shrinkage factor. The returned weight vector therefore was not the vector whose score justified acceptance. Same-day overlapping games could use each other's outcomes without checking result availability. The feature-row collector also discarded event identity and outcome-observation timestamps, allowing repeated guild/horizon examples to appear independent. Finally, a positive retrospective feature score directly set `accepted`, which the prediction engine used to apply the weights automatically.

## Development changes

- `collectFeatureRows` retains game, league, model/horizon, prediction issuance, start and explicitly observed result timestamps. Missing result availability remains unknown; schedule date is not substituted for it.
- `attachFinalGrade` records `resultObservedAt` on an observed final. Identical grading retries retain it; score/winner revisions get a new observed timestamp. This is observation time, not inferred official game completion. Older records are not backfilled with guessed times.
- Training requires valid pregame and result chronology with labels available by the research cutoff. For a dated context the feature cutoff is that date's UTC midnight, matching the conservative earlier-date research filter; this is not a full exchange/league timezone reconstruction.
- One event/start per league enters the fit; repeated guild/horizon rows use the earliest prediction, and conflicting outcomes exclude the event.
- A fixed 70% chronological training / terminal validation split purges training labels not known before the first validation forecast. Training processes only eligible outcomes in availability order. Validation labels and validation-only features never update weights.
- Shrinkage and runtime weight bounds are applied before validation. The exact returned frozen vector is scored against the baseline. Artifact identity binds weights, training inputs and last training outcome time. Forecast records retain the candidate artifact ID.
- `researchAccepted` describes this limited retrospective comparison. `accepted` and `productionEligible` remain false: no feature candidate automatically enters runtime predictions. A governed, prospectively supported artifact-review path remains unfinished. No model has been promoted.
- The development prediction identity is v6.0.3 because unsupported learned-weight activation is removed. Frozen older predictions are not relabeled or recomputed.

This is a single terminal chronological research comparison, not sufficient independent evidence or nested model-selection governance. It does not fix every mutable-cache calibration, Elo seed, hybrid or historical context issue. Those remain explicit audit work; do not infer full timestamp correctness of the entire ensemble from the feature-layer repair.

## Verification

Baseline before this phase: `794ec8cefcf7e7c94554c08d3aa5c381c8d87f43`, 185 tests reproduced. Current full suite: 191 passing, zero failures/skips. Configured syntax and whitespace checks pass.

New regression tests verify held-out label and feature mutation cannot affect fitted weights or artifact IDs; overlapping/unavailable outcomes are excluded; duplicate game examples do not inflate training; contradictory results exclude a game; returned weights reproduce validation scores; and first result observation timestamps survive retries and change on corrections. Existing historical-cache tests now explicitly verify that absent result-availability provenance does not become feature-training evidence.

No real accuracy or costed improvement is established. Synthetic data demonstrates mechanics only. Production was not changed, no provider requests or Discord messages were sent, and live trading remains disabled. Sports continues before the queued Crypto and Stocks specifications.
