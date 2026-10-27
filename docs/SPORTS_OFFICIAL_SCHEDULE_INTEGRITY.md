# Official schedule identity, pitcher inputs and source independence

October 24, 2026; development v6.0.66, current implementation `1cd99169edd1616ea614259b9c0bba8766aaf909` (initial repair `6225f30b0f187bd2dc0a82473211773d46a61d2e`). This repairs the existing free MLB/NHL integration. It does not add an injury feed or establish better forecasting performance.

## Confirmed problems

The old official-source path selected the first fuzzy team-name match, without choosing the exact event start. It could use the first doubleheader's pitchers for the later game even after recording a time conflict. It also merged MLB and ESPN player records by name, retaining a different known ID while adding an `officiallyCorroborated` label. Two old-source regressions reproduce these cases. The reproduced baseline passed 1,142 tests.

Other inspected paths accepted stale official schedule fallback for projected players, retained unbound pitcher rows without event expiry, and counted another request to the same NHL feed as an independent source. Expired existing scoreboard projections could also block fresh official pitcher observations. These defects concern data attribution and evidence quality; they do not justify relaxing strategy or value gates.

## Resulting behavior

| Concern | Current behavior |
| --- | --- |
| Event association | Exact ordered team names/verified aliases, abbreviations and explicit-zone start; unique source/local event association. Doubleheaders resolve by start. Ambiguity, malformed starts and explicit comparable season conflicts reject. |
| Native identifiers | Known native NHL events additionally require matching native event/team IDs. MLB native IDs stay in the `mlb` namespace. ESPN IDs are not converted by name or numeric coincidence. |
| Existing player evidence | A current same-player or pitcher-role record remains authoritative; an unmapped identity is not merged or labeled independently corroborated. Explicit injury restrictions survive. Unusable/expired known projections do not block fresh observations. |
| Projected pitchers | `confirmedStarter:false`, `availability:null`, no statistical samples or medical clearance inferred. Candidate count and newly added input count are reported separately. |
| Freshness | At most 15-minute verified network/fresh/revalidated receipts; stale schedule fallback is not used for this corroboration path. Projected inputs expire at the earlier of receipt +15 minutes and game start. |
| Inference/restart | Original local/native event, player, source status, selected snapshot, clocks and expiry rechecked after JSON restart. Withdrawn, wrong-event, changed-start, expired, legacy unbound or modified positive-confirmation inputs cannot reuse a binding. |
| Independent-source count | A same-provider request may record consistency but adds no independent-provider confidence. Conflict/independence flags are checked against their actual context. Existing numerical weights are unchanged. |
| Failure/caching | Actual fetch attempts and failures counted, including failed requests. Existing cache reuse remains; a 60-second negative cache prevents repeated 401/403/404 requests. No retry, access-control bypass or subscription was added. |
| Summary rejection | Independently valid official projections survive an unusable summary; summary-dependent records/aggregates still clear. Separate raw sources and issued identity/receipt evidence are retained. |

The existing `AUTO_OFFICIAL_SOURCES` / `LOCAL_ONLY` settings and provider routes remain. No runtime configuration was enabled. The legacy stale-window utility remains exported for compatibility, but this corroboration path does not use it to admit stale data. Unknown publication time remains unknown. Cross-provider abbreviations/names without a verified exact mapping can be excluded; counters explain that limitation instead of guessing a match.

Current implementation references under `sports-bot/`: `src/officialSources.js:7` (existing API/caching wrapper), `src/officialScheduleEvidence.js:39` (association), `:46` (corroboration scope), `:57` (projection scope), `:68` (payload application), `src/inputChronology.js` (original-source selection), `src/playerEvidence.js:45` (retained dependencies), `src/evidenceCoverage.js:124` (issued player evidence), `src/autoEnrichment.js:881` (distinct counters).

## Actual free-source diagnostic

One anonymous request to the existing [MLB schedule API](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-24&hydrate=probablePitcher%2Cteam%2Cvenue) completed at **2026-10-24T11:26:47.126Z**, HTTP 200, 3,470 bytes, approximately 229 ms through body collection. It reported one game and two probable pitchers. Raw bytes, source receipt and hashes remain private. The [official API documentation entry](https://statsapi.mlb.com/docs/) was reviewed separately; that review is not a bot data request or proof of publication time.

A receipt-correct **offline input diagnostic** matched that response to the existing v61 MLB catalog entry using its exact ordered teams and start. At the API receipt cutoff, both old scoreboard projections had expired: **0 usable pitcher inputs before application, 2 native MLB projections afterward**. The two expired original rows no longer blocked fresh input. Namespace-separated records stayed unconfirmed with unknown health. The archived catalog and source response bytes remained unchanged.

This was not a new forecast, a backdated prediction or a full-context model comparison. The response expired at 11:41:47.126Z. A separate actual-clock check at **11:50:21.569Z** retained **0** player inputs from it, correctly excluding the expired response. It is not a current opportunity or a fresh actionable quote. No score, calibration improvement, prediction win or investment return follows from this data-handling result.

## Verification and remaining work

Twenty-eight new cases cover association, namespaces, restricted/expired inputs, status changes, replacement/restart, independence, failure/cache accounting and real issuance evidence. Focused checks: **95 passed**. Full default-parallel `npm test`: **1,170 passed**, zero failures/skips. Syntax: **226 files**; whitespace and public-source secret checks passed. Postcommit official-source/chronology/archived-worker checks: **56 passed**. See the [phase checklist](SPORTS_OFFICIAL_SCHEDULE_CHECKLIST.json).

The NHL injury/confirmed-goalie gap remains: saved summary requests returned HTTP 403, native season leaders are not event confirmations, and the optional preferred provider is unconnected. This repair changes evidence selection when affected inputs exist and therefore requires independent forward validation. It provides no adequate current-version winner accuracy, calibration, model-selection or after-cost value evidence.

The original hourly v52 trial keeps its archived source, plan/artifact and first predictions; v66 was not substituted. Its last checked run remains six captures/12 distinct games/one date/zero finals. All three automation configurations, including Stocks, are unchanged. No orders, Discord, paid requests, credential changes, startup, merge, deployment or champion promotion occurred. Live trading stays disabled and the research emergency stop enabled. Full Sports remains in progress before the complete Crypto and Stocks requirements.
