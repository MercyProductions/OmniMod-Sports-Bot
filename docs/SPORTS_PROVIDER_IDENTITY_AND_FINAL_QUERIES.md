# Provider identity diagnosis and cross-date final-query planning

## Observed access limitation

A bounded read-only diagnostic on the exact NBA summary endpoint used by the bot observed a 200 JSON response with the standard Python request identity, and a 403 Akamai `Access Denied` response with the existing declared `OmniModSportsBot/6.0 (+https://omnimod.cc)` user-agent. A separate generic Node identity also returned 200. These observations suggest request-identity-sensitive access controls; they do not prove all denial rules, entitlement or continued access. They do not demonstrate that the code's summary parser caused the 403.

The production request identity is unchanged. No browser impersonation, proxy workaround, alternate-host evasion or bypass was introduced. A permitted bot/API access route or appropriately authorized alternative source remains necessary for reliable history and summary coverage. Schedule fallback success does not establish lineup/injury/history access.

## Confirmed event-ID defect

The actual isolated capture contained summary URLs built from official NHL IDs such as `nhl-2026020149`. These are not ESPN event identifiers. `espnSummaryEventId` now routes only explicit numeric ESPN mappings or numeric ESPN-origin identities. Native IDs are not stripped or guessed into ESPN IDs. An invalid explicit mapping fails closed rather than falling back to another identifier.

Unmapped current games receive a structured `summaryIdentity` missingness reason and a combined diagnostic; they are filtered before the bounded summary candidate cap. Unsupported historical identities are excluded before historical summary selection as well. This avoids wasting request capacity and distinguishes missing identity from HTTP failure. It does not obtain new NHL lineup data or fix the provider's access restrictions.

The data-routing behavior is development model identity v6.0.6. Frozen older predictions retain their original version/probabilities. Explicit user/provider mappings are assertions requiring provenance; a numeric format check alone is not proof of event correspondence.

## Cross-date final work plan

`pendingProspectiveFinalQueries` derives bounded tasks from verified live capture receipts, using original pregame generation/receipt chronology and valid frozen vectors. It groups unresolved started events by original local date and source role, preserving original game/prediction records. A default seven-day lookback excludes older events; a maximum three dates per role defers excess dates explicitly. Repeated horizons/guild observations do not multiply fetch tasks for the same event. An observed final for one role resolves that role's fetch task without silently declaring the other role complete.

The read-only isolated `--action=report` includes task dates/counts, deferrals, exclusions and `requestsPerformed: 0`. Current-day not-started games are not final-query candidates. This is a work planner; worker execution of its cross-date final fetches remains unfinished. It must not be described as complete final-result reconciliation.

The actual private report over current indexed captures produced zero pending tasks because no eligible pregame forecasts were captured. This is not successful grading or an accuracy sample.

## Verification

Baseline `d5e26dfdf02f12c274786f777cd679eaa8f24522`: 218 tests reproduced. Current Sports suite: 223 passing, zero failures/skips; syntax and whitespace checks pass.

New tests cover explicit ESPN/native identity boundaries, invalid mappings, summary-cap preservation and absence of malformed summary requests, cross-midnight pending tasks, retaining original predictions, per-role observed-final resolution, future/old exclusions, bounded date deferrals and event deduplication. Network-response fixtures are synthetic and do not establish actual provider permission. No full pregame performance comparison is available.

No deployment, live Discord changes, paid requests, orders or model promotions occurred. Sports remains in progress before queued Crypto and Stocks. Next steps are permitted provider coverage, cross-date task execution, actual pregame capture, deployed-host inspection and completion of the evidence map.
