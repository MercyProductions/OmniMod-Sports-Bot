# Local ML scoring and chronological ordering

## Confirmed defects

In `sports-bot/src/localMl.js`, `scoreRows` chose Brier coordinates from the forecast's draw mass alone. A binary forecast followed by an actual draw was scored against away/home zeros, omitting the observed draw coordinate. Its mean Brier could therefore be understated. The scorer also clipped probabilities to [0.001, 0.999] before log loss: a probability-zero outcome was capped at about 6.9078 loss, while a correctly certain forecast received an artificial positive loss.

`trainLocalMlModels` sorted scheduled starts lexicographically. Explicit-zone timestamps that describe the same chronology can sort differently as strings; this changed the training/validation membership, ordering and training artifact despite unchanged information.

## Repairs and scope

Brier scoring includes the draw coordinate when the actual outcome is draw, even when its forecast probability is zero. Other binary outcomes retain their existing two-coordinate mean; three-way vectors retain three-coordinate mean. Log loss uses max(1e-12, actual-outcome probability), with no artificial upper cap. The fitted stump algorithm and evidence vectors are unchanged.

Starts now sort by parsed explicit-zone instants, with event ID as the deterministic tie breaker. Unknown start clocks remain research-only through existing cohort chronology requirements; ordering them does not attest unavailable data. Training labels still must precede the earliest validation forecast, and final fits still exclude validation outcomes.

New training output labels the validation protocol `fixed-22-round-fit-before-chronological-validation-v3` and scoring protocol `mean-coordinate-brier-observed-outcomes-log-floor-1e-12-v2`. Previously stored metrics are not rewritten. Artifact format remains v2 because fitted-weight serialization/integrity is unchanged; a changed training set or ordered training hash still changes artifact identity. Existing model files were not opened for writes or refitted. No validation outcome was used to optimize these fixes.

## Verification and valid measurements

- Initial baseline: 700/701 passed; one concurrent-child-writer test failed with Windows EPERM while opening its lock. The exact focused file subsequently passed 11/11, and a full unchanged retry passed 701/701. Both logs are retained; the transient cause remains unproven and no lock was stolen or test retry hidden.
- Five additional fixture regressions; four fail against preceding localMl source. The fifth confirms equal-start/input-order invariance remains supported.
- Focused scorer, candidate-cohort, ML and selection-protocol tests: 38 passed.
- Full repaired suite: 706 passed, zero failures/skips. Syntax and whitespace checks pass.
- In a 50/50 binary forecast with actual draw, baseline/model mean Brier changes from 0.25 to the correct 0.50. Probability-zero log loss changes from -ln(0.001) to -ln(1e-12). A correctly certain baseline now has log loss zero.
- Alternating +14:00/-12:00 start representations produce the same artifact, holdout metrics and 71 training rows as canonical UTC starts. Caller records are unchanged.

All measurements above are deterministic fixture behavior, not actual prediction improvement or profitable results. Promotion remains governed by independent prospective preregistration/review; reinterpreting old scores does not authorize reusing consumed holdouts.

## Remaining work

Candidate-vector class declarations, broader historical/training feature availability, score-unit consistency across reports, strict clocks in remaining paths, settlement/source provenance and real prospective performance still require investigation/evidence. The Windows EPERM observation remains documented for recurrence investigation. Actual installed state/startup remain unverified because Sports is offline. No deployment, merge, model promotion, live trading or production data changes. Sports remains in progress, followed by queued Crypto then Stocks requirements.
