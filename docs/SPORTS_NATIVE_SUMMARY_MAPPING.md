# Native NHL to ESPN summary mapping — October 26, 2026

Development identity: **v6.0.70**. Baseline before this phase: `92cb2da8e91139c209e1edded0a1bc85aaf83314`. This is a data-routing repair, not validated predictive improvement. The original v52 trial and registered v69 trial keep their exact source, forecasts, plans and artifacts; neither validates this newer source.

## Reproduced defects

Two regressions failed against the preceding source. A targeted refresh switching from an ESPN schedule to native NHL could retain two rows for one event because their IDs and display names differ. There was no automatic bridge preserving the ESPN event and team IDs. Separately, a native `YYYY(YYYY+1)` season was compared directly with a summary's single declared season year and rejected as a mismatch.

An explicit legacy `espnEventId` alone still does not establish matching ESPN team IDs. Treating NHL and ESPN numeric team/player IDs as interchangeable would attach the wrong injury or goalie record.

## Implemented behavior

- `espnEventMapping.js` retains explicit fields from an already fetched NHL ESPN scoreboard. Both provider observations must be usable, pregame and less than 15 minutes old. Exact event start, ordered explicit team names and matching declared season/type are required. Native NHL season ranges are checked against the ESPN ending-year declaration; malformed ranges, missing declarations, ambiguous events and contradictory observations are rejected.
- A mapping retains the two event/team namespaces, local event binding, source receipt, native receipt, binding clock and expiry. It makes no independent publication-time or authentication claim. It never derives an ESPN ID from an NHL ID and never queries a website or new endpoint to discover one.
- Daily/targeted collection can reuse matching fresh observations already in its current/cached slate. Targeted fallback merges preserve one matched game without changing the cached original. An ESPN recovery removes obsolete native routing metadata.
- Summary roster/injury groups use the verified ESPN team IDs and retain the local NHL team name. A different team ID cannot borrow an injury or starter assertion through a matching name. Explicit roster starters remain separate from probable goalies and medical availability. Unknown health remains unknown; Out assertions retain their veto.
- Mapping-dependent inputs and direct coverage reports recheck chronology and bindings. A later mapping cannot make an older cached summary available to an earlier forecast. Historical alias identity does not revive expired routing or supply current health evidence.
- The slate records `summaryEventMapping` counts and structured rejection reasons. Mapping performs **zero additional requests**. Existing Odds API matching, price/cost checks, uncertainty and risk requirements remain separate.

An important limit: this bridge needs a genuine fresh ESPN observation. It cannot recover a mapping from a denied or absent feed, revive an old mapping, or turn native season-goalie statistics into confirmed starters.

## Actual free-feed verification

At **2026-10-26T06:42:42Z**, an isolated account-free probe made two ordinary GET requests through the existing provider-cache client:

| Existing feed | Response | Parsed games | Result |
| --- | --- | ---: | --- |
| ESPN NHL scoreboard, requested date 2026-10-26 | HTTP 403 | 0 | No usable ESPN observation |
| Native NHL score, same date | HTTP 200 | 3 | Three native events; all three mappings remain unavailable |

No summary request, alternate-origin retry, paid Odds API query, forecast, order or Discord post occurred. Zero new injury assertions or confirmed goalies were recovered. Native schedule access is not clinical/starter coverage. Raw responses, receipts and failure evidence remain private. The present probe does not verify a live ESPN season/mapping contract or establish that missing opportunities do not exist.

## Verification and remaining work

Thirty new cases include the two prior-source failures, the normal mocked enrichment client, provider namespace changes, injury vetoes, explicit versus projected goalie records, contradictory mappings and earlier-cutoff leakage. **1,322 full tests** pass with zero failures/skips; `npm run check` passes **245 files**. Commands: `npm test`, `npm run check`, and `git -c core.whitespace=cr-at-eol diff --check`. These are software checks, not live clinical-feed certification or model validation.

Genuine injury/confirmed-goalie inputs, accessible exact provider observations, independent current-source forward evaluation, original offered-price/settlement/cost records and approved runtime verification remain unfinished. No threshold, circuit breaker, risk control or promotion criterion was relaxed. Existing v52 and v69 collectors and the Stocks test automation remain unchanged. Live trading stays disabled, emergency stop enabled; no production startup or model promotion occurred.

See the [phase checklist](SPORTS_NATIVE_SUMMARY_MAPPING_CHECKLIST.json), [provider contract](SPORTS_GOALIE_INJURY_PROVIDERS.md), and [full requirement index](SPORTS_REQUIREMENT_EVIDENCE.md).

## Current-source completion audit — 2026-10-26

The user subsequently authorized local startup. The local worker runs the archived **`86f6d4b79bb331faaa3db10907ff82af1885f767`** v70 source with verified dependencies and a separate private data directory. Discord identity/channel permissions and registered commands were checked. At 08:11 UTC the gateway and scheduler were running; the configured daily slate is **08:00 America/Chicago**, with T-90/T-30/T-10 refreshes. Startup posting is disabled. Actual scheduled delivery and recovery remain unverified until observed. This local worker depends on the computer remaining awake and has no installed autostart supervisor. Automatic learning/training and live trading remain disabled, and emergency stop remains enabled. No cPanel deployment occurred.

An account-free paired capture at **08:05:35–08:05:39 UTC** froze the original v6.0.0 baseline and v70 observations:

| Observation | Actual count |
| --- | ---: |
| Current-source games | 14: nine NBA, three NHL, one MLB, one NFL |
| Contemporaneous baseline pairs | 4: three NHL, one NFL |
| Current forecasts without a baseline counterpart | 10, excluded from paired scoring |
| Eligible final outcomes at capture | 0 |
| Current-source requests / failures | 29 / 15 |
| Baseline requests / failures | 15 / 11 |
| Unknown team-side injury coverage | 28 / 28 |
| Confirmed NHL goalie sides | 0 / 6 |
| Current-source calibration sample size | 0 |

Current summary routing recorded six request failures (five NBA, one MLB), five request-cap omissions (four NBA, one NFL), and three unverified NHL provider mappings. These are distinct causes: increasing the cap would not repair denied requests or missing identity proof. The bounded research profile caps summary work at six games and requests at 32 per worker; this is not a measurement of full production coverage. None of the 14 forecasts qualified as an actionable recommendation: nine were withheld and five were research leans. The original predictions, inputs, source receipts and exclusions are frozen privately. Separate final-only checks may grade subsequent actual outcomes; these overlapping engineering observations are **not** a registered selection trial or an independent final holdout.

The active local registry has **zero selected sport models and zero trained local sport ML models**. Its inherited warehouse has 174 prediction rows but no results, box scores, lineups, plays or market rows; those legacy predictions are not adopted as validated current forecasts. Read-only operational and prediction audits found no production journal records yet, before the first scheduled daily slate. Zero records means the issuance/delivery/grading path has not been exercised in this runtime, not that all operational tests passed.

The unchanged source retains its verified 1,322 passing tests and 245-file syntax check; those checks were not rerun for this documentation-only checkpoint. Original v52 and v69 registrations, archives and schedules, and the Stocks automation remain unchanged. Sports still requires genuine fresh medical/starter observations, actual delivery/recovery evidence, eligible original-price/cost records, adequate independent outcomes and calibration across the required leagues/horizons. Predictive improvement has not been established. The preserved implementation queue remains **Sports, then Crypto, then Stocks**; this checkpoint does not mark Sports complete.
