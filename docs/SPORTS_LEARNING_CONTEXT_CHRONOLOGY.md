# Learning-context availability repair — development v6.0.4

## Confirmed defects

`loadModelContext` previously filtered caches and imported results by schedule date only. An old game's final first observed after the forecast cutoff could therefore enter calibration, outcome validation, drift penalties or Elo. Manually updated team Elo seeds were not time-filtered. Calibration examples could also repeat the same game across guilds, inflating apparent sample size. These defects were confirmed by the current source and targeted regression tests; they are distinct from the earlier exact-feature-fit repair.

## Changes

`learningInputsBefore` now establishes an explicit learning information cutoff. Manual result records, external result receipts and team seeds must have valid availability timestamps strictly before it. When multiple receipt/update fields exist, a newer revision cannot borrow an older receipt time. Cached Elo results require an explicit observed-final timestamp, rather than treating a general schedule fetch as a final-result receipt. Unknown timestamps and post-cutoff revisions are excluded with structured counts.

`collectGradedRows` has a cutoff-constrained learning mode. It requires an actual final game, valid pregame generation/start chronology, and `resultObservedAt` between the start and cutoff. Learning cohorts select the earliest qualifying forecast for each league/game/start/model/horizon across guilds; conflicting grades exclude that game. Descriptive legacy reports retain their existing behavior and must not be mistaken for cutoff-verified learning evidence.

The actual `loadModelContext` caller now supplies a current information cutoff for today's slate. Other dated builds keep the conservative exclusive schedule-date filter and UTC-midnight cutoff. Same-date results remain excluded by this schedule policy; this patch does not add same-day learning or relax its requirements. The cutoff audit is attached to generated forecasts and frozen in their journal snapshot.

The model identity is v6.0.4. Earlier forecast probabilities, model identities and result histories are not relabeled. Calibration still separates current model version and horizon; a new version may have no eligible calibration records. Do not transfer previous-version statistics silently to fill that gap.

## Verification

Before this phase, 191 Sports tests passed on `f8e1fc1a786a31e756ef079d7be52d7fc904cd3f`. After this phase, all 197 tests pass with zero failures/skips. Configured syntax and whitespace checks pass.

New tests cover late observed results despite early schedule dates; absent, pre-start and cutoff-equal availability; future manual seeds and imported revisions; unverified schedule receipts; a full persisted-cache-to-loaded-context test showing future updates cannot change earlier Elo/calibration; and duplicate/conflicting guild examples. Existing historical-cache fixtures now explicitly expect unknown result availability to be excluded from learning.

Synthetic tests prove these gates, not real prediction improvement. No production deployment, provider request, Discord post, model promotion or real-money order occurred.

## Remaining limitations and next work

- Latest mutable caches and manual stores cannot reconstruct earlier revisions. Exclusion is truthful missingness, not recovered historical coverage.
- A receipt or import timestamp proves observed availability, not exact source publication, a game completion timestamp or source independence.
- This gate covers learning/calibration/Elo inputs. Other current manual player/context profiles, automatic historical aggregates, advanced features and source-correction provenance still need a complete point-in-time review.
- Elo source conflicts/revised event deduplication, hybrid champion governance, actual deployed source/configuration/scheduler inspection, and isolated prospective baseline/challenger collection remain unfinished.
- Proper-score, calibration and after-cost improvement require real matched prospective outcomes. No improvement or profitability is established.

Sports remains in progress; the full Crypto and Stocks specifications remain queued afterward.
