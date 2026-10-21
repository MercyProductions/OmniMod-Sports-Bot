# Player performance parsing and evidence integrity

Development model: OmniMod Evidence Ensemble v6.0.17. Baseline 304 tests at e43117a. Source only; no deployment, promotion or live trading.

## Reproduced defects

- Missing statistics entered player performance equations as numeric zero. Missing soccer rating therefore contributed a negative baseline; an incomplete soccer profile averaged -2 as if measured.
- Key normalization discarded `+/-` entirely. It also converted both `SV` and `SV%` to `sv`, colliding goalie save counts with save percentage.
- Numeric-prefix parsing accepted strings such as `12 injured`. Clock seconds above 59 were accepted; `1:99` became workload evidence. A 0/0 statistic was represented as measured zero.
- Player groups merged flat statistics by last-write-wins. Passing 100 yards followed by rushing 20 yards left a single 20-yard value. Reversing the provider group order changed the retained value.
- Historical averaging had no separate performance sample count or explicit neutral-form fallback provenance.

Four initial regressions failed. The later group-merging regression reproduced the overwritten 20-yard value. These are fixture measurements, not an attribution of production losses.

## Repairs and source references

- `sports-bot/src/advancedMetrics.js:30`: preserve plusminus and pct keys. SV and SV% now remain distinct; an explicitly percent-formatted goalie rate such as 90% is converted to .9. Other percentage fields retain their existing percentage-point convention; full provider-unit validation is still incomplete.
- `sports-bot/src/advancedMetrics.js:40`: parse the entire cleaned numeric value, reject invalid seconds and invalid baseball outs digits, normalize both numeric and text innings notation, and preserve unknown zero-denominator ratios while retaining observed numerator/denominator counts.
- `sports-bot/src/advancedMetrics.js:109`: a performance formula produces a value only when every consumed component is observed. Existing coefficients, bounds and formulas are retained. Missing inputs no longer become measured contributions; unsupported sport profiles remain unknown. This can reduce measured performance coverage, especially when provider fields do not support the old formula.
- `sports-bot/src/advancedMetrics.js:194`: retain statGroups and a sorted statConflicts list. Conflicting flattened values remain null across subsequent merges. Generic fields shared between recognized passing/rushing/receiving/pitching/batting groups are ambiguous even when numeric values happen to match; they are not summed or silently chosen.
- `sports-bot/src/advancedMetrics.js:330`: rebuild performance from retained raw stats under the current formula and separately count finite complete performances. Incomplete samples do not dilute the average. Contract-free cached numeric estimates without raw inputs cannot establish observations. Unknown performance remains null; impact uses an explicit numeric prior contribution of zero and form uses a labeled neutral prior of 50.
- `sports-bot/src/advancedMetrics.js:699` and `sports-bot/src/evidenceCoverage.js:71`: propagate complete-performance sample counts, historical conflict keys and form-evidence labels into per-game diagnostics.

The formula itself remains a descriptive heuristic, not a calibrated probability or a validated player-value model. Requiring complete inputs does not establish that every coefficient or input unit is appropriate.

## Verification

Six new tests cover incomplete scores across seven sport families, plusminus and save-rate identity, malformed numeric/clock/innings values and zero-denominator ratios, unknown profile aggregation, order-independent group conflicts (including equal values from distinct football groups), and complete versus incomplete averaging with real zero/nonzero controls.

Complete suite: **310 passed, no failures/skips**. Focused missing-value suite: **25 passed** after expanded table controls. Syntax and whitespace checks pass. All new fixtures are synthetic; no live source access or improved predictive performance is claimed.

## Remaining limitations

Older flattened group records cannot recover source fields already overwritten; original provider summaries are needed to reconstruct them. This is not a universal semantic mapping for all boxscore groups, nor a complete unit/range/duplicate-row validator. Full multi-position aggregation needs a separately defined and validated model rather than arbitrary summing. Starter-observation missingness, league workload denominators, seasonal selection, and remaining team-feature defaults need further review.

The original real prospective captures remain unchanged. Adequate matched forward accuracy, calibration, after-cost evidence, native source publication lineage and running-host verification remain incomplete. cPanel is excluded. Sports remains in progress, followed by Crypto then Stocks.
