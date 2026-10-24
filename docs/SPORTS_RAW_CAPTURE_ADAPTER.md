# Raw prospective-capture adapter integrity

## Confirmed gaps

The paired comparator could validate a raw binary vector but pass it to the stricter journal comparator without modeled-outcome metadata. The pinned baseline/challenger engines intentionally omit draw for two-way forecasts, so future resolved pairs could be excluded as unknown legacy journal vectors. That differs from an old journal formatter's null padding: the receipt-linked raw capture preserves the original emitted keys.

The archived baseline's actual selected side was also discarded. On a tied vector, the generic reference scorer could assign a different tie-break side and misstate baseline accuracy. Nonmaximum raw picks were not rejected by the pair/final-query planner.

## Repairs

- `sports-bot/src/prospectivePairs.js:24`: an explicit frozen class declaration is respected when present; otherwise emitted numeric keys from the known raw capture schema define the derived adapter class. Unknown/null values and contradictory declarations reject. The canonical receipt/manifest loader remains responsible for binding capture bytes to pinned source.
- `prospectivePairs.js:25`: baseline and challenger frozen picks must be maximum-probability modeled outcomes before entering pairs or final-query plans.
- `prospectivePairs.js:157`: derived comparison rows preserve raw event-start text alongside a canonical start and explicit primary/reference class metadata. They retain the baseline's actual selected side. Original captures and legacy journals are not rewritten.
- `sports-bot/src/matchedJournalEvaluation.js:174`: an explicit candidate/reference pick is validated and used for accuracy/calibration. References with no frozen side keep their documented deterministic vector maximum; a vector-only tie is not an original model-pick claim.
- `sports-bot/src/capturedEventTime.js`: source event starts can express explicit minute precision, such as `2026-10-23T00:15Z`; only that syntax is expanded to :00 seconds before strict calendar/zone parsing. Collector receipt/start/completion/generated clocks remain strict. No timezone is inferred and invalid calendars stay invalid.

Paired report schema is `sports-isolated-paired-report-v3`, adapter `receipt-linked-raw-emitted-outcomes-v1`. Known-schema raw capture adaptation is separate from null-padded legacy journal interpretation. New report metadata does not rewrite or relabel frozen source commits.

## Actual source and protected-data evidence

The existing next-day study pins baseline `1185e178...` and challenger `39b26b2...`. Read-only inspection found 13 forecasts per role, all with exactly away/home emitted keys and maximum valid frozen picks. Both pinned engines' outcome construction confirms that two-way forecasts omit draw. The pinned worker writes the raw slate into capture schema v1.

A real report initially exposed an overstrict event-start parse: the two NFL role observations used the provider's explicit-minute `2026-10-23T00:15Z`, reducing pairing to 12 with two chronology exclusions. This was corrected before publication by a source-event-only normalizer; receipt strictness was preserved.

The final read-only report at **2026-10-21T16:14:40.989Z** retained **13 pairs (12 NHL, one NFL)** with no pairing rejections. All 13 remain unresolved; 26 role/event observations have not started. Final queries performed: **0**. Manifest, receipt ledger and original capture SHA-256 hashes match before/after. No new provider requests or study captures were made. Existing padded research journal classes were not retroactively declared.

## Verification

- Unchanged baseline: 790 passed.
- Nine added tests. Six targeted prior-code defects fail against the preceding adapters; three additional boundary/scope checks cover null padding, naive clocks and explicit-minute source times/strict receipts.
- Focused raw adapter, paired, matched and cohort suite: 55 passed.
- Full suite: 799 passed, zero failures/skips. Syntax and whitespace checks pass.
- Regressions include scored binary raw pairs; actual tied baseline picks; invalid picks in either role/planner; invalid explicit reference selection; unknown schemas; contradictory class declarations; source-minute calendar/zone checks; immutable input records; and receipt precision isolation.

Fixture scores are not actual game results. The real study still cannot establish accuracy, calibration, economic improvement or a profitable strategy.

## Remaining requirements

Raw captures still need complete source/feature availability, source-clock and settlement evidence. Direct array APIs do not authenticate receipt hashes; callers must use the verified loader. Earliest equal-time capture conflicts and final-observation receipt ordering require continued review. Deterministic identity recipes, cross-game dependence and adequate independent prospective samples remain unfinished.

Sports remains offline; installed state/startup unverified. No merge, deployment, promotion or live trading. Sports in progress; Crypto then Stocks remain queued.
