# Governed current-version collection and availability audit

## Working installation

The original v6.0.52 NHL Daily hybrid-versus-evidence trial remains pinned to source `03c6714ff0ca47ce98b491807ad3742877ca0102`. Its eighth checked invocation completed at **2026-10-24T13:27:49.133Z**: 12 distinct games, one date, zero finals, eight evidence receipts and 79 retained provider blobs. That invocation made ten ordinary free-provider requests, with three failures; the eight checked runs total 87 requests. Repeat captures do not add independent games. The original source archive, collector manifest, plan, artifact and original forecast receipt chain verified unchanged.

A separate current-model trial is now registered and installed:

| Property | Frozen value |
| --- | --- |
| Model/source | v6.0.67 / `90e7442d96d0493609da51419a852b6d7bcb6862` |
| Plan | `nhl-hybrid-daily-v6067-20261108` |
| Plan hash | `f6b2117e4c5fed026aa0f32ccf28eec4cd3caef1a6fff1a0188a8e56eb2147a2` |
| Hybrid artifact | `cc187ee60aad09f6048c1e2b2b3fc33d2e44560d1d013ba01073b6e9eb29bae8` |
| New forecast period | November 8, 2026 12:00 UTC through November 22, 2026 12:00 UTC, end exclusive |
| Final reconciliation grace | Through November 29, 2026 12:00 UTC |
| Existing minimums | 75 independent games, eight dates, at least 14 days |
| Scope | NHL Daily, fixed hybrid versus evidence, isolated cold-start research |

The later window preserves the existing rule against overlapping league selection periods. Both trials use the **same physical selection ledger**. The new trial's `selection/` is a junction to the original selection directory. Registration added the new immutable plan/artifact to that mutable ledger; it did not replace the original plan or reset consumed outcomes. Source scripts, tests and documentation in this phase do not change inference `src/` bytes or the v67 artifact.

The additional Codex heartbeat is ACTIVE and scheduled hourly on November 8–29. Before the exact start, the collector returns `awaiting_trial_start` with zero requests; after the grace window it cannot collect. The original collector, separate current-source final-only reconciliation and Stocks test automation files were checked byte-identical. Automated execution depends on this PC and Codex being available. Saved scheduling and an interval counter do not prove uninterrupted future wakes; actual timestamps and missing intervals must remain visible.

## Collector protections

`sports-bot/scripts/family-forward-trial.mjs` wraps the existing bounded collector rather than replacing its worker, ownership rules or scientific decision thresholds. It verifies:

- Manifest-pinned family binding, canonical shared ledger path, unique participant roots and exact member plan hashes.
- Each member's existing source archive, manifest, dependencies, selection artifact and original capture/provider/journal evidence.
- Every shared plan's hash, predeclared chronology, sample minimums and artifact bytes, including later added plans.
- Non-overlapping same-league periods, report integrity and complete, unique consumed-game accounting.
- The family again immediately before worker execution under the existing exclusive run lock.

One prepared private invocation is:

```text
node sports-bot/scripts/family-forward-trial.mjs --directory=<verified-private-trial-directory>
node sports-bot/scripts/family-forward-trial.mjs --directory=<verified-private-trial-directory> --inspect-only
```

The private installation contains 116 pinned files. The installed real runner passed inspection, awaiting-start and archived-worker `--verify-only` checks: **zero provider requests, orders or Discord posts**. No v67 selection forecast has yet been collected. The worker inherits only operating-system variables plus explicit research settings; no Discord, odds or broker credentials. Live trading is false, emergency stop true, learning/ML/warehouse/replay and Discord disabled. It permits only existing ESPN/NHL public JSON GET collection, rejects redirects and uses the existing child timeout. This is a cooperative local integrity mechanism, not signed provider authentication, protection against a malicious OS owner, or proof of distributed exactly-once behavior. A changed/partial/owned directory fails closed; never erase evidence or steal a lock to force execution.

The existing proper-score decision remains unchanged and no model activates automatically. Shared bookkeeping prevents duplicate holdout use; it does not solve all multiple-experiment selection bias, date/team dependence, publication-time uncertainty or later corrections. Adequate completed evidence and an independent review are still required. Different versions and overlapping engineering diagnostics cannot be pooled into this trial.

## Missing injury and goalie data: measured causes

`sports-bot/scripts/audit-capture-availability.mjs` reads an explicitly hash-bound saved capture. It summarizes **frozen evidence at each original forecast cutoff**, without provider calls, re-enrichment, forecasts, orders, Discord or learner writes. It separates missing legacy coverage from observed zero rows, mappings from failed requests and request-cap omissions, season candidates from event starters, conflicting assertions from usable single-role records, and individual injury assertions from a complete team report.

```text
node sports-bot/scripts/audit-capture-availability.mjs --capture=<saved-private-capture.json> --expected-sha256=<verified-capture-byte-hash>
```

The existing v67 engineering capture at 12:33 UTC was verified byte-identical and audited offline:

| League | Games | Summary bottleneck | Injury coverage | Confirmed critical role sides |
| --- | ---: | --- | --- | ---: |
| NHL | 12 | 12 unverified ESPN event mappings | Unknown for all 24 team sides | 0 |
| NBA | 8 | 5 failed summary requests; 3 request-cap omissions | Unknown for all 16 team sides | Not a single-position role |
| MLB | 1 | 1 failed summary request | Unknown for both sides | 0 |

Six NHL games had native season context containing 23 goalie candidate rows. The other games did not have recorded season context in this bounded capture. Those candidates are **not** projected or confirmed event starters. None of the 21 games had a fresh accepted summary, an individual injury assertion or a connected preferred-provider snapshot. The saved request ledger reports the six summary calls as HTTP403. These numbers describe this capture, not all future provider access or complete market coverage.

This distinction matters: guessing ESPN IDs from native NHL IDs cannot recover a valid summary; raising request caps cannot repair denied access; selecting a season leader cannot establish the goalie starting that game. No denied endpoint was retried or bypassed for this audit. The existing optional provider adapter still accepts explicitly scoped NHL starter/projection/injury snapshots with source clocks, event/native-player identity, expiry and conflicts checked. Its real adapter → evidence → audit integration is tested with fixtures. No actual alternate feed was configured, no medical clearance inferred, and no real missing clinical coverage recovered in this phase. [Provider setup and limitations](SPORTS_GOALIE_INJURY_PROVIDERS.md) remain applicable.

## Verification and next steps

Reproduced baseline: **1,190 passed**. Added 12 family/collector and nine availability-audit tests. Focused collector/selection/provider/audit command: **59 passed**. Full default-parallel `npm test`: **1,211 passed**, zero failed/skipped. `npm run check`: **231 files**. Whitespace, configured-secret comparison and changed-public-file/PR-text Gitleaks scans passed with zero findings; private evidence and account settings are excluded from the repository.

Actual long-period performance, calibration, final-result completion and economic edge remain **unverified**. This installation does not certify the existing learned production state, other horizons/leagues, NFL arithmetic in real games, executable odds or deployment. The Sports bot is user-confirmed offline. No main merge, production startup, deployment, credentials change, model promotion or real-money trading occurred. Continue preserving original trial evidence, reconcile only eligible real finals, investigate authorized explicit starter/injury sources when available, and review the complete Sports requirements before moving to Crypto, then Stocks.
