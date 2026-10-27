# Per-game result follow-ups — October 27, 2026

Development v6.0.72 repairs the separate final-result delivery path. It does not change prediction weights, original pregame picks, source acceptance, model promotion or risk criteria.

## Confirmed incident

At 02:33 UTC the running v71 worker had graded seven completed games from the October 26 slate, including both matching and missed forecasts, but acknowledged **zero** result messages. Ten other games remained live. Structured cache failures showed those seven results waiting for delivery. The score poller and grading were working; the transport failures were swallowed into generic pending reasons, so a healthy gateway and no top-level error did not mean results had been delivered.

An authorized read-only reproduction found that final-result history still had its separate five-page/500-message limit after the daily-sheet lookup was repaired. The Sports channel had 679 messages and no current result replies; the results channel was empty. Seven pages established the complete Sports history. The original final lookup rejected that history as incomplete, preventing every new result send. The previous repair had missed this separate path.

## Changes

- Daily and final publishers now use the same bounded history traversal in `discordHistory.js`: up to 25 pages, at most 100 messages per request. Only a complete history establishes absence. A match can recover an existing post; denied/malformed responses, non-advancing or repeated cursors and budget exhaustion still block sends.
- Final lookup retains its event/date/guild/league/start identity, scoped footer, legacy ambiguity and alternate-channel checks. Existing result corrections still require their verified prior revision. A failed or ambiguous reply never becomes an extra fallback send.
- Final batch failures retain fixed history-unavailable, cursor, budget or ambiguous-event reasons. Raw transport/request data is not copied into these reasons.
- Runtime state and `/sports status` expose the latest final-delivery check and pending count. Collected scores, confirmed finals and successfully delivered replies remain separate facts. Existing ten-minute polling continues to retry pending results, including prior-day caches within the existing lookback.
- Recovery preserves original forecasts and journal prefixes. Final scores still require the existing source identity/status/chronology checks. Live or unresolved games are not assigned invented results. Result messages continue to reply to the original daily sheet, with the configured results channel as fallback when that daily message is confirmed missing.

## Verification

Two new final-history regressions failed against v71. The repaired full suite passes **1,344 tests**, with zero failures/skips; syntax checks cover **248 files**. Coverage includes deep-history recovery without duplication, complete absence beyond 500 messages, bounded exhaustion, later-page denial, cursor failure, structured failures, correction revisions, cache races and restart recovery after ambiguous remote acceptance. Commands: `npm test`, `npm run check`, and `git -c core.whitespace=cr-at-eol diff --check`.

The status-only text addition is syntax-checked separately. Passing software tests does not establish forecasting accuracy or a live final-score feed's completeness.

## Runtime checklist

- [x] Verify actual final grades, missing acknowledgements and complete Discord history.
- [x] Reproduce preceding-source failures and verify the shared traversal and final lifecycle.
- [x] Install the pinned repair while preserving the previous runtime/data/claims.
- [x] Verify actual result replies, durable acknowledgements and unchanged original predictions.
- [ ] Observe later automatic follow-ups as remaining games reach eligible final status.

Live trading remains disabled, emergency stop enabled and automatic learning/training disabled. Registered v52/v69 studies, frozen v70 observations and Stocks scheduling remain unchanged. Medical/starter coverage, independent calibration and economic validation are still unfinished; result delivery is not evidence of predictive improvement.

## Actual recovery

The pinned local release **`57e2d79eeb80eec3ed9f555d738bf151b79ab17f`** started after the previous known worker released its event claims. Its archived predecessor, claim generations/decisions and copied data remain private and intact. The original credential file and protected research sources/schedules were unchanged.

The first normal final-check cycle completed at **02:44:24 UTC on October 27 (21:44 America/Chicago on October 26)**. It posted eight result replies and persisted eight acknowledgements, with zero remaining delivery failures. An independent authorized REST read verified every reply's bot identity, original daily-message reference and event/result digest. Both matched and missed forecasts were delivered; no outcome was selected for being favorable. The other nine games remained unresolved at that refresh and were not assigned results.

All 17 original pregame forecasts and their issuance records remain unchanged. The journal retains its exact prior prefix, and original issued-forecast count remains 17. Recovered result messages retain source-observation clocks and actual delivery times. Eight follow-ups describe delivery coverage, not an estimate of accuracy or profitability. Later automatic finals and correction handling still need continued observation; the runtime remains dependent on the local computer staying awake.

The initial private read-only verification helper used an SDK-normalized reference name against raw REST JSON and failed; that evidence was retained. Correcting the observer to the installed SDK's `message_reference` contract required no bot restart, resend, forecast change or source-data rewrite. The subsequent eight-message verification passed.
