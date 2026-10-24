# Summary player reconciliation — v6.0.63

## Confirmed defects and controlled results

`parseEspnSummary()` stored probable starters and injuries in a map keyed by team/player. A later injury row replaced the entire previous player, even when it omitted position and statistics. A known starting pitcher could therefore become a positionless player with empty statistics and lower generic impact. The specialist then reported no observed starting-pitcher availability despite an explicit Out assertion for that same player.

Multiple same-time injury rows were also order-dependent: Out followed by Available returned availability100; the reverse returned0. There was no evidence that array order represented newer or more authoritative information. Three old-source regressions reproduced role loss, order dependence and the missing specialist input.

The repaired controlled cases retain the starting role and observed measurement, keep availability0 in both orders, and expose one observed injured starting pitcher to the specialist. This is fixture behavior, not a real-game accuracy or economic-performance measurement.

## Implemented behavior

[`autoEnrichment.js`](../sports-bot/src/autoEnrichment.js) retains separate probable/injury observations and tags their source kind, league and sport. Event-roster rows remain separate evidence. [`summaryPlayerEvidence.js`](../sports-bot/src/summaryPlayerEvidence.js) composes one same-player view through the existing availability reconciliation instead of choosing the last row. The existing automatic-impact coefficients were moved into the shared helper without retuning them.

The view:

- Preserves usable known roles when an injury row omits position. Generic Pitcher and explicit Starting Pitcher can coexist; incompatible critical positions remain a role conflict and cannot confirm a starter.
- Retains measurements from available source observations. Contradictory measurements become `null` with named conflicts; an empty injury-stat object does not erase another observation's values. Reported measurements are not certified season/sample-period evidence.
- Uses conservative, normalized observed health assertions. An Out/inactive assertion cannot be replaced by a role-only or Available row from the same information set. Missing or unrecognized medical status remains unknown. Source order does not select the health restriction.
- Preserves independent provider role/measurement evidence while retaining the summary restriction. Confirmed role and medical clearance remain different claims. A provider snapshot still requires its existing native identity, event, expiry and authorization contract; no external provider was connected here.
- Keeps injury-form treatment neutral, so retaining metadata does not add an injury-row performance bonus. No confidence, model, risk, value or uncertainty threshold was lowered.

Raw `availabilitySourceRows` survive JSON restart. They are observations of one player, not additional people or independent games. [`playerEvidence.js`](../sports-bot/src/playerEvidence.js) now preserves a lineup's original inputs when its effective state depends on another summary/provider observation. A derived inactive flag must not be fed back as an independent permanent injury after that observation expires.

[`inputChronology.js`](../sports-bot/src/inputChronology.js) and the provider materializer pass the remaining valid roster inputs when rebuilding a player view. An expired injury can reveal a projected role with **unknown** health, not an assumed healthy player; an expired roster cannot keep supplying a derived goalie role. Other restrictions and independent original observations remain intact. Existing parent-summary, information-cutoff and dependent-aggregate checks remain.

Per-player `summaryRoleEvidence` and `summaryStatEvidence` enter the existing frozen evidence report/journal, including conflicts, contributing source kinds and unverified publication/sample-period status. They do not create a new source-verification certificate or recover missing history.

Source/model identity advances to **v6.0.63**, implementation **`11dda749dbc33061a7c3204901149e5859066072`**. Restoring previously lost inputs can change model behavior and requires its own valid forward evaluation. Prior frozen studies keep their original source; none was replaced or promoted.

## Verification

| Check | Actual result |
| --- | --- |
| Reproduced pre-edit default-parallel suite |1,100 passed |
| Old-source regressions |3 failed as expected |
| New scenarios |14 |
| Focused player/provider/coverage/summary checks |79 passed |
| Full `npm test` |1,114 passed; zero failures/skips |
| `npm run check` |221 project files parsed |
| Postcommit player/provider/specialist/journal/archived-source checks |69 passed |
| Whitespace and changed-code credential/Gitleaks checks |Passed; zero configured-secret matches/findings |

Tests cover source preservation, duplicate/conflicting injuries/statistics, MLB/NHL/NFL critical roles, role conflicts, cross-team restrictions, independent provider metadata, per-source expiry and JSON restart, frozen journal evidence, and preservation of prior unknown/status-heuristic behavior. An initial integration check caught feedback of a derived lineup restriction after provider expiry; the repaired original-source retention passes the existing independent-roster regression. Test assertions were not weakened to hide it.

No provider request, new real forecast, paid query, order or Discord post was made in this phase. A read-only check verified the three existing study manifests/receipts: v59 has24 role/game observations not started, v60 has21, v61 has33; their final-query planners returned zero eligible tasks. Those overlapping rows are not78 independent games and do not validate v63. The registered v52 trial still has five checked captures,12 distinct games, one date and zero finals at its last checked10:09 UTC invocation.

## Remaining requirements

The real source limitation is unchanged: the saved v61 run had six summary requests/all HTTP403, zero accepted summaries and zero injury rows. Native goalie season leaders are not confirmed event starters. This code repair does not restore that unavailable medical feed, certify the retained statistics' sample periods or establish that any model is better calibrated or profitable.

Actual permitted source coverage, adequate current-model prospective outcomes, league calibration, publication truth, offered-odds/settlement/cost evidence and host/startup verification remain unfinished. Legacy data without original source rows cannot be reconstructed. Broader identity/role and source-completeness requirements remain subject to the full Sports specification.

The original hourly frozen trial, existing final-only collector and Stocks automation configurations remain unchanged. Live trading stays disabled and research emergency stop stays enabled. No credentials change, production startup, merge, deployment or promotion occurred. Sports remains in progress before full Crypto, then Stocks. See the [phase checklist](SPORTS_SUMMARY_PLAYER_CHECKLIST.json) and [full requirement matrix](SPORTS_REQUIREMENT_EVIDENCE.md).
