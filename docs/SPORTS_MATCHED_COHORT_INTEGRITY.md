# Matched earliest-cohort and result audit integrity

## Confirmed defects

After forecast-ID auditing, different IDs at the same earliest issue instant were selected by lexical ID rather than treated as ambiguous. Identical primary probabilities could still hide different reference vectors, evidence or odds context. Result conflict detection inspected only already-selected/scorable rows, letting a later unselected revision's contradictory final or active dispute disappear before the event audit.

## Repair and references

- `sports-bot/src/matchedJournalEvaluation.js:112`: one cutoff-visible append-order result state is retained, including active disputes.
- Each identity-audited, lifecycle/chronology/scope-qualified issued revision contributes validly timed result labels/dispute associations **before** probability qualification or earliest-cohort selection. Event scope is canonical league/native ID/start, independent of guild/model/horizon. Results still require observed >= start, observed <= recorded <= cutoff and no declared schedule change.
- `matchedJournalEvaluation.js:138`: earliest-tie hashing excludes only the forecast ID and canonicalizes identity/issue timestamp representations. Differences in frozen probabilities, reference/candidate data, metadata or evidence exclude that cohort. Equivalent inputs under different IDs remain one deterministic observation; no resolved-result preference is used.
- `matchedJournalEvaluation.js:148`: ambiguous earliest cohorts are excluded without fallback to a later revision. Normal later-revision exclusions remain visible.
- `matchedJournalEvaluation.js:151`: contradictions across all qualified revisions quarantine the event, even if the contradictory row would not pass vector scoring.
- `matchedJournalEvaluation.js:170`: an active dispute on any qualified revision blocks matched comparisons for the event until the journal's linked reconciliation permits a valid label again.

Schema is now `sports-matched-journal-v2`. `candidateCohorts`, `ambiguousFirstCohorts` and `disputedGames` expose distinct cohort/event populations. Comparator exclusions report conflicts and unresolved disputes. These counters can overlap other record/cohort exclusions; they must not be summed as independent games. Stored previous reports are not rewritten.

## Verification

- Unchanged baseline: 780 passed.
- Ten added tests: eight targeted defect regressions fail against preceding report code (measured before adding the schema-v2 assertion). Two preservation checks cover equivalent earliest observations and unresolved-original/no-fallback immutability.
- Focused matched, summary, identity and journal suite: 67 passed.
- Full suite: 790 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage includes probability/reference/evidence differences under simultaneous distinct IDs; later unselected contradictory labels; vector-invalid rows hiding timely contradictions; active disputes and linked recovery; no later fallback; cutoff isolation; independent scheduled events; and input preservation.

All evidence above uses isolated fixtures. Original journal forecasts/results, private study captures, installed model artifacts and production datasets remain unchanged. Quarantine may reduce comparison counts, but is not improved model accuracy or profitability.

## Remaining requirements

Result state and frozen input hashes do not authenticate provider truth, settlement rules, missing historical availability or arbitrary arrays' hash chains. Candidate class/score conventions, full raw-capture equivalence, deterministic ID recipes, cross-game day/team dependence and adequate independent prospective outcomes still require evidence. Matching more carefully does not establish a wagering edge.

Sports remains offline; installed configuration/startup unverified. No merge, deployment, promotion or live trading. Sports in progress, followed by queued Crypto then Stocks requirements.
