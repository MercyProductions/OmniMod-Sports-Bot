# Provider odds-event identity

Development identity: v6.0.41. This repairs which provider event can supply a local game's prices. Prediction weights, value-policy thresholds, risk limits and provider request budgets are unchanged.

## Confirmed defects and source locations

The previous `sportsData.js` matcher treated home/away names as an unordered set, ignored a previously stored paid-provider event ID, and selected the nearest candidate inside a one-hour window even when several distinct events qualified. An explicit wrong provider sport was ignored. Identical duplicate observations were rejected as ambiguous, while provider events could be reused across different local game scopes. These defects affect evidence identity, not merely presentation.

`src/oddsEventIdentity.js` now inspects candidates, selects only one unique eligible observation and checks cohort-wide ownership. `sportsData.js` delegates its existing exported matching functions to that implementation and uses the cohort matcher in the actual daily odds-enrichment path. `valueQuoteRefresh.js` uses the same cohort rules across the selected league's local games.

The [official V4 guide](https://the-odds-api.com/liveapi/guides/v4/) documents event `id`, `sport_key`, `commence_time`, `away_team` and `home_team`. Checked October 21, 2026. No authenticated endpoint or paid request was used to inspect documentation.

## Matching contract

- Local machine league, distinct ordered normalized team names, provider event ID and timezone-qualified start timestamps are required. The existing one-hour start tolerance remains; it is not proof that a provider's schedule is correct.
- A supplied provider sport key must match the requested local sport. Missing native sport metadata retains explicitly weaker `request_scoped_native_unverified` evidence rather than being labeled natively verified. The request's league scope remains a trust assumption.
- An existing non-free provider event ID binds subsequent matching. Another same-team event cannot substitute for it. A free provider ID is kept in its separate namespace. A bound ID cannot override wrong teams, sport or start time.
- Exact duplicate provider observations coalesce. Multiple distinct eligible IDs or differing observations of one ID are rejected; array order and nearest time no longer decide between conflicting candidates.
- Cohort matching rejects conflicting local observations and prevents one provider event from serving multiple distinct league/start/native-ID local scopes. Identical local duplicates can share one scope.
- Structured evidence records selected ID, policy, start difference/tolerance, candidate/rejection counts, rejection reasons, native sport verification and bounded observation hashes. It does not include API credentials or raw request URLs.

Daily games retain `oddsMatchEvidence`, accepted odds retain `eventIdentity`, and diagnostics count identity rejections. Explicit quote-refresh results expose `oddsMatchAudit`, including unmatched responses; a failed request slot remains consumed. Forecast/price journal identity and warehouse prediction/market snapshots preserve accepted evidence. Original forecast probabilities and issue times remain unchanged.

## Verification

Reproduced baseline: **557 tests pass**. Restoring the previous matcher and daily builder reproduces **seven targeted failures**, including actual daily-builder acceptance of wrong-role odds. Repaired full suite: **570 passed, zero failures/skips**, plus syntax and whitespace checks.

Thirteen new tests cover ordered roles, known-ID binding, explicit sport conflicts, missing IDs/roles/timezones, unequal-distance ambiguity, duplicate coalescing/conflicts, free-ID namespaces, cohort reuse/local conflicts, actual quote refresh and budget reuse prevention, the actual daily builder, and durable journal/warehouse evidence. All network responses are injected fixtures; no paid provider request or Discord login occurred.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/odds-event-identity.test.js
```

These checks establish source-association behavior. They do not demonstrate better forecast accuracy, calibration or economic returns.

## Remaining limits

Team matching still uses the established normalized-name policy; it is not a universal native team-ID crosswalk. Events without explicit ordered provider roles are rejected, which can reduce coverage. Legacy paid event IDs with no explicit free-provider marker remain subject to the existing non-free namespace convention. Reschedules outside the tolerance require a separately verified new event binding, not automatic substitution.

Bookmaker/market/outcome duplication and source timestamp/settlement completeness still need audit. Missing native sport fields do not attest native classification. A quote-refresh rejection audit is returned to the caller; complete durable failed-attempt auditing across command/process failures remains unfinished. This phase does not add a transaction to the cache read-modify-write path.

Actual running host/configuration/jobs, controlled legacy correction baseline adoption and sufficient prospective prediction improvement remain unverified. Production deployment requires separate approval, data backup and isolated validation with the real configuration. Sports remains in progress, followed by the full Crypto and Stocks specifications. No merge, deployment, model promotion or live trading; cPanel excluded.
