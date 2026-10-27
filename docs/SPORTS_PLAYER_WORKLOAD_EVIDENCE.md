# Historical player workload evidence

Development model: OmniMod Evidence Ensemble v6.0.16. Baseline 297 tests at commit 10faa32. Source only; no deployment, promotion or live trading.

## Confirmed defects

Historical participation used missing-as-zero metric helpers with positive floors. Missing basketball/hockey minutes became an 8% historical workload estimate. Soccer used a truthiness fallback: a starter with a genuine zero-minute record became an 85% workload estimate. Baseball missing opportunities likewise received a floor. Football attempts/receptions/tackles and starter status generated a supposed snap-share history without measured snaps. Total boxscore rows then increased participation reliability, even when workload was unobserved. The projection itself imposed another 2% floor on genuine zero history.

Five initial regression tests failed against that behavior. A later legacy-data control confirmed that simply changing the parser would leave old derived estimates trusted unless profile rebuilding and projection sample counts were repaired too.

## Repairs

- `sports-bot/src/advancedMetrics.js:170`: participation extraction requires the relevant nonnegative observed minutes, time on ice, innings or batting opportunities. True zero remains zero; absent/malformed/negative values remain unknown. Existing normalization denominators are retained as workload proxies. Plate appearances are preferred over at-bats when both are supplied.
- Football opportunity counts are no longer called measured snap-share history. Unsupported football/tennis/combat workload falls back at projection time to an explicit role prior, not fabricated historical observations.
- `sports-bot/src/advancedMetrics.js:257`: parsed rows identify the observed-workload contract. `:305` rebuilds workload from retained raw stats, including legacy rows, and counts only usable workload observations. Contract-free estimates lacking raw workload do not certify measured participation samples.
- Profile participation is null when unknown. Total appearance sampleSize remains separate from participationSamples. Impact remains an explicit heuristic: absent workload uses the existing shared role prior, with reliability based on actual workload samples; its evidence label identifies that fallback. This changes forecast inputs and needs forward validation.
- `sports-bot/src/participationProjection.js:45`: genuine zero survives averaging and projection without an invented positive floor. Invalid numeric forms are rejected by the shared finite-number parser. The output labels role priors, workload proxies and legacy unknown provenance separately.
- Participation reliability requires a declared participation sample count, never just total boxscore games. A legacy estimate may remain an explicitly labeled projection input but receives zero measured-history reliability. Counts are source assertions, not independent provider attestation.
- `sports-bot/src/advancedMetrics.js:670` propagates workload sample counts through the production profile caller. `sports-bot/src/evidenceCoverage.js:70` freezes those counts and projection evidence labels in per-game model-input diagnostics.

Existing player identity tests now declare workload sample counts for both matching and conflicting identities. Keeping nonzero counts on the deliberately conflicting identity ensures those tests still detect accidental borrowing rather than passing because all legacy counts became zero.

## Verification

Seven new tests cover missing versus zero durations across timed sports, baseball opportunities, football non-snap counters, profile/projection reliability, zero preservation end to end, legacy-data rebuilding, and the production caller into frozen evidence coverage. Existing availability, team/athlete identity, starter conflict, lineup, historical rebuild and model-selection tests remain in the full suite.

Complete suite: **304 passed, no failures/skips**. Syntax and whitespace checks pass. All added observations are synthetic; this is evidence of repaired mechanisms, not improved win probability calibration or economic returns.

## Remaining limitations

The normalization denominators and workload labels are historical heuristics, not verified league-specific playing-time models. Basketball still uses a 40-minute normalization; this needs separate NBA/NCAA validation. Measured zero historical workload is not a guarantee of zero future participation. Football requires a legitimate snap-count source before claiming learned snap-share coverage. Historical performance formulas, starter-observation missingness, player-group stat merging and possible legacy performance defaults remain to be audited. This phase does not certify all player metrics or medical availability.

External season-selection calendars, native publication/revision lineage, disconnected opponent-rating comparability and adequate forward accuracy/calibration/costed-return evidence remain unfinished. Existing prospective captures are unchanged. Running-host state is unverified and cPanel excluded. Sports remains in progress, with Crypto then Stocks queued afterward.
