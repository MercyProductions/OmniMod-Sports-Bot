# Preferred-provider goalie projections — October 24, 2026

Development v6.0.64, implementation `2102a079bc776755edc6db210b258a3882ccf306`. This is an additive input capability and reconciliation repair, not a recovered medical feed or validated forecasting improvement.

## Capability and original problem

The optional local snapshot adapter previously accepted only `goalie_starter` and `injury`. A provider could not express an event-specific projected goalie without rejection or incorrectly labeling it a confirmation. The old-source capability test rejected the new projection row (zero accepted instead of one). No actual vendor is asserted to have sent that row.

The unchanged `sports-player-availability-v1` schema now also accepts `kind:goalie_projection`. Use [the projection example](../examples/availability-provider.projection.example.json) as an exporter template; all identities and timestamps are placeholders and it deliberately fails current-observation validation unchanged. The original [starter/injury example](../examples/availability-provider.snapshot.example.json) remains valid as a template. Configure the existing `AVAILABILITY_PROVIDER_SNAPSHOT_FILE` only in private local configuration; blank still disables it. This phase configured no provider or credentials.

| Assertion | Effective meaning |
| --- | --- |
| `goalie_projection` | Event goalie role, `confirmedStarter:false`, unknown health, explicit projected status. Extra input fields cannot upgrade it. |
| `goalie_starter` | Explicit provider event-starter assertion; health still unknown unless independently reported. |
| `injury` | An individual provider status, reconciled conservatively; it does not establish complete team coverage. |

All existing native NHL identity, exact event/start/team, pregame, HTTPS source-reference, size, clock, expiry, snapshot-replacement and conflict checks remain. A projection does not borrow confirmation from a name match, season leader or array order.

## Conflicts, restrictions and reporting

- Multiple distinct projected goalies for one side are quarantined (`conflicting_projected_event_goalies`). Independent injury observations survive.
- An explicit same-snapshot starter assertion supersedes redundant projections (`projection_superseded_by_event_starter`). Contradictory confirmed starters remain quarantined; projections cannot resolve them.
- A newer provider snapshot may withdraw its prior confirmation in favor of a projection. Older/same-time conflicting snapshots retain existing chronology rules. Independent records are preserved.
- Same-player provider role metadata now survives a positionless injury update. An Out restriction remains effective, and the NHL specialist sees the observed goalie restriction. Original inputs survive expiry and JSON restart; retained statistics do not gain a verified sample period.
- `acceptedByKind` and per-provider `observationsByKind` count accepted original assertions. They are not counts of distinct players, confirmed healthy starters or qualified forecasts.

Projections leave the critical-lineup gap open. The existing late-lineup uncertainty rule remains unchanged: inside its 30-minute window, a missing confirmation combines with evidence quality below 58 to trigger its severe-data-risk condition. Other gates also apply. Missing confirmation alone is not a newly introduced universal veto, and no threshold was relaxed in this phase.

## Verification and limits

The reproduced baseline passed 1,114 tests. Twelve new cases cover projection semantics, unsafe positive fields, injury interaction, projection/confirmation conflicts, replacement chronology, expiry/restart, uncertainty, local-only enrichment and the unusable placeholder example. Focused tests: 88 passed. Full default-parallel suite: **1,126 passed**, zero failed/skipped. Postcommit isolated-path tests: 63 passed. Syntax: 222 files parsed; whitespace and public-source secret checks passed.

During implementation a projection plus positionless injury lost its goalie role; the regression was fixed in shared provider metadata reconciliation before commit. A proposed test also exposed an incorrect assumption that every unconfirmed lineup must be vetoed at high evidence quality; the test now verifies the actual existing rule without changing production policy.

The source-capability review used these primary references: [NHL lineup resource](https://www.nhl.com/news/nhl-lineup-projections-2026-27-season), [NHL terms](https://www.nhl.com/info/terms-of-service). No new website scraper, article-derived current snapshot, subscription, network provider client or medical confirmation was added. The bot made zero provider requests and issued zero real forecasts for this repair; web review is separate from bot collection. Existing saved v61 diagnostics still show six summary HTTP 403s and zero accepted summaries/injury rows.

The original hourly v52 trial and v59/v60/v61 final-only studies keep their archived sources, first forecasts and automation identities. This v64 capability was not inserted into them. Actual v64 predictive accuracy, calibration, lead time and economic value remain unverified. Live trading is disabled, research emergency stop remains enabled, and no orders, Discord messages, production startup, merge, deployment or model promotion occurred. Stocks scheduling is unchanged. Full Sports validation remains in progress before Crypto, then Stocks.
