# Inference input cutoff repair — development v6.0.7

## Confirmed defects

Several prediction freshness functions used wall-clock `Date.now()` despite `predictGame` accepting a caller-supplied historical information cutoff. Source and market ages also clamped future observations to zero or tolerated future quotes. Automatic team/player rows bypassed the manual override's future-time check. A supplied future learned context or late head-to-head result could remain visible to direct inference callers.

Adding the model context's explicit cutoff exposed another pipeline issue: upcoming-date slates previously used the future schedule date as their default learning cutoff. They must use the actual observation time. Today's and future scheduled slates now receive the current information cutoff; retrospective dated builds retain the conservative historical cutoff. Existing offline fixtures verify that future scheduled dates do not move the real information clock forward.

## Implementation

`inputChronology.js` clones inference inputs and classifies declared receipt/update/observation times as observed by cutoff, unknown, invalid or after cutoff. Known invalid/future manual profile/context rows, automatic profiles and explicitly dated aggregates are excluded with structured counts. Unknown legacy timestamps remain unknown rather than becoming an invented date.

When a summary or history aggregate is explicitly unavailable by cutoff, its inseparable derived player/lineup/context or team/advanced aggregates are removed conservatively. Per-side history receipt times are checked, so an early timestamp on one side cannot conceal a later one. Excluding player observations removes the unrecomputed lineup aggregate instead of retaining its influence. Original caller inputs remain unchanged.

Explicitly future schedule observations cannot contribute team record strength or third-party feed confidence. A learned context whose declared learning cutoff is later than inference is excluded from Elo/calibration/drift/feature-history inputs. Head-to-head outcomes require actual observation availability and an event time before the inference cutoff. Selected evidence coverage remains separate from the audit of the supplied context collections.

Player/local data freshness, source freshness and market ages use the same inference cutoff. Future or malformed quote timestamps, including nested bookmaker quotes, cannot steer the ensemble. Invalid explicit inference cutoffs throw rather than falling back to today's time. Actual transport/lifecycle timestamps continue to use real observation time; a historical inference cutoff cannot create an observed pregame journal record after kickoff.

The cutoff audit is attached to the prediction and frozen in the journal. Development model identity is v6.0.7 because input eligibility changes. Earlier frozen probabilities and versions remain unchanged. Final risk/value requirements were not lowered and no model was promoted.

## Verification

225 baseline tests reproduced at `dd9c39a0539f1a6025b69387f4b63f38b489e360`. Current full Sports suite: 231 passing, zero failures/skips; configured syntax and whitespace checks pass.

New tests verify future automatic profiles cannot change earlier prediction probabilities; summary/history dependencies are excluded together; original inputs remain unchanged; nested/future/malformed market timestamps cannot blend; local freshness uses the requested clock; future schedule confidence is withheld; later learned state and unknown head-to-head results are excluded; invalid cutoffs fail; and unknown legacy timestamps remain disclosed. Existing head-to-head fixtures now include explicit outcome availability and a consistent simulated cutoff. The future-date offline test exposed and verifies the actual schedule-date cutoff correction; its confidence assertions were retained.

No network/provider requests, Discord posts, production deployments, live orders or model promotions occurred in this phase. Synthetic regression outcomes do not establish forecasting improvement.

## Remaining limitations

Declared receipt/update fields do not independently establish publication time. Untimestamped legacy profiles and derived aggregates are not reconstructed as point-in-time history. Arbitrarily supplied learned state without provenance and nested derived feature lineage still require review. The audit explicitly reports `pointInTimeComplete: false`; it does not certify every raw statistic or historical revision.

Real pregame comparison data, permitted provider coverage, deployed-host configuration/jobs, league-specific validation and the complete requirement-to-evidence report remain unfinished. Sports stays active before queued Crypto and Stocks.
