# Source event association and final refresh integrity

Development model identity: v6.0.34. No prediction weights, risk thresholds, production configuration or live-trading setting were changed.

## Confirmed defects

The old `gamesMatch` immediately accepted equal native IDs without league/start checks. Its different-ID team-name fallback omitted start time. Local metadata overlays, targeted source merging, carried-forward odds and frozen prediction selection used that predicate. Final refresh independently used a last-write-wins native-ID map and a first-match cached prediction lookup. These could attach a different league's final or a later same-team matchup to an earlier forecast.

Source ambiguity was also collapsed before reaching the conflict-aware journal. A disputed score could therefore look like one ordinary final rather than two contradictory observations.

## Changes

[Source matching](../sports-bot/src/sourceEventMatching.js) now requires a nonempty matching machine league and exactly matching canonical scheduled start. Equal native IDs are accepted only within that scope. Different-ID aliases additionally require both nonempty ordered team names to match using the established entity normalizer. Distinct payloads matching one scoped event are ambiguous; identical canonical content coalesces.

The existing [sports-data callers](../sports-bot/src/sportsData.js) use this shared resolver:

- Local venue/neutral-site metadata keeps its precedence only for a unique matching event. Another league with the same native ID remains separate.
- Carried-forward odds require one matching cached source observation. Conflicting snapshots or different starts/leagues cannot provide the quote.
- Targeted refresh merging retains conflicting observations instead of silently selecting the first one. Downstream journal eligibility can therefore see and quarantine the disagreement.
- Frozen forecast selection uses scoped cached evidence. The separate legacy display-only fallback remains ineligible for calibration; it does not supply missing source timestamps.
- Final refresh resolves each cached prediction to its own scoped event and each event to a unique fresh observation. Valid different-ID source aliases retain the cache's original ID while recording the upstream ID. Original issue times and probability vectors remain unchanged.
- Conflicting final observations clear the mutable displayed grade and produce no new final-result notification. Both source observations reach journal and warehouse reconciliation, removing the existing label from eligible research data. A candidate is not graded merely because it appeared last.
- The returned slate includes structured `finalAssociationRejections` with event scope, reason and matching observation count. Missing source matches are distinguished from ambiguous matches; neither is treated as evidence that the team lost.

Code locations in this revision: `sports-bot/src/sourceEventMatching.js:6` (predicate), `:16` (unique resolver); `sports-bot/src/sportsData.js:373` (`mergeLocalGames`), `:595` (`carryForwardOdds`), `:604` (`mergeTargetedGames`), `:656` (`frozenOrFreshPrediction`), and `:966` (`refreshFinalGrades`). The old permissive `gamesMatch` is removed; no generated/provider files were changed.

## Verification and valid before/after evidence

Pre-change complete suite: 470 passing tests. The original committed final-refresh implementation was run against the four new full-refresh integration scenarios: **three failed, one passed**. After repair all four pass. Five additional source-matching/merge tests verify canonical timezone equivalence, missing scope, repeated/reversed/empty team names, duplicate/conflicting source payloads, quote isolation, targeted conflict preservation and local metadata precedence.

Complete suite: **479 passed, zero failed, zero skipped**. `npm run check` and whitespace checks pass. Full-refresh tests execute the actual scoreboard parser, model-context loading, source merge, final grader, journal and warehouse writers with injected synthetic ESPN HTTP responses. Unknown network routes fail the fixture. The conflict regression checks a nonempty warehouse cohort and confirms its disputed status, as well as journal exclusion of a previously accepted label.

These are synthetic integrity results. They do not establish live provider coverage, forecasting accuracy, calibration improvement, wagering value or actual Discord delivery. No production forecast, operator adjudication, real data collection, deployment, model promotion or live trade occurred.

## Limitations and next work

Native IDs are assumed meaningful within the verified league/start scope; source truth and team identities are not independently authenticated. The different-ID alias rule uses exact normalized ordered names and intentionally cannot resolve abbreviation-only aliases, reschedules, missing starts or genuinely conflicting sources. Those require explicit source-specific reconciliation. Provider receipt time remains collection evidence, not proof of underlying publication time.

A unique cached final remains usable when fresh source data is absent. This phase does not automatically retract every prior result because a provider temporarily omits a game or returns it as nonfinal. Previously finalized research reports are immutable and are not automatically withdrawn on later evidence changes. Full revision lineage and compact timestamp/missingness contracts remain unfinished.

Final message reply/claim keys and Discord recovery footers still use native IDs and must be scoped next, as must quote-only refresh selection and other remaining adapter callers. Source identity fixes do not claim those paths are complete. Actual running-host version/configuration/jobs remain unverified, and adequate prospective outcomes have not established model improvement. Preserve the original prospective captures. cPanel is excluded. Sports remains in progress before Crypto and Stocks; no merge, production deployment or live trading is performed.
