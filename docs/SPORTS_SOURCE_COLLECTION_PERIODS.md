# Game-driven source collection periods

Development model v6.0.28. Baseline 2da8ee3: 387 passing tests. Source only; no deployment, champion promotion, live orders or source enablement.

## Confirmed defect and repair

The collection request used one September-based seasonStart for NFL, NHL and NBA. In an August fixture, a known NFL season-2026 game requested nflverse's 2025 team summary. Existing game-period gates correctly refused the mismatch, but collection never requested the eligible current cohort. A source year that was already known from the game was lost before the request.

[Source collection planning](../sports-bot/src/sourceCollectionPeriods.js#L8) now uses unambiguous supported game metadata independently for NFL, NHL, NBA and MLB. NFL uses its explicit season year, NHL its existing consecutive-year composite contract, NBA the previously observed ESPN ending-year contract, and MLB its calendar-year assertion. No month or date is used to guess between conflicting native assertions. Tennis and StatsBomb retain existing behavior.

[Request validation and identities](../sports-bot/src/advancedDatasetContracts.js#L3) accept six scoped selectors. Each is validated before provider work and included in that source's existing request key. [Actual endpoint selection](../sports-bot/src/advancedDatasets.js#L244), native payload validation and source row stamps use those selected scopes. Schedule filtering has its own minimumSeason instead of borrowing the stats summary's season. Roles remain separate for Baseball Savant.

Explicit source pins take priority. Existing explicit global year/seasonStart pins retain precedence over automatic game inference, preserving deliberate historical research. Without a supported game period, the existing calendar fallback remains disclosed. Multiple different valid seasons for one unpinned source are a conflict: that source is not fetched and cached records cannot silently choose one of the seasons. Other sources proceed normally. This is not multi-period cache storage; an intentionally mixed historical batch needs explicit period-specific calls.

## Developer API

Both syncAdvancedDatasets and attachAdvancedDatasetContext accept optional sourcePeriods:

```js
{
  sourcePeriods: {
    'nflverse-team-stats': { seasonStart: 2026 },
    'nflverse-schedules': { minimumSeason: 2025 },
    'moneypuck-team-xg': { seasonStart: 2025 },
    'nba-advanced-teams': { seasonStart: 2025 },
    'baseball-savant-batter': { year: 2026 },
    'baseball-savant-pitcher': { year: 2026 }
  }
}
```

These are illustrative scope values, not verified live-data availability or recommended configuration. No new environment variables or paid access are implied. Invalid sources, fields and years reject before HTTP work.

The attachment result includes collectionPeriodPlan, with selected field/period, basis, game seasons and game IDs. Per-game sourcePeriodEvidence freezes its collectionSelection. Scoped changes invalidate only their source's success cache. Different concurrent requests serialize; equivalent requests retain coalescing. Provider Retry-After remains binding even with force and a changed period. Existing native-period, sample, chronology and model/risk controls remain required.

Period-mismatch tests now explicitly pin the wrong requested cohort they intend to challenge. They still assert rejection and strict cutoff behavior. When a requested period changes, stale factor fields are cleared and known-game cached-but-ineligible inputs retain missing-source diagnostics; unknown legacy cases retain their prior behavior.

## Actual verification

Five of the first six new regressions failed on baseline; the deliberate global-pin control already passed. Ten new tests now cover independent August periods, global pins, mixed-season conflicts, scoped endpoint/receipt identities, invalid selectors, independent cache retention, actual Retry-After handling, cached-conflict exclusion, MLB role URLs, unsupported NBA mapping and concurrent scoped serialization.

Complete suite: 397 passed, zero failures/skips. Syntax and whitespace checks pass. The new synthetic August example requests NFL 2026 while preserving NBA 2025-26 and NHL 2025 scope, then attaches the matching synthetic NFL factor.

A private offline integration check also reused the previously authorized actual nflverse 2024 REG CSV. With an explicitly synthetic game/year and August 2026 clock, the game-driven planner selected the 2024 endpoint; all 32 actual historical team rows were accepted, zero rejected, and the matching factor was finite. No network request or forecast was issued, and the original file hash was unchanged. This verifies schema/import/selection behavior only, not historical publication availability or predictive performance.

## Remaining limits

Game periods remain source/manual assertions. Unknown or unsupported conventions retain fallback diagnostics; a complete league calendar is not established. One cohort per source is persisted, so mixed-season storage and retention remain unfinished. Current-season regular summaries may genuinely be absent in preseason; the bot does not label last season's data as current to fill that gap. Separate lagged-season/roster-transition modeling needs validation.

Source sample adequacy, publication/revision chronology, physical measurement ranges, real endpoint entitlements, actual running-host verification and adequate prospective outcomes remain incomplete. The original NHL captures and production state are unchanged; cPanel is excluded and blocked providers were not retried. No improved accuracy, calibration or economic return is established. Sports remains in progress, followed by Crypto and Stocks.
