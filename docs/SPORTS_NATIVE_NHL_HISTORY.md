# Official NHL recent-history fallback

## Missing-data cause and implemented recovery

The frozen study's ESPN historical requests returned HTTP 403, leaving zero team histories even though the official NHL score feed supplied schedules/finals. Native IDs cannot safely be sent to ESPN summaries. The repair uses the already supported official score endpoint for recent final results; it does not guess cross-provider IDs or retry blocked ESPN access through another route.

`src/nativeNhlHistory.js` validates native event/team identity, strict zoned receipt/start clocks, final status, integer scores (including zero), consecutive composite season labels and strict dates before the forecast date. Unknown publication time, neutral location, goalies and injuries remain unknown. Conflicting duplicate native events are quarantined.

`autoEnrichment.js:715` invokes the fallback only after an unavailable NHL history response, within the existing active-league cap. `NATIVE_NHL_HISTORY_DAYS=7` controls a sequential recent-date sweep; 0 disables it and 14 is the maximum. Responses use the existing provider cache (12-hour TTL, bounded stale fallback and five-minute negative cache). Access/rate-limit responses 401/403/429 stop the sweep and report deferred dates; no access-control workaround is implemented. Targeted pregame refreshes forward offline/cache-only policy.

The flat final results enter the existing team-profile and optional feature-warehouse pipeline. Existing history, feature and risk requirements remain. This is a bounded recent window, not full-season or player-stat coverage. Failed/stale dates mark the returned window incomplete/truncated.

`mergeNativeNhlHistory` reconciles exact NHL start/abbreviation matches so native and independently mapped ESPN copies do not double history. Conflicting scores or comparable season assertions exclude the event. An existing ESPN copy remains preferred for its available boxscore route. Different season label formats are explicitly unverified rather than guessed into equivalence. Unscoped legacy rows cannot be universally matched across providers.

Team profiles now identify their actual providers and preserve all contributing fetch receipts. Any stale contribution marks the profile stale, and a future constituent receipt can invalidate the derived input at inference. Profiles no longer mislabel native evidence as ESPN. Native composite NHL season labels are not numerically compared with four-digit provider labels; that numeric-scale mismatch previously discarded usable history. Comparable future-season exclusions remain.

## Actual collection

At **2026-10-24T03:46:53.244Z** (October 23 evening in America/Chicago), an isolated seven-date collection for forecast date October 23 returned **47 valid NHL finals**, **zero failed/deferred dates** and no parser rejections. It generated **32 team profiles**, with **1–4 games per team**. These remain thin samples; the existing eight-game coverage warning is not relaxed.

The isolated run used the bot's normal identified HTTP client and the existing [official score feed](https://api-web.nhle.com/v1/score/2026-10-22). A separate generic HTTP probe returned 403; the normal configured bot client returned 200. No alternate identity, proxy or access workaround was introduced. Raw responses and derived receipts are stored privately. No production state, credentials, frozen study or original forecast was changed. Newly fetched history was not used to rescore old forecasts as if it had been available earlier.

This restores recent team-result inputs that were previously missing. It does not establish improved forecasts or economic value.

## Verification

Reproduced prior full suite: **837 passed**. Thirteen added tests cover native payload/clock/score/season validation, source conflicts, bounds, sequential access, rate/access stops, partial coverage, cache reuse, all-receipt provenance, pipeline fallback, cross-provider duplicates and season-format uncertainty.

Three targeted regressions fail against the preceding enrichment pipeline: missing fallback despite available native history, incorrect provider/receipt provenance, and composite-season numeric comparison. Other tests validate the newly introduced collector/parser contracts.

From `sports-bot`: `node --import ./test/setup.js --test test/native-nhl-history.test.js test/auto-enrichment.test.js test/input-chronology.test.js test/evidence-coverage.test.js` — **49 passed**. Root `npm test` — **850 passed**, zero failures/skips. Root syntax and whitespace checks passed.

Inference identity is **v6.0.49**. Existing v6.0.45 studies and previously measured scores remain unchanged and do not validate this model version. No ML model was trained, selected or promoted.

## Remaining validation

Confirmed NHL goalies, injuries, rosters, player boxscores and richer NFL/NBA/MLB/soccer sources remain incomplete. Historical final scores cannot substitute for these fields. The recent-window cache/warehouse must accumulate independently observed data; it is not fabricated training history. Source publication lineage, full selection report/plan binding, adequate preregistered model comparisons and current-version prospective performance remain open.

Sports is user-confirmed offline. No startup, deployment, merge, champion promotion, orders or Discord publication occurred. Live trading remains disabled. The Stocks automation file is unchanged; Sports remains in progress before Crypto, then Stocks.
