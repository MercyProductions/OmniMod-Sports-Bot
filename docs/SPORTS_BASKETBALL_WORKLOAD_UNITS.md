# Basketball workload units

Development model: OmniMod Evidence Ensemble v6.0.19. Baseline 316 passing tests at 22e5ea1. Source only; no deployment, promotion or live trading.

## Defect and authoritative rule checks

Historical workload normalization and projected minute labels both used 40 for every basketball league. A fixture with 36 NBA minutes yielded .9 rather than .75; a .75 NBA estimate was displayed as 30 rather than 36 minutes.

The league rules support separate regulation scales:

- NBA: [official scoring/timing rule](https://official.nba.com/rule-no-5-scoring-and-timing/), 48 regulation minutes.
- WNBA: [2026 official rules](https://cdn.wnba.com/sites/4/2026/05/2026-WNBA-Official-Rule-Book.pdf), 40 regulation minutes.
- NCAA men: [official rules book](https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/men/PRMBB_RulesBook.pdf), 40 regulation minutes.
- NCAA women: [2025-26/2026-27 official rules book](https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/women/PRWBB_RulesBook.pdf), 40 regulation minutes.

References were checked October 21, 2026. The men's PDF exceeded the web reader limit; a read-only Python/pypdf check found the two-20-minute-halves rule on PDF page 69. Its URL, receipt timestamp and SHA-256 are retained privately. No rule-book content or credentials are published with the code.

## Repair and integration

- `sports-bot/src/participationProjection.js:33`: shared basketballWorkloadBasis defines NBA 48, WNBA/NCAAB/NCAAW 40, canonical college aliases and a versioned unit contract. Unknown league keys retain the existing 40-minute fallback explicitly labeled unverified_40_minute_proxy, not verified regulation time.
- `sports-bot/src/advancedMetrics.js:182`: parsing and rebuilding historical workload use that same definition with the record's league. Existing raw minutes can be recomputed under repaired semantics. The observed workload contract is now v2; old numeric-only v1 records lacking raw statistics cannot certify the new normalization.
- `sports-bot/src/advancedMetrics.js:362`: rebuilt profiles carry the unit contract. `:703` propagates it through the current profile caller.
- `sports-bot/src/participationProjection.js:58`: actual game league takes precedence during projection. An explicitly incompatible supplied unit contract invalidates historical workload input and its reliability count; the role prior remains labeled. A numeric legacy estimate without a unit contract remains visibly legacy/unknown and cannot certify measured NBA workload reliability.
- `sports-bot/src/participationProjection.js:127`: the production attachment caller passes game league into the projection. Normalization and minute labeling now share one scale.
- `sports-bot/src/evidenceCoverage.js:76`: per-game input evidence freezes unit basis and mismatch status.

No risk threshold, model-promotion requirement or blend weight was lowered. These changed forecast inputs require prospective comparison under the new model identity.

## Verification

Six new tests cover all four basketball leagues, matching projection scale, unknown-league disclosure, public profile-to-projection-to-evidence integration, mismatched/legacy unit contracts and alias identity, and zero/overtime boundary behavior. All are synthetic fixtures.

Baseline 316 tests passed; three initial regressions reproduced the mismatch or missing disclosure. Complete suite after repair: **322 passed, no failures/skips**. Syntax and whitespace checks pass. The integrated NBA control has one observed workload sample and returns 36 projected minutes from 36 historical minutes for an available confirmed starter.

## Remaining limits

The model retains its existing [0,1] cap, so 50 observed NBA minutes normalize to 1 and a full-share projection displays 48. Raw minutes remain available; includesOvertime=false describes the regulation basis. This is not an overtime forecast. Exhibition, shortened, special-format and historical rule changes are not modeled. A rule-defined game duration does not validate role priors or predict future minutes reliably.

Other sport denominators remain explicitly existing role-workload proxies. External season-selection calendars, remaining team-feature defaults, native publication lineage, actual running-host state and sufficient matched forward accuracy/calibration/costed evidence remain incomplete. Original prospective captures are preserved. cPanel is excluded and live trading disabled. Sports remains in progress, followed by Crypto then Stocks.
