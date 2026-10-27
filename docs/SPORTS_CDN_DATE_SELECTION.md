# CDN date selection and source-window coverage — v6.0.60

## Confirmed cause of missing current-day games

[`sportsData.js:254`](../sports-bot/src/sportsData.js#L254) sent `dates=YYYYMMDD` to the existing CDN fallback, while that route declares and accepts the singular `date` selector. The primary Site API still uses its existing `dates` parameter and was not changed or bypassed.

An ordinary request to the existing NBA CDN route with `dates=20261024` returned HTTP200 but declared `content.dateParams.date=20261023`, `defaults.scoDate=20261023` and a preceding-day slate. The compact cache previously discarded these declarations. The valid Chicago-day filter then removed those games, leaving the appearance that no NBA games were available.

One controlled request using the response's declared `date` selector returned eight current-day NBA games. Two further bounded requests verified MLB and NFL behavior on the same existing public routes. No alternate origin, proxy, denied-endpoint retry, authentication change or subscription was used. Four public probes in total were reserved before work; raw replies, receipts and hashes remain private.

| Observed selector behavior for October 24 | Existing `dates` query | Corrected `date` query |
| --- | --- | --- |
| NBA |12 returned events from the preceding Chicago day; 0 accepted |8 returned and accepted current-day events |
| MLB |1 preceding-local-day event; 0 accepted |1 returned and accepted current-day event |
| NFL |Weekly 14-game window |Date echoed with year 2026/season type 2/week 7; still a weekly 14-game window |

These are observations of [the provider's NBA JSON route](https://cdn.espn.com/core/nba/scoreboard?date=20261024&xhr=1), [MLB route](https://cdn.espn.com/core/mlb/scoreboard?date=20261024&xhr=1) and [NFL route](https://cdn.espn.com/core/nfl/scoreboard?date=20261024&xhr=1), not a guarantee of future API availability or universal calendar completeness. A search did not find authoritative version-matched endpoint documentation; unrelated fantasy documentation and third-party endpoint lists were not used as a contract.

## Implemented changes

The CDN builder now sends `date`. League/group scoping, request budgets, timeouts, negative-cache cooldowns and the existing local-day filter remain. The cache namespace advances to `espn-cdn-v3-*`, preserving native window declarations alongside compact event rows. Old cache/research files are not rewritten or deleted. The primary Site selector and official NHL fallback remain intact.

[`scoreboardWindow.js`](../sports-bot/src/scoreboardWindow.js) retains strictly valid native date declarations and weekly context before compact caching. It distinguishes declared requested days, different/conflicting/invalid declarations, weekly windows and unknown scope. Returned/valid/accepted/outside-day/invalid-row counts remain separate, together with request-day, receipt/cache state and HTTP status. Every report explicitly leaves `completenessVerified:false`. An empty or weekly response is not a certificate that the full requested market has no games.

[`parseEspnEvent`](../sports-bot/src/sportsData.js#L152) now rejects null rows and malformed, impossible or unzoned starts before local formatting. Valid explicitly zoned minute-precision starts remain supported. A bad row no longer supplies a normalized false date or crashes the entire league scan. Valid local-day rows remain usable even when another row or a provider declaration is bad; discrepancies stay visible in the report.

Current slates expose `scoreboardCoverage`. Each game's selected schedule metadata retains its report, and the prediction evidence report freezes that context. Final refreshes use separate `finalScoreboardCoverage`, preserving the original scan report and immutable first probabilities. No confidence threshold, model/risk/value requirement or trading control was relaxed.

## Actual isolated source integration

A separate pre-collection plan pinned implementation commit **`dd6a28295a20c7c9fd4e5169c32d02cd0ab42aa2`**, model **v6.0.60**, current Chicago day, four configured test leagues and one source worker. The old baseline was archived for inspection but was not needlessly collected again. The prepared worker retained the existing 32-request cap, 120-second timeout, public-host policy, exact source/support hashes, empty account environment, disabled learning/trading and enabled emergency stop.

At **2026-10-24T08:58:53.975–08:58:56.660Z**, it captured:

| Measurement | Actual result |
| --- | --- |
| Eligible games / pregame forecasts |21 /21 |
| Accepted leagues |12 NHL,8 NBA,1 MLB |
| NFL returned / accepted / outside local day |14 /0 /14 |
| Invalid rows in the four reported feeds |0 |
| Public requests / failures / policy blocks |31 /14 /0 |
| HTTP statuses |17×200,13×403,1×404; no transport failure |
| Retained side records |42 |
| Recommendation statuses |9 directional leans,12 withheld; 0 actionable predictions |
| Calibration samples |0 for every forecast |
| Paid requests / orders / Discord posts / promotions |0 /0 /0 /0 |

The existing provider failures still limit summaries, injury/lineup inputs and history. Recovery of scheduled games does not establish complete medical/starter data or calibrated probability. Point forecasts and directional leans are not qualified wagers. The 31 worker calls plus four selector probes total 35 ordinary free-provider requests in this phase.

This is a single-source forward observation, not a new independent model-selection trial or a fair accuracy comparison with the earlier 08:28 paired study. The new source's NHL games overlap existing observations, and new NBA/MLB games have no contemporaneous baseline forecast in this study. Do not pool versions or treat missing baseline predictions as losses. Actual subsequent finals, proper scores and after-cost economic results remain unavailable.

The previous v59 study manifest/receipt ledger hashes were identical before and after this run. The original frozen v52 trial, source archive, plan, forecasts and both automation configurations remain unchanged. New source and old studies keep their own state; no results or data were merged into production learning.

A separate due invocation of the original frozen v52 collector completed at 2026-10-24T09:08:28.025Z after verifying the prior terminal run and no observed worker/owner. It retains 12 distinct games, one date and zero finals, with 4 capture receipts/43 provider blobs. That routine run made 10 public requests/three failures, separate from the 35 date-repair requests. The original source/plan/artifact remain unchanged; checked invocations and its interval counter do not prove every automatic wake occurred.

## Verification and remaining scope

Pre-edit default-parallel baseline: **1,057 tests passed**. Two old-source failure scenarios reproduced current-day discovery loss and malformed-time acceptance. Nine tests added cover the real selector path, strict source starts, explicit minute precision, cache metadata round-trip without repeated calls, weekly/missing/conflicting declarations, mixed malformed/outside-day rows and the retained daily filter. Focused checks passed **27**; full `npm test` passed **1,066**, zero failed/skipped. Syntax checks parsed **215 project files**. Postcommit source/clock/final/archived-worker checks passed **46**. Whitespace and changed-code secret scans passed.

Changed source data availability can change predictions, so development identity advances to v6.0.60 and requires its own valid forward evidence. Nothing was promoted. The returned rows cover the four chosen leagues only; other routes, distant timezones, adjacent broadcast-day boundaries, original publication times and independent schedule completeness remain unverified. Current medical/confirmed-goalie coverage, adequate independent calibration/accuracy evidence, executable odds terms and actual host/startup proof remain unfinished.

See the [structured phase checklist](SPORTS_CDN_DATE_CHECKLIST.json). Sports is still in progress before full Crypto then Stocks. No merge, deployment, production startup, credentials change, live order or Discord post occurred. Live trading remains disabled and Stocks tests remain scheduled and unchanged.
