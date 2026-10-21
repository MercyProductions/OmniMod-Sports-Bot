# Unknown measurements must not manufacture a directional difference

Development prediction identity becomes **OmniMod Evidence Ensemble v6.0.12**. This repair changes input semantics, so it must not be pooled with an older model's calibration or treated as a demonstrated improvement. No champion promotion, production deployment, live data request or Discord post occurred. Original archived baseline/v6.0.7 forecasts are unchanged.

## Reproduced defects

Five initial tests failed before behavioral repair:

- Historical advanced differences used `Number(value || 0)`. A known metric on one side and an absent metric on the other produced a directional difference. The mechanism affected baseball bullpen, basketball efficiency, football EPA, hockey expected-goals proxies, soccer shot quality and shared play features.
- Historical pace averaged whichever side was available and discarded a genuine all-zero result through `|| null`.
- External NFL/NHL/NBA arithmetic coerced missing values to zero; NHL also substituted one game for missing/zero game counts. Incomplete evidence could become a numeric advantage.
- Tennis serve/return expressions substituted `.6`/`.4` for both missing values and genuine zero. A fixture whose measured differential was 1 instead returned 0.
- NFL import replaced missing EPA components and game counts with zero/one defaults. A zero-game record with a missing component yielded 4 EPA/game instead of an unknown rate.

These are mathematical/data-integrity defects. Fixtures prove the mechanisms, not that the same records occurred in a reported production loss or that repairs improve future scores.

## Repairs and source references

- `dataValidation.js:15`: `measuredCalculation` requires every input and the result to be finite. Existing `finiteNumber` distinguishes absent/blank/boolean/malformed input from numeric zero. Nonfinite results remain unknown; signed zero is normalized to zero.
- `sportsData.js:626`: the existing pure `derivedAdvancedDataset` stage is now exported for direct audit/testing. Two-sided differences require both measured sides; pace requires both observations. Missing individual expected-runs/xG values remain null. Receipt provenance remains intact.
- `advancedDatasets.js:20`: per-game rates require observed totals and positive observed game counts. NFL combined EPA requires both components. NHL net expected-goals/goals-saved calculations preserve unknown components and denominators; NBA pace/net-rating comparisons require both sides. Missing sample counts are null rather than fabricated zero.
- Tennis retains measured zero serve/return rates and computes their difference only when all required values are known. The existing surface-to-overall Elo fallback is retained as an explicit model fallback; no unsupported surface history is invented.
- `evidenceCoverage.js:51` records enumerated missing measurements and `advanced_dataset:measurements_incomplete`. Zero is not listed as missing. Metadata timestamps/provider fields are excluded from that measurement list. This enumerates existing fields; it does not attest that every expected league feature is present.

No coefficient, minimum score, EV threshold, risk or uncertainty gate was lowered. Downstream models may retain existing explicit priors or neutral contributions for unknown features; those are modeling assumptions, not measured observations. Broader missingness-aware modeling still needs validation.

## Verification

Baseline: **272 passed**. Added six tests, including table-driven historical checks across five sport families and synthetic adapter payloads. Negative controls exercise undefined, null, blank, boolean and NaN inputs. Positive controls preserve zero, valid two-sided pace, and the existing NFL normalization factors (60/38/24), NBA difference signs and NHL per-game/net-rate arithmetic. Provider fixtures preserve zero-game sample counts as zero while rejecting those counts as rate denominators; absent sample counts remain unknown.

The first corrected run exposed negative-zero representation in an inverted zero difference; the shared helper now normalizes it. Tests also verify incomplete measurements are frozen in evidence diagnostics while true-zero CPOE is not marked missing.

Complete suite after repair: **278 passed, zero failures/skips**. `npm run check` includes the new test and passes; whitespace checks pass. All provider responses in the added tests are synthetic. No actual accuracy, calibration or wagering-return improvement is established.

## Remaining work

Provider payload validation and historical year/season cache identity remain pending. Review other upstream historical feature constructors and any missingness lost during numeric ML encoding. These tests do not validate every statistical unit, range, source schema or sport-specific heuristic. Native publication/revision lineage, league-specific calibration, adequate matched prospective outcomes and costed-price evidence remain incomplete.

Current running-host/live Discord state is unverified; cPanel remains excluded by user instruction. Keep live trading disabled. Sports is unfinished; Crypto and Stocks remain queued afterward.
