# Historical scores, venue correction and opponent-rating convergence

Development model: OmniMod Evidence Ensemble v6.0.15. Baseline 291 passing tests at commit 185c491. These are source repairs requiring forward validation; no production deployment or promotion.

## Reproduced defects

- `Number(null)`, blank strings and booleans could enter opponent ratings as zero-score games. A null-score fixture increased the measured sample count from one to two. The advanced boxscore team-rating path had the same coercion risk.
- The home-advantage average included neutral-site score margins, even though neutral games received no home correction afterward. A fixture with a 10-point home margin and 90-point neutral margin estimated 50 rather than 10 points of home advantage.
- The ten-step undamped opponent-rating iteration oscillated on a two-team neutral matchup. A 10-point result returned raw ratings zero/zero instead of the centered equation solution +5/-5. Merely adding more even-numbered iterations would preserve that failure.

Tests exposed the existing pure calculation through an export and added intermediate diagnostic fields before correction. These failures are mathematical fixtures; they do not prove how frequently the defects affected actual predictions.

## Implemented repairs and references

- `sports-bot/src/advancedMetrics.js:396`: shared historical-row qualification requires measured nonnegative scores and distinct nonempty team identities. Numeric zero and numeric strings remain valid. Unknown, blank, boolean, object, NaN and negative scores cannot become measured results.
- `sports-bot/src/advancedMetrics.js:411`: estimate home advantage only from explicitly non-neutral games. Neutral and unknown-venue games remain rating evidence without a home correction. An empty home-venue cohort has unknown observed advantage, recorded as null with sample count zero; the numerical correction is zero, not a claim of measured zero advantage.
- `sports-bot/src/advancedMetrics.js:421`: centered, damped fixed-point updates solve the existing opponent-adjustment equations. Stop only when the maximum equation residual is at most 1e-7; bound work at 1,000 iterations. A league failing that bound produces no new opponent-adjusted ratings. Damping changes numerical convergence, not the target equations or feature blending weights.
- `sports-bot/src/advancedMetrics.js:549`: advanced boxscore team ratings use the same score/identity qualification before offense, defense and sample-count calculations.
- `sports-bot/src/advancedMetrics.js:616`: successful team-profile enrichment retains observed home advantage, its sample size and solver convergence/iteration diagnostics.

The public enhancement callers rebuild base team profiles before this stage. This change does not introduce a general migration/cleanup of arbitrary manually supplied profiles that already contain old derived fields. The pure opponent-rating calculation is exported for reproducible auditing.

## Verification

Six added tests cover invalid versus genuine-zero score inputs, neutral and unknown venues, incomplete boxscore exclusion through the public enhancement path, the two-team oscillation, multi-team equation residuals and score-direction symmetry, and a slowly converging 64-team path whose intermediate result must be excluded. Baseline fixture observed 50-point contaminated home advantage; repaired fixture observes 10. Two-team raw solution is +5/-5 after repair. These are valid before/after mechanism measurements, not predictive performance metrics.

Complete suite: **297 passed, no failures/skips**. Syntax and whitespace checks pass. Initial focused tests also preserve existing historical rebuild, lineup and Elo regression coverage. All new matchups are synthetic; the existing two-game real prospective study remains unresolved before kickoff. Its original captures and model pins are unchanged.

## Remaining limitations

The shared month-based external season-selection calendar remains unchanged and unverified across leagues. Season/roster transitions, remaining player-performance defaults and other upstream feature units still need review. An opponent-adjusted rating is a descriptive heuristic, not a calibrated win probability. The solver does not establish cross-component comparability for disconnected schedules, model validity, statistical significance or improved future forecasts. Slowly converging leagues are omitted; a more capable sparse/direct solver can be evaluated separately if real coverage measurements justify it.

Underlying source publication/revision chronology, the actual running host, live Discord behavior and sufficient matched forward accuracy/calibration/costed-return evidence remain incomplete. cPanel is excluded. Keep live trading disabled. Sports is still in progress, followed by Crypto and then Stocks.
