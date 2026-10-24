# Coverage observation clocks and completed prospective finals

## Confirmed defects and repairs

Coverage reports used permissive date parsing even after inference input clocks were tightened. Impossible or timezone-free timestamps could normalize into apparent fetch receipts. A recent fetch could coexist with a future native observation and still report injury coverage. Advanced-data refresh clocks had the same normalization problem. Date-only receipts could incorrectly earn a summary freshness bonus near midnight.

- `sports-bot/src/evidenceCoverage.js:10` uses the existing explicit-zone, calendar-valid timestamp parser for displayed clocks and refresh receipts. Date-only and malformed clocks do not become exact timestamps.
- Line 11 reports aggregate `observationState` and separate `nativeObservationState`; neither is a publication-time attestation. Existing source `state` and summary `receiptFresh` describe the fetch receipt only.
- Line 24 prevents known invalid/future observations from establishing injury-team coverage. A fresh fetch can still be reported as such when native data is invalid/future; callers must inspect observation eligibility separately. Inference already filters such observations before confidence calculation.
- Line 43 records these states per schedule/summary/history source; line 47 adds structured missing reasons. Absent native clocks remain unknown instead of becoming valid because a fetch was recent.
- Advanced provenance exposes its aggregate observation state and rejects malformed refresh timestamps as unavailable at the cutoff.

Coverage schema is `sports-evidence-coverage-v2`. Model identity is **v6.0.47** because rejecting date-only freshness bonuses can change inference confidence. Input audit remains v2; paired report remains v4. Original forecasts, studies, artifacts and older coverage reports are not rewritten. No model is retrained or promoted.

## Verification

Unchanged prior implementation: 818 tests passed. Seven new reporting tests fail against that source, and a separate inference regression also fails against the prior coverage implementation. Eight new tests cover malformed/coerced clocks, future native evidence, absent native clocks, day precision, advanced refresh provenance, valid offsets, input immutability and midnight confidence behavior.

From `sports-bot`: `node --import ./test/setup.js --test test/coverage-observation-clock.test.js test/evidence-coverage.test.js test/input-observation-clock.test.js test/input-chronology.test.js` — **45 passed**. Root `npm test` — **826 passed**, zero failed/skipped, reproduced after resuming the interrupted work. Root `npm run check` and whitespace checks passed. Syntax checks include the new regression file.

## Actual frozen source-clock coverage

A read-only derived audit examined the raw captures of the next-day v6.0.45 study at each capture's completion cutoff. Across 26 role/game observations (13 games per role):

| Source | Receipt evidence | Native observation clock |
| --- | --- | --- |
| Schedule | 26 available; 26 aggregate observations before cutoff | 26 unknown |
| Summary | 26 missing | 26 unknown |
| History | 26 timestamp unknown | 26 unknown |

This is a new source-field audit, not an assertion that the current model generated the original forecasts or that all selected model inputs are independently attested. Four manifest/ledger/original-capture hashes remained identical; no provider request was made for this audit. Source receipt existence does not prove native publication freshness or complete injury/lineup coverage.

## Actual final reconciliation after resuming

At **2026-10-24T03:29:08.961Z** (October 23 evening in America/Chicago), the previously frozen next-day study has **13 resolved matched games**: 12 NHL and one NFL. The baseline and challenger each picked **10 of 13 correctly (76.92%)**, with identical Brier **0.2334843076923077** and log loss **0.6600681637547575**. All three comparative improvements are zero. These predictions were frozen under baseline `1185e178...` and challenger `39b26b2...` (v6.0.45), not v6.0.47.

Final-only archived workers appended two captures. Original manifest and pregame-capture hashes are unchanged; the receipt ledger retains its exact original byte prefix. No final queries remain pending for this study. NHL primary HTTP 403/CDN HTTP 404 persist; the official fallback supplied NHL finals. NFL primary HTTP 403 used the CDN fallback. No Odds API request occurred. These source failures were not cured by reporting changes.

The earlier two-game v6.0.45 study remains a separate experiment (1/2 correct, identical baseline/challenger metrics). There are overlapping records across the three archived studies: 17 pair records, 15 distinct games. Do not count overlap as independent evidence or pool versions naively.

## Limits and deployment

A small, correlated sample with identical baseline/challenger outputs cannot establish improved calibration, league-specific superiority or profitability. These results do not validate v6.0.47. No offered-price fills, execution costs or after-cost wagering edge were measured. Broader feature lineage, missing league data, independent prospective samples and model-selection requirements remain unfinished.

Sports remains user-confirmed offline. No startup, merge, deployment, Discord transmission, real-money execution or model promotion occurred. The Stocks market-session automation was inspected without changing its schedule. Sports remains in progress; Crypto then Stocks remain queued under the full original requirements.
