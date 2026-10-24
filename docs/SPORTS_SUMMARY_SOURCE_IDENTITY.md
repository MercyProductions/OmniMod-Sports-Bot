# Summary source identity and accepted coverage — v6.0.62

## Confirmed defects

The summary request URL was scoped to an expected ESPN event, but the response body was not checked against it before injuries, rosters, probable starters, environment or free market data were consumed. The same issue affected historical box-score inputs. A response with an explicitly different header ID could still be parsed as the requested game.

The compact cache retained competitions but discarded `header.id`, making that contradiction invisible after caching. Player-group labels also overrode native team identity: a group labelled with the expected team name but carrying a different explicit native team ID could contribute an injury assertion. Conversely, an alternate display label with the correct native ID could fail to match useful current roster data.

Four old-source regression cases reproduced these paths. They are controlled defect evidence, not a claim that a real provider supplied the contradictory fixtures or that they explain past win/loss results.

## Repair

[`summarySourceIdentity.js`](../sports-bot/src/summarySourceIdentity.js) centralizes the existing ESPN event routing helper and inspects supplied event IDs, canonical explicitly zoned starts, ordered teams, season and league declarations. Explicit contradictions reject the response; missing declarations remain **partial** evidence. Even `matched_assertions` means consistent provider assertions, not independent authentication or publication-time verification.

Stable native team IDs can canonicalize display aliases. A conflicting opposing name, foreign native ID, duplicate side or reversed ordered team cannot be accepted solely because an event ID matches. Explicit ESPN event mappings do not imply that NHL and ESPN team ID namespaces are identical; native-ID comparison requires ESPN-origin IDs. Name-only bindings remain assertions, not verified cross-provider mappings.

[`autoEnrichment.js`](../sports-bot/src/autoEnrichment.js#L453) preserves identity fields before caching. New `espn-summary-v2-*` and `espn-historical-box-v2-*` cache namespaces avoid silently trusting old compact entries that lost those fields. Existing caches are not rewritten or deleted. Request URLs, concurrency, caps, timeouts, failure cooldowns and source-denial handling are unchanged; a cold new namespace may require bounded requests rather than reuse old entries.

Conflicting current responses produce explicit rejection metadata and select no summary inputs. Valid independent scoreboard projections remain usable; a rejected summary does not erase them. Contradictory historical responses return `null` from [`parseHistoricalEventSummary`](../sports-bot/src/advancedMetrics.js#L222), and its caller skips the sample with a diagnostic. Accepted historical samples preserve source-identity evidence. This new nullable result is deliberate and covered at both callers.

Invalid or foreign player groups do not count as accepted roster/injury coverage. Metadata separates reported roster groups from accepted groups. Malformed rows are skipped without converting absent medical data into healthy players or crashing otherwise usable groups. Legacy summaries lacking identity fields remain explicitly partial; the repair does not reconstruct their missing provenance.

Known contradictory stored summary metadata loses its inference inputs, derived aggregates and quality bonuses. A known future identity decision cannot become an earlier source assertion. [`completePregameRefreshAttempt`](../sports-bot/src/pregameRefresh.js#L69) explicitly refuses identity conflicts even when other receipt/issuance checks pass, preserving the prior accepted forecast. The existing evidence/journal path freezes identity and rejection context.

Development identity advances to **v6.0.62**, implementation **`e90425ded1ac623a6d2e9cd276cb7ad9a27954be`**. This changes input eligibility and requires current-version forward validation. Existing strategy coefficients, uncertainty thresholds, calibration/risk/value gates, live-trading controls and frozen studies remain unchanged. No champion was promoted.

## Successful requests versus attempted slots

The existing `summaryGames` scalar remains compatible: it counts selected request slots, not accepted data. Additive `summaryCoverage`, included in the slate model summary, now reports:

- Eligible/mappable games, selected slots, attempts and actual provider calls versus cache reads.
- Accepted responses, provider failures, identity conflicts, unverified event mappings and cap omissions.
- Cache-state counts and rejected player-group reasons.

Each omitted or failed game also has a structured reason. Offline mode reports unqueried eligibility as `null`, not an observed empty universe. An accepted response still does not certify a complete injury report, confirmed starters or true publication freshness. Targeted refresh eligibility describes its selected scope, not the entire market.

## Actual absence evidence and verification

A read-only review of the already frozen v61 observation verified its capture and request-audit hashes. At **2026-10-24T09:33:52.892–09:33:54.937Z**, the 21-game challenger reported `summaryGames:6`. The request ledger proves **six summary requests, all HTTP403**, with **zero games having accepted summary metadata and zero raw injury records**. Summed summary response-header latency was 853ms; concurrent summed latency is not scan wall time. This audit made zero new provider requests and issued no forecasts. Original bytes were unchanged. Six slots must not be interpreted as six successfully enriched games.

| Check | Actual result |
| --- | --- |
| Reproduced pre-edit default-parallel baseline |1,079 passed |
| Old-source regression cases |4 failed as expected |
| New regression scenarios |21 |
| Focused identity/enrichment/coverage/history/projection checks |121 passed |
| Full `npm test` |1,100 passed; zero failures/skips |
| `npm run check` |219 project files parsed |
| Postcommit identity/archived-worker/refresh/journal/clock checks |70 passed |
| Whitespace and changed-code secret scans |Passed; zero configured-secret matches/Gitleaks findings |

Tests cover contradictory header preservation across a real cache round trip without extra mocked HTTP calls, wrong event/start/team/season/league, stable display aliases, native namespaces, partial/ambiguous identities, invalid groups, historical exclusion, stored/future metadata, targeted refresh refusal, independent scoreboard fallback and accepted/failed/capped/offline counters. No real data-provider availability or medical completeness is inferred from fixture success.

## Remaining work and operations

This repair and read-only audit made no provider requests and did not obtain an injury/confirmed-goalie feed, create a new study, register an experiment, buy a subscription or use the paid Odds API. A separate due invocation of the original frozen v52 collector completed at 2026-10-24T10:09:06.437Z after verifying the prior terminal run and no observed owner/worker:12 distinct games/one date/zero finals, five receipts/52 blobs, ten ordinary public requests/three failures (57 cumulative requests across checked runs). The original source/plan/artifact and first forecasts are unchanged. No denial was bypassed; checked runs and the missed-interval counter do not prove every scheduled wake occurred. Native NHL season goalie leaders remain context, not event starters or health clearance. The optional preferred-provider snapshot contract remains unconnected. Existing v52 trial and v59/v60/v61 observations keep their original models and first probabilities; their final-only automation is not silently upgraded to v62.

Adequate current-model prospective results, calibration, realistic offered-odds evidence, source publication truth, broader leagues and host/startup proof remain pending. Source-identity correctness cannot establish a better winner model or profitability. Full Sports remains in progress before full Crypto, then Stocks. Live trading stays disabled, emergency stop stays enabled, and no production startup, merge, deployment, credentials change, model promotion, order or Discord post occurred. The original Sports and Stocks schedules and the existing final-only schedule remain unchanged. See the [phase checklist](SPORTS_SUMMARY_SOURCE_CHECKLIST.json).
