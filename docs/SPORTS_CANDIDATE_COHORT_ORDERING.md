# Candidate cohort ordering and duplicate evidence

## Confirmed cause

`selectCandidateCohort` in `sports-bot/src/candidateCohorts.js` selected a duplicate game record if it contained more candidate vectors. Both `trainLocalMlModels` and `evaluateCandidateModels` use this selector. A later revision could therefore supply challenger evidence absent from the earlier issue, and ties could depend on input order. Event identity used raw league/date/game fields rather than canonical league/start identity. The prospective chronology check accepted timezone-naive clocks through `Date.parse`.

## Repair

Within the existing selected provenance/model/horizon cohort, game identity now uses normalized league, string event ID and the canonical explicit-zone scheduled start. Where a historical record has no valid start, its date remains a legacy fallback and cannot establish prospective chronology.

Production selection uses the earliest explicit-zone recorded issue; replay selection uses generated time and stays nonprospective. Later records cannot win through candidate completeness. Duplicate groups with unknown issue ordering are excluded. Simultaneous earliest rows with different candidate vectors, artifact IDs, features or original primary inputs are quarantined. Conflicting actual labels exclude every copy as before. Identical tied copies select the latest available resolution receipt conservatively; this can exclude the whole duplicated event at an earlier training cutoff instead of assuming the label was available sooner. No original record is modified.

The cohort report adds `ambiguousFirstForecastGamesExcluded` and `duplicateChronologyGamesExcluded`. Existing cross-version/horizon/provenance selection and model promotion controls remain in force. Prospective status now requires strict explicit-zone chronology and a nonempty league/event identity. This is an evidence selection repair, not a new strategy or model promotion.

## Verification

- Reproduced baseline: 692 tests passed.
- Nine new regressions; eight fail against the preceding selector, while the conflicting-label preservation check already passes there.
- Repaired focused cohort, ML, selection-protocol and journal suite: 52 passed.
- Complete suite: 701 passed; zero failures/skips. Syntax and whitespace checks pass.
- Registry integration proves a later richer revision cannot create a same-issue challenger comparison. Trainer integration proves a tied copy's later label receipt cannot be consumed before its recorded availability. Tests also cover reverse input order, offset/case aliases, simultaneous input conflicts, missing clocks, replay ordering and immutable inputs.

## Remaining evidence and deployment limits

The selector does not authenticate arbitrary caller-provided arrays or reconstruct absent forecast history. Single legacy records may remain available for descriptive research, but cannot prove prospective chronology without all required evidence. Cohort priority still selects one provenance/model/horizon group according to its existing policy; this is not a preregistered champion-selection protocol. Model score formulas, historical feature leakage, reference-vector semantics, label source truth, and complete source coverage still require their own evidence. No historical accuracy or profitability improvement is claimed.

No installed model, production dataset, Discord process, scheduler, deployment or promotion was changed. Sports remains user-confirmed offline; startup and installed configuration remain unverified. Sports is in progress; Crypto then Stocks remain queued. Live trading remains disabled.
