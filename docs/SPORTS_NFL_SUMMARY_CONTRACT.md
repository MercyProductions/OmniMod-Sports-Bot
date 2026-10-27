# NFL regular-season summary contract

Development model: OmniMod Evidence Ensemble v6.0.14. Source changes only; no deployment or promotion.

## Observed evidence and defect

The existing URL requests `stats_team_reg_YEAR.csv`, not the weekly file. The authoritative [nflreadr loader](https://github.com/nflverse/nflreadr/blob/main/R/load_stats.R) maps `reg` and `week` to distinct file names. Its [reference documentation](https://nflreadr.nflverse.com/reference/load_team_stats.html) describes those summary levels.

A read-only October 21, 2026 retrieval of the public [2024 regular-season file](https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_reg_2024.csv) contained 32 rows, 32 distinct teams, declared season 2024 and REG records. This does not support the hypothesis that this endpoint needs weekly aggregation. Existing division of EPA totals by observed games is retained; CPOE remains the provider's supplied statistic, not divided by games or summed across teams.

The actual adapter did not check native season/type/grain and used `Object.fromEntries`, silently retaining the last duplicate team. A synthetic wrong-season payload was accepted before repair (regression failed). Adding weekly rows together would introduce an unsupported change and could double-count already aggregated totals.

## Implemented repair

- `sports-bot/src/advancedDatasetContracts.js:44`: `checkedNflSeasonRows` requires season, season_type, team and games columns, plus the existing measured-feature contract. Every accepted identity must declare the requested season and REG; populated week values and duplicate normalized team identities reject the entire refresh.
- Invalid blank team identities retain the existing counted rejection behavior. Partial measurements remain null and true zeros remain usable. Game counts are not invented; zero/missing counts still cannot produce per-game rates.
- `sports-bot/src/advancedDatasets.js:244`: validation completes before any replacement. Failure retains previous data and actual success provenance under existing backoff. Team keys are trimmed and uppercased consistently.
- `sports-bot/src/advancedDatasetContracts.js:15`: NFL request identity now includes the regular-season-summary contract. Older receipts cannot certify validation by the new contract and refresh under the existing rate-limit rules. Known older request keys do not attach as the new contract's data. This intentionally invalidates old NFL cache certification.
- `sports-bot/test/advanced-payload-identity.test.js:133`: negative controls cover wrong season, postseason, weekly grain, duplicate teams with case differences, and missing native period columns. Existing receipt/cache/missing-value fixtures now declare their simulated season/type.

## Verification and limits

Baseline: 290 passing tests. New regression reproduced acceptance of an invalid period. Focused adapter suite after repair: 26 passing. Complete suite: **291 passed, no failures/skips**. Syntax and whitespace checks pass. The pure contract accepted the independently retrieved real file: **32 accepted, 0 rejected**. Private evidence retains source URL, SHA-256, receipt time and rows outside Git; no credentials or historical dataset is published.

This verifies one historical payload and tested failure mechanisms, not all seasons or the actual deployed host. It does not establish source publication/revision history, season-to-date availability, defensive EPA comparability, model feature scaling or calibrated predictive improvement. NFL's inherited month-based season selection remains to be assessed separately against league calendars. Other sport adapters still need unit/grain reviews. Live trading remains disabled; cPanel excluded. Sports remains unfinished, followed by Crypto and then Stocks.
