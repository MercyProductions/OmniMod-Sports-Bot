# Team feature measurement integrity

Development model: OmniMod Evidence Ensemble v6.0.20. Baseline 322 tests at b66b20e. Source changes only; no deployment, promotion or live trading.

## Confirmed defects

Six initial regressions failed. Basketball missing free-throw attempts could still create possessions/efficiency. Football missing turnovers could contribute zero to an EPA proxy, missing drives defaulted to ten and small observed drive counts were replaced with six. Hockey missing shots substituted actual goals as expected-goal evidence. Soccer a single available shot count implicitly supplied the other as zero. Baseball missing opportunities substituted actual runs as expected runs. Unknown offense could become zero defense through unary negation, and incomplete records entered advanced-rating sample counts.

Two labels were especially misleading: total team runs allowed were used as a bullpen-runs proxy, and negative total goals allowed could become a historical GSAx input downstream. Neither total establishes bullpen-only runs or goals saved above expected.

## Corrections and references

- `sports-bot/src/advancedMetrics.js:490`: observed counts reject unknown/negative inputs, while signed yards-per-play remains signed. Derived measurements require all their inputs. True zeros are retained.
- `:494`: one possession calculation is shared across basketball offense and specialized features, including existing attempted-shot aliases. Incomplete inputs remain unknown. The existing >20 efficiency eligibility rule remains; observed zero possessions can be represented but cannot establish a positive-denominator rate.
- `:502`: advanced offense no longer falls back to the final score when its required statistics are missing. Existing complete-input coefficients remain. Unsupported advanced sport formulas remain unknown.
- `:519`: football points per drive uses an observed positive drive count; no ten-drive default or six-drive replacement. EPA proxy requires observed components. Hockey expected-goal proxy requires its shot/power-play inputs. Soccer shot proxy requires both consistent shot counts, while reported zero xG remains valid. Baseball expected-run proxy requires positive observed opportunities and its numerator inputs.
- Total runs/goals allowed remain separately named teamRunsAllowed/teamGoalsAllowed. bullpenRunsAllowedProxy and goalPreventionProxy remain null without the required independent evidence. Consequently historical team totals cannot masquerade as bullpen or GSAx measurements. This removes unsupported feature inputs; it does not invent replacements.
- `advancedTeamRatings` excludes null offense/defense from means and league normalization. Offense and defense reliability each use their own observed sample counts. A combined rating requires both sides. Missing advanced data does not blend a fabricated value into base offense/defense.
- Each scalar feature has an observed sample count. Play event counts distinguish unknown from true zero. Total advancedBoxscoreSample is retained as a record count, distinct from metric coverage.
- `sports-bot/src/evidenceCoverage.js:69`: freeze offense, defense and per-feature counts in per-game selected-team input diagnostics. Feature counts are evidence coverage, not calibrated confidence or universal native-data verification.

## Verification

Nine added tests cover basketball partial inputs, football missing/zero/signed values and actual drive counts, hockey actual-versus-expected goals, soccer partial/report-zero xG, baseball zero/unknown opportunities and unsupported bullpen attribution, partial averaging/sample counts, missing-team exclusion from cohort normalization, one-sided ratings with frozen counts, and unknown-versus-zero play events.

Complete suite: **331 passed, no failures/skips**. Syntax and whitespace checks pass. A complete basketball control preserves 90.8 estimated possessions under the existing formula. A complete football proxy remains .36 even when an incomplete record is added; its observed sample count remains one. All added data is synthetic. No actual accuracy, calibration or economic improvement is established.

## Remaining limitations

The retained complete-input offense, xG/run/EPA proxies and coefficients are heuristic models, not provider-native expected statistics. Per-feature counts do not independently calibrate those proxies. The possession coefficient, rate units/ranges, source schemas, bullpen usage and actual goalie-specific evidence need further league/provider validation. Missing data may reduce modeled coverage; that is not a reason to restore fabricated inputs or lower approval gates.

External season calendars, real source completeness/publication lineage, live runtime identification and sufficient matched forward outcomes remain unfinished. The host-location question is pending; cPanel remains excluded. Original prospective captures are unchanged. Sports remains in progress, followed by Crypto then Stocks. Keep live trading disabled.
