# Team-scoped lineup and historical player identity

Development prediction identity becomes **OmniMod Evidence Ensemble v6.0.8**. Existing v6.0.7 prospective captures remain immutable and describe their archived source, not this new behavior. No champion promotion, deployment or production learner changes are part of this repair.

## Confirmed defects

1. `participationProjection.js` previously indexed event lineups by athlete ID or normalized name without team, while projection rows were team-scoped. Two opposing players with the same fallback name could therefore share the last lineup record. A fixture gave an active confirmed away starter a zero start probability because the home player's record was inactive. Team is now included in the lineup lookup key, matching the existing projection row key.
2. Historical participation matching permitted a same-name fallback even when both rows had different known athlete IDs. It also ignored `sourceAthleteId` when testing exact ID equality. A new player inherited 99 history samples from another player; the reverse case, a stable ID with a changed display name, missed its history. `samePlayerIdentity` compares known IDs first and permits name fallback only when at least one ID is absent. Empty names never match by themselves. `advancedMetrics.js` uses the same predicate within its existing league/team scope, covering the actual production caller as well as the standalone projection helper.
3. `autoEnrichment.js` indexed roster starter flags by athlete ID alone. A colliding ID in the other team's roster could confirm a probable starter or injury row. Starter flags are now team/ID scoped. A roster without a team cannot establish confirmation for a team-specific player.

These are joining/integrity defects, not evidence that the affected conditions occurred in a particular real game or explain reported historical accuracy. The version change separates forecasts whose probabilities could change through corrected participation, impact, form or lineup inputs.

## Regression evidence

`test/evidence-coverage.test.js` adds four tests:

- Opposing same-name players, with and without colliding IDs, retain their own lineup activity and starter state.
- Conflicting known IDs cannot borrow history; a stable ID matches despite a changed name.
- The advanced-profile caller preserves those identity requirements when attaching historical stats and participation.
- Roster confirmation cannot transfer across teams or from a roster with unknown team identity.

Before source repair, the initial three new tests all failed: away start probability was 0 instead of 1; conflicting history sample count was 99 instead of 0; cross-team confirmation was true instead of false. The fourth test covers the discovered caller, which shared the same erroneous name fallback. The existing injury parser fixture needed an explicit roster team to continue asserting confirmed status; missing-team confirmation is now tested as false rather than silently assumed.

The initial baseline suite encountered two `Invalid capture chronology` failures in the isolated-worker tests. A focused rerun passed all four isolation tests. A short independent parent/child clock probe found child readings 6–7 ms before the parent's final reading; that does not explain the intermittent failure. No chronology tolerance or eligibility gate was weakened. This remains a reliability investigation, not proof that the machine clock is defective. The source-fix run also caught the old missing-team fixture described above, which was corrected to state its intended evidence explicitly.

## Limits and next work

Name fallback remains weaker than provider IDs and can still be ambiguous when a provider omits identifiers. Same-team contradictory duplicate records and source-specific ID namespaces require further reconciliation/provenance work. IDs here are treated within the existing provider context; this is not a global cross-provider identity registry. The caller-supplied learned-profile function remains responsible for its own lookup contract; the existing advanced-profile caller was inspected and corrected.

The frozen live study still has only two NHL pregame pairs awaiting outcomes. A software identity repair does not establish better calibration, prediction accuracy or after-cost returns. Real transport failure/retry, abrupt process recovery, permitted enrichment access and broader forward evidence remain unfinished. cPanel remains excluded by user instruction.

Final pre-commit verification: `npm test` passed all 237 tests, zero failures/skips; `npm run check` and whitespace checks passed. These fixtures verify the joins, not live provider identity completeness.

After committing the repaired source, all four isolated-worker integration tests passed again, archiving the new committed challenger. This verifies execution of that source in the fixture harness; it does not resolve the earlier intermittent chronology failures.
