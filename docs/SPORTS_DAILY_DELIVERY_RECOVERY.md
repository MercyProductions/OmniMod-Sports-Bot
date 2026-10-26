# Daily-sheet delivery recovery — October 26, 2026

Development v6.0.71 repairs delivery, without changing prediction weights, data acceptance, strategy or risk criteria. The registered v52/v69 trials and separate v70 engineering observations retain their original source identities and records.

## Confirmed incident

The local v70 worker generated 17 game forecasts at 13:00:28 UTC (08:00 America/Chicago) but did not publish them. The Discord history guard read only five 100-message pages. The channel contained 678 messages and no sheet for the requested date; a complete account-authorized read needed seven pages. The original strict lookup reproduced `Daily slate history search limit reached`, which was wrapped as an unverifiable-history error. Permissions and both the SDK and direct history requests worked.

The scheduler then prevented recovery: it attempted delivery only during the exact scheduled minute and marked its in-memory attempt key before the attempt succeeded. Later healthy timer ticks did not retry that day's failed post. A ready gateway was consequently not evidence of a delivered daily sheet.

## Repair

- History lookup allows up to 25 pages (2,500 messages), stops on a match or a complete page, and rejects missing/repeated pagination cursors. Denial, incomplete history and budget exhaustion still block sending. Existing cached-message checks, cross-process publication ownership, cache revisions and channel duplicate guards remain.
- Daily scheduling becomes due at or after the configured local time. A missed minute can catch up. Failures retry after one, five, 15 and 30 minutes, then at most hourly for that local day. An active attempt cannot overlap another tick, and only an acknowledged message/channel marks delivery complete. Restarts still reconcile the durable cache against Discord.
- Runtime snapshots retain daily attempt count, status, acknowledgement, retry time and fixed error code. Raw transport errors are not copied into this scheduler state. Successful recovery clears its prior delivery error without clearing unrelated errors.
- Recovery uses the durable daily cache and its original forecast times/probabilities. It does not rebuild forecasts, repeat the paid daily batch or backdate a delivery. Only the predictions actually displayed by Discord's embed budget receive delivery acknowledgements.

## Verification

Two new transport regressions failed against the preceding source. The repaired suite passes **1,335 tests**, zero failed/skipped; **247 JavaScript files** pass the syntax check. Focused scheduler/transport tests pass 30 cases, including denied/partial history, advancing budget exhaustion, stale cache races, duplicate publishers, ambiguous remote acceptance, later-day reset and daylight-saving timing.

Commands: `npm test`, `npm run check`, and `git -c core.whitespace=cr-at-eol diff --check`. These checks verify software behavior, not prediction quality or provider completeness. Live trading remains disabled and emergency stop remains enabled.

## Runtime verification checklist

- [x] Diagnose actual duplicate-search failure with authorized read-only Discord requests.
- [x] Reproduce the preceding-source failures and pass regression/syntax checks.
- [ ] Install a pinned local release while preserving the old process/data evidence.
- [ ] Verify today's remote sheet, durable acknowledgement and unchanged original forecasts.
- [ ] Verify the next automatic schedule in actual operation; a recovery today does not prove tomorrow's delivery.

Injury/goalie source gaps, independent calibration, original-price/cost evidence and model-validation requirements remain open. This operational repair does not establish predictive improvement.
