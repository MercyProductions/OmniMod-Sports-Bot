# Windows lock and selection chronology validation

Development model identity: **v6.0.51**. Sports remains in progress and user-confirmed offline. This phase does not activate a model, start the bot, place orders or send Discord messages.

## Windows lock handling

The prior default-parallel failures involved two separate protocols: exclusive audit-store owner locks and immutable final-result claim generations. They must not be treated as one proven root cause.

The unchanged baseline passed 875 tests in default parallel mode this phase. The earlier concurrent writer EPERM is a confirmed observed failure, but its operating-system cause has not been traced. Windows can transiently deny exclusive creation while deletion or sharing completes; that is a possible explanation, not an established diagnosis for the earlier failure.

`withAuditFileLock` now retries **only Windows EPERM during exclusive lock creation**, up to five attempts separated by 10, 20, 40 and 80 ms. Every attempt uses `wx`. It never deletes, replaces, inspects or steals an existing owner lock. EEXIST remains immediate contention, other errors remain errors, persistent EPERM retains its original code, and operations run only after ownership is acquired. Selection research now uses this same lock helper rather than a second uncoordinated implementation.

Five regressions cover transient denial, an existing owner discovered on retry, persistent denial, unrelated errors and operation-failure release. Fault injection verifies behavior; it is not a reproduction of Windows kernel sharing/deletion state. Eight repetitions of the existing real-child ownership/manual-writer tests passed (24 tests per repetition). The earlier zero-successor failure did not reproduce, so its cause remains open. Its assertion now records contender/owner PID and refusal reasons to make a recurrence diagnosable; the assertion and ownership protections were not relaxed.

A crash leaving an owner lock is still fail-closed. This repair does not add age-based takeover, foreign-host recovery, automatic lock deletion or a distributed lock service.

## Model-selection chronology

The preregistration/finalization pipeline still used permissive Date.parse while model inference already used strict source clocks. Date-only, unzoned and calendar-invalid inputs could therefore enter a selection trial or supply a result receipt.

Selection now uses the shared explicit-zone, real-calendar parser for plan periods, fitted-artifact availability, journal receipts and game identities. Equivalent explicit timezone offsets still normalize correctly. Finalization rechecks the stored plan digest and chronology, including registered-before-start, a minimum 14-day period and training-label availability before artifact/plan registration. Previously accepted malformed legacy plans fail closed without changing stored bytes or consuming outcomes; valid outer state hashes do not substitute for plan semantics.

The existing minimum 75 independent games/eight dates, disjoint trial periods, pinned artifact bytes, pending/disputed outcomes, consumed-game protection and no-automatic-promotion rules remain. Six added selection tests exercise invalid/legacy clocks, independent plan changes and a valid timezone-offset control.

This is research-protocol correctness, not proof of model superiority. Full registry report/plan/input/decision binding and adequate independent current-version forward validation remain unfinished. A 64-character hash string alone is not independent proof of a research claim. No champion was promoted and no historical study was rewritten.

## Injury and goalie data

An unrecognized ESPN injury report previously defaulted to **55% availability**. The substring `out` also matched `Workout scheduled`, assigning zero availability. Unknown reports now keep null availability with `unknown_reported_status`; recognized negative states retain their conservative heuristic values. Explicit Available/Healthy/Active assertions are represented as provider assertions, not medical verification. Two new tests cover unknown/missing/workout reports and known status controls, including provider underscore codes. This source interpretation change requires model identity v6.0.51 and fresh forward evidence.

The last actual free-source probe remains four NHL season goalie candidates, **zero confirmed starters**, and HTTP403 from the injury endpoint. This phase makes no new provider requests and does not claim those missing observations are recovered. Native season leaders remain context only. The [optional preferred-provider snapshot contract](SPORTS_GOALIE_INJURY_PROVIDERS.md) remains available; no external exporter/provider is connected. Existing free feeds and Odds API settings/credentials are unchanged. Odds coverage is not assumed to supply injury or confirmed-starter data. Unknown health stays distinct from healthy.

## Verification

- Unchanged default-parallel baseline: 875 passed.
- Seven targeted tests fail against the previous lock/selection/injury source implementations, with originals restored afterward.
- Eight real-child ownership/manual-result repetitions: 24 passed each.
- Final focused command from `sports-bot`: `node --import ./test/setup.js --test test/audit-file-lock.test.js test/selection-protocol.test.js test/registry-availability.test.js test/auto-enrichment.test.js test/nhl-goalie-research.test.js test/availability-provider.test.js test/claim-ownership.test.js test/manual-result-history.test.js`: 97 passed.
- Final full parallel suite: **888 passed** in each of two consecutive runs, zero failed/skipped. Root `npm run check` and `git -c core.whitespace=cr-at-eol diff --check` passed. Thirteen tests were added in this phase.

The first focused run had one new control-fixture mismatch (ISO `.000Z` normalization); the assertion was corrected to compare canonical instants. No production behavior was changed to satisfy that formatting assertion. The previously logged parallel failures remain preserved privately.

## Remaining sequence

Sports remains incomplete: diagnose any recurrence of zero-successor recovery; bind registry activation to independently verified complete selection evidence; obtain lawful current injury/confirmed-goalie observations or retain explicit missing coverage; collect adequate current-version prospective cohorts; and verify operational behavior before any authorized startup/deployment. Existing frozen v6.0.45 studies are descriptive and cannot validate v6.0.51.

Crypto follows completed Sports, then Stocks. Live trading stays disabled. No credentials, production state, purchases, orders, model promotion, merge or deployment changed. The Stocks market-session automation remains active and byte-identical (SHA256 `50afc20dc2c1f4fc00c5634eb4c850907075da433b78b9146d5c5a1152e5d731`); its market-session completion is not inferred from its saved active status. cPanel remains excluded.
