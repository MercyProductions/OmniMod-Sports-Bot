# Frozen per-game evidence coverage — development v6.0.2

This continuation fixes input-integrity defects and records what a forecast actually received. It does not establish improved predictive accuracy. No production process or registry was changed.

## Confirmed corrections

1. `autoEnrichment.js` set probable starters to `starter: true`; participation projection treated that role flag as confirmation. Probables now carry explicit projected/confirmed status. Only a matching current-event roster starter record confirms an ESPN probable. The official MLB schedule's probable pitchers are also projected, with separate probable and confirmed counts.
2. `predictionEngine.js` awarded five injury-report quality points whenever `injuries` was an array, including an empty array with no team coverage. Summary quality now requires a fresh, nonfuture fetch receipt; the injury bonus requires identifiable team report coverage. A team report is explicitly not a clean bill of health. Fresh receipt time does not attest freshness of the underlying medical information.
3. Projected-player availability previously appeared both inside the starting-share mixture and outside it, reducing workload twice. Confirmed-but-out players could retain a positive start probability. `participationProjection.js` now separates conditional starting probability from unconditional starting probability and applies availability once to expected workload. A schedule's “probable starter” label is separated from a medical “probable” status. These remain heuristic participation estimates, not clinically or statistically calibrated probabilities.
4. Role-prior availability values had no provenance. Their numerical compatibility prior is retained, but coverage explicitly identifies it as an assumption rather than observed healthy-player evidence.

Because forecast inputs and workload calculations changed, the model identity is now `OmniMod Evidence Ensemble v6.0.2`. Frozen v6.0.1 records retain their identity. An ML/hybrid champion supported only by the previous version's cohort falls back to evidence pending revalidation; it is not promoted into the repaired version.

## Per-game report

`evidenceCoverage.js` generates `sports-evidence-coverage-v1` at the model's information cutoff. `predictGame` supplies the actual player/team rows after manual/automatic precedence, and `predictionJournal.js` freezes the report alongside original probabilities. Later injury or lineup updates cannot rewrite it.

The report includes per-side history samples, player-history sample sizes, actual selected manual/automatic sources, numeric zeros versus absent values, confirmed versus projected starter counts, critical quarterback/pitcher/goalie status, injury-report coverage, source receipt times/cache states, future/stale/missing data, corroboration conflicts, neutral-venue assertion and roster-transition metadata. Bullpen availability, late-scratch monitoring, source observation freshness, advanced-stat completeness and venue independence remain explicitly unverified where evidence is absent. Missing source timestamps are never synthesized from fetch receipts.

Read the frozen reports without provider requests, Discord, model training or orders:

```powershell
npm --prefix sports-bot run audit:evidence
```

The audit distinguishes issued forecasts with a frozen report from older issued records without it; it never reconstructs old inputs. Multiple horizons/versions remain correlated forecast observations, not independent games.

## Verification and limits

The full baseline before this phase was 139 passing tests. The full suite after the corrections has 147 passing tests, and configured syntax checks pass. Eight new tests cover projected versus confirmed pitchers, team-specific injury coverage and the exact five-point bonus correction, stale/future receipts, zero/missing separation, actual selected manual inputs, unknown legacy coverage, single-count availability and inactive old-version champions. Existing immutable-journal tests also verify that coverage cannot change on re-read.

The read-only audit in the development clone found zero issued forecasts and zero frozen coverage reports. That is a measured absence of prospective evidence in this environment, not a success or failure rate. Synthetic fixtures verify arithmetic and metadata semantics only. Real NFL QB replacements, NBA rotations/late scratches, MLB bullpen use, NHL goalie confirmations and soccer lineup/draw behavior still require source-level and prospective observation validation.

Next: finish mapping previous repairs to their current tests, extend matched sport/version/horizon evaluation with game-correlated uncertainty and coverage strata, inspect model-selection chronology and holdout reuse, and collect isolated prospective baseline/challenger forecasts. No accuracy or costed-value improvement is claimed. Deployment and model promotion require separate approval.
