# Specialist role availability and health evidence — v6.0.58

## Confirmed integration defects

The primary evidence model already distinguished unknown health from role priors, but the sport-specific challenger used a separate calculation. In [`sportModels.js`](../sports-bot/src/sportModels.js#L109), a numeric availability default attached to a probable starter could supply a health adjustment despite its `role_prior_not_injury_clearance` tag. A stored full-workload projection bypassed current Out/inactive/zero-availability observations. Fractions and percentages were interpreted differently from primary inference. The old team-name-or-side test could also admit a player with an opponent team and contradictory side hint.

The challenger received only `game.autoPlayers`; a valid newer manual status selected by primary inference was not forwarded into its direct role calculation. Repeated same-player rows could change their weighting. Two further inference checks reproduced double counting through a team abbreviation and use of a later nested workload receipt.

These are source/fixture findings. They do not prove a production wager, a change in historical accuracy, or that every prior prediction was affected. The saved twelve-game real NHL slate has **zero automatic player rows and zero lineup rows**. That sample cannot demonstrate an empirical benefit from changing player-role calculations. Its original bytes were preserved.

A separate credential-free calculation ran the exact prior specialist source from commit `9b56ca0` against the repaired source with synthetic, symmetric teams and the same zero model logit. This measures implementation behavior only:

| Synthetic away-goalie input | Prior home expected goals | Repaired home expected goals |
| --- | ---: | ---: |
| Unknown health, role-only numeric default | 2.812691 | 3.050000 |
| Explicit available, full-workload projection | 2.812691 | 2.812691 |
| Explicit Out, contradictory full-workload projection | 2.812691 | 3.367402 |
| Availability1 as a fraction | 3.361346 | 2.812691 |
| Availability100 as a percentage | 2.812691 | 2.812691 |

The paired healthy/Out case previously produced identical expected scores; the unit-equivalent1/100 inputs previously differed. Original source bytes, the scenario script, exact results and repaired processor hashes are private. These synthetic expected scores are uncalibrated model outputs, not actual game forecasts or performance evidence.

## Implemented behavior

- [`dataValidation.js:77`](../sports-bot/src/dataValidation.js#L77) exports the established primary health scale. Unknown status and role-only numeric defaults remain null. Explicit negative status/inactive/zero observations still veto; equivalent 0–1 fractions and 0–100 percentages agree. Invalid numeric types are not converted into observed zero health. These are heuristic source assertions, not medical probabilities.
- [`predictionEngine.js:649`](../sports-bot/src/predictionEngine.js#L649) passes its selected automatic/manual player rows and controlled information cutoff to the specialist without changing the original game. Existing manual freshness, expiry, league and chronology selection remains in force.
- The specialist requires a uniquely matched local side using names/abbreviations/declared aliases, rejects contradictory side or league hints, and excludes known invalid/future/expired observations. Matched aliases are canonicalized locally before existing conservative player reconciliation, so one known player is not weighted twice through a team abbreviation. Unbound identities and contradictory assertions remain auditable rather than being silently assigned to an opponent.
- Unknown health does not receive a directional health adjustment or count as an observed assertion. A current health assertion caps any valid workload ratio. Missing/malformed workload values do not turn into fabricated zero participation, and a known later/invalid nested workload receipt cannot influence an earlier role adjustment.
- [`buildSportModelPrediction`](../sports-bot/src/sportModels.js#L257) reports `sports-specialist-availability-v1`: cutoff, per-side role counts, unknown health/clocks, invalid workload, structured exclusions and missing roles. Exclusion totals count role checks, not distinct people. Legacy untimed assertions remain visibly unknown in clock coverage; their publication truth is not certified.
- The same evidence is included in [`prediction.evidenceCoverage`](../sports-bot/src/predictionEngine.js#L766) and the returned sport-model diagnostics. The existing immutable forecast journal freezes it with original probabilities. No journal or old evidence is backfilled.

Existing sport equations, coefficients, centered 0.55 role baseline, blending limits and production approval/risk/value thresholds were retained. The affected role adjustments cover MLB starting pitchers/bullpen, NFL quarterbacks/offensive line, NHL goalies and soccer goalkeepers. The numerical roster average is still a heuristic: it does not establish event starting-goalie identity, certified depth-chart membership, replacement value, complete injury coverage or calibrated participation probabilities. Those remain research/data requirements.

## Verification and evidence limits

The reproduced pre-edit default-parallel baseline passed **1,016 tests**. The initial twelve-test role suite had eleven failures before repair, including expectations for previously absent diagnostics; that is not eleven observed scoring incidents. The abbreviation and nested-projection scenarios separately failed before their follow-up fixes. Fifteen tests were added in total, including controls for all four existing sport equations, current restrictions, unknown health, units, duplicate reconciliation, chronology, manual precedence, invalid cutoff and frozen journal evidence.

Focused specialist/health/manual/provider/model checks passed **78** tests. Final full `npm test` passed **1,031**, zero failed/skipped. `npm run check` parsed **210 project files** and whitespace checks passed. See the [structured checklist](SPORTS_SPECIALIST_HEALTH_CHECKLIST.json). These checks establish tested behavior, not better forecasting or economic returns.

Development model identity is **v6.0.58**. Existing source-bound artifact approval cannot silently certify this changed source; independent model validation is still required. No model was promoted. No provider requests, subscriptions, credentials changes, orders, Discord posts, production startup, merge or deployment were performed in this phase.

The hourly NHL Daily trial remains pinned to v6.0.52 with its original archived source, plan and artifact. At the latest checked capture it still has twelve distinct games, one date and zero finals; minimum evidence remains 75 games/eight dates/fourteen days. The current source is not substituted into that study. Missing injuries/confirmed goalies, source mapping/publication truth, adequate league-level forward evidence and executable odds terms remain unresolved. Live trading remains disabled, Stocks tests remain scheduled and unchanged, and Sports remains ahead of the full queued Crypto then Stocks specifications.
