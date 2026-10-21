# Journal summary cutoff and first-issue selection

## Confirmed defects

`sports-bot/src/journalEvaluation.js` had no historical information cutoff. Its selected-outcome binary summary selected the first **graded** array entry using raw event/time strings, rather than the earliest eligible recorded issue. A later resolved revision could replace an earlier unresolved forecast, shuffled arrays could change confidence, equivalent scope aliases could duplicate a game, and later corrections/delivery acknowledgements could enter an earlier report. Result chronology and raw ISSUED eligibility were not independently checked by that summary.

## Repairs

`summarizePredictionJournal(input, {asOf})` defaults to current time and now emits schema `sports-journal-summary-v2`. Only explicit-zone journal records recorded at or before cutoff enter state/performance. The nested matched evaluator receives the same cutoff. Future/unverifiable input counts remain audit context; the untimed legacy forecast count is preserved as explicitly disclosed context, never scoring evidence.

Eligible scoring issues require observed-pregame status, complete identity/horizon, and generated <= recorded < scheduled start with explicit-zone instants. Results require start <= observed <= recorded <= cutoff and no changed schedule. Contradictory eligible event labels across guilds/versions and active result disputes block event scores. Outcome vectors and frozen maximum selections must be valid.

The first-issue binary policy selects the earliest eligible recorded issue per canonical league/event/start/model across guilds/horizons **before** checking class evidence or resolution. Different simultaneous first inputs are excluded. Unresolved/invalid first issues cannot fall back to later resolved revisions. Original arrays and journal bytes remain unchanged.

Version counts distinguish eligible issues, invalid issuance, resolved/unresolved labels, invalid result chronology, outcome-class exclusions, invalid frozen picks, event conflicts and first-issue ambiguity. `graded` is a validly timed observed label count, not proof the vector is scorable. Detailed horizon outcome tables remain descriptive resolved-row populations; their policy differs from the first-issue binary summary. Counter populations can overlap and must not be added as independent samples.

## Read-only CLI

From `sports-bot/`:

```powershell
node scripts/audit-predictions.js --journal=C:\research\prediction-journal.jsonl --as-of=2026-10-20T20:00:00Z
```

The CLI verifies the journal using its canonical reader. One optional `--journal=` and one optional explicit-zone `--as-of=` are accepted. Malformed/duplicate/unknown arguments fail with a generic message before reading. Errors do not print raw private inputs. No-argument behavior still audits the configured journal at current time.

## Verification

- Unchanged baseline: 749 passed.
- Eleven added tests. Ten targeted API regressions fail against the preceding summary; the additional real-journal CLI test verifies new argument/cutoff and immutable-byte behavior.
- Focused summary/journal/matched suite: 57 passed.
- Complete suite: 760 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage includes cutoff labels/delivery; future corrections; shuffled first issues; no resolved fallback; canonical offset/league scopes; equal-time first conflicts; invalid observation timing/schedules; unverified issuance; cross-guild result contradictions; invalid frozen selection counts; and actual immutable writer-to-CLI integration.

These are implementation/fixture measurements, not real forecasting improvement. Original forecasts/results, pinned prospective studies, production datasets and model artifacts were not rewritten.

## Remaining requirements

Canonical hash-chain verification remains the caller's responsibility when supplying arrays directly. Result state follows verified append order; recorded clocks do not authenticate underlying source truth or uniquely reconstruct absent historical data. Forecast-ID collision handling, full raw-input equivalence, cross-game/guild dependence, descriptive binary versus multiclass score conventions and historical source/feature availability need further review. Adequate independent prospective outcomes and actual deployed-state verification remain unavailable/unproven.

Sports stays offline. No merge, deployment, promotion or live trading. Sports in progress; Crypto then Stocks requirements remain queued.
