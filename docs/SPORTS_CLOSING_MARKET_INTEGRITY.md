# Closing snapshot identity and chronology

## Confirmed defects

The horizon report matched market snapshots only by game ID and guild, omitting league and scheduled start. Reused IDs could supply another league/date's benchmark. Receipt sorting and latest-forecast selection used timestamp strings, so equivalent timezone representations could change selection. Equal-time conflicting quotes and invalid market vectors were not quarantined. Overall forecast grouping also omitted scheduled start and could collapse distinct events.

## Repairs and source references

- `sports-bot/src/horizonEvaluation.js:107`: canonical guild/league/string-ID/explicit-zone start identity, shared by quote matching, horizon selection and overall event grouping.
- `horizonEvaluation.js:109`: only declared closing/t-10 snapshots with complete matching scope and explicit-zone receipt strictly before start are considered. Parsed instants choose the latest receipt; simultaneous differing normalized vectors quarantine that latest observation. An invalid latest vector does not cause fallback to an older clean vector. Incompatible positive draw spaces are excluded.
- `horizonEvaluation.js:145`: explicit-zone forecast chronology and parsed-time latest selection. Reused IDs on different starts remain distinct event populations.
- `horizonEvaluation.js:165`: `closingSnapshotStatuses` records matching/chronology/vector/conflict outcomes for each scored forecast/horizon. These are not independent game counts or full raw-input rejection counts.

The report preserves its existing descriptive latest-forecast policy. It now exposes `closingComparisonPolicy`: local receipt and stage do not prove actual closing time, fresh underlying provider data, executable prices or independent market evidence. Missing scope in legacy snapshots stays unverified; stored records are not backfilled. Existing market fixtures now include the league/start evidence they claim.

## Verification

- Unchanged baseline: 730 passed.
- Nine added tests; eight targeted defect regressions fail against old source. The ninth verifies supported canonical matching/immutability and new status reporting.
- Focused horizon, journal, accuracy and model suite: 59 passed.
- Full suite: 739 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage: league/start/guild/missing scope; offset receipt sorting; equal-instant conflicts in both orders; invalid latest mass without fallback; binary/three-way mismatch; repeated event IDs on different starts; latest frozen forecast offset order; and naive receipt/forecast clocks.
- Fixtures demonstrate that an older 18:30Z snapshot no longer outranks a 14:50-04:00 snapshot (18:50Z), and distinct dates no longer collapse into one event. These are source-behavior measurements, not real predictive returns.

## Remaining limits

Consensus vector receipt is not an offered executable quote or verified closing-price archive. Provider freshness, publication times, bookmaker/settlement identity, legitimate zero-draw market semantics, costs and source truth require separate evidence. Quote identity matching here does not authenticate arbitrary input arrays. Equal-time conflicting forecasts, result conflicts, cross-game dependence and full historical feature availability require their own checks; repaired quote handling does not certify those paths.

No forecast probabilities, strategy/risk thresholds, installed models, production data, jobs or Discord process changed. Sports remains offline; installed configuration/startup unverified. No merge, deployment, model promotion or live trading. Sports remains in progress; Crypto then Stocks requirements remain queued.
