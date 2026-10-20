# Frozen pregame records and fair comparisons

The v6.0.1 development changes preserve the old source in `baseline/pre-readme-sports-audit-2026-10-20`. The baseline is an observation point, not a claim of previous profitability. Save private runtime data before upgrading; the Git tag intentionally excludes credentials and runtime files.

## Records written by the repaired bot

`prediction-journal.jsonl` lives in the actual Sports data directory (`OMNIMOD_SPORTS_DATA_DIR`, the Windows project data folder, or the documented Linux home default). It is ignored by Git. It can contain private guild identifiers and should be backed up privately.

Every computed pregame forecast is recorded before publication, including lower-confidence/withheld forecasts. A record retains:

- Game/league identity, model version, forecast horizon/stage and prediction/start timestamps.
- The chosen side, its probability, the complete outcome percentage vector and recommendation status.
- Available bookmaker prices, bookmaker identifiers, price timestamps and timestamp provenance; unavailable prices remain unavailable. Each side retains up to 100 offered quotes and an explicit truncation count/flag.
- Source-fetch timestamps and cache states for schedules, summaries and history. These are receipt times, not a guarantee that the underlying injury/lineup fact was newly updated.
- Candidate model vectors and captured Elo/available consensus reference vectors, plus selected confidence/uncertainty fields.
- An observation timestamp and eligibility classification. A forecast first encountered after kickoff, or with unverified timing/version/probabilities, is an `unverifiable_observation`, not a prospective prediction.

The journal attests that the bot computed and stored a forecast. **It does not attest Discord delivery.** A computed forecast that failed delivery must not be presented as a timely public alert or a wager someone could place.

On a valid final, a separate result record links to every original forecast horizon/version for that event. It stores scores, actual outcome, whether the original side matched, and first-observed/result-source times. Corrections append revisions. Issued probabilities and prices are never rewritten. Finals are saved before Discord final-result delivery; delivery failure cannot erase the observation.

`FEATURE_WAREHOUSE_ENABLED=false` disables optional warehouse work, not this journal. The warehouse remains a compact bounded feature store; its issued snapshots now retain model identity and stay immutable. Legacy rows without their original model/version/timing remain unverified. The journal does not retroactively certify them.

## Inspect the evidence

From the repository root:

```sh
npm --prefix sports-bot run audit:predictions
```

This reads local records, verifies their digest chain, and prints aggregate counts and versioned scores. It makes no provider/Discord request. With no prospective records, it reports that absence rather than claiming zero losses or a profitable model.

The report separates unresolved forecasts, graded outcomes and unavailable odds. It reports full-outcome Brier/log loss separately from selected-outcome binary scores. Horizon populations are correlated; overall full-outcome scores use one latest forecast per game for the selected model version. Captured reference comparisons use the same matched games. The Elo reference is a simple fixed-draw-prior comparator, not the complete old v6.0.0 pipeline. Available market consensus can be stale or included in the production model, so agreement is not independent edge evidence. Bootstrap intervals are descriptive game-IID intervals, not proof of independent sessions or robust generalization.

No simulated betting return is asserted from forecast accuracy alone. A valid betting replay also needs an offered historical price, settlement scope, achievable timing, fees/limits/voids and an explicit staking/execution policy. A correct forecast is not necessarily a positive expected-value bet.

## Durability and recovery

The writer appends under an exclusive owner lock and syncs records. Each event has a sequence, previous hash and event hash. These detect accidental editing/torn records; they are not cryptographic signatures against an attacker rewriting the whole journal. Concurrent processes cannot safely replace a lock. A hard crash can leave a lock: stop/verify the owning PID and host, preserve both files, validate the journal and investigate before removing a confirmed inactive lock. There is no automatic destructive unlock or silent repair.

A malformed, edited or torn journal fails visibly and blocks new writes. Preserve the exact file for recovery; never delete it to obtain clean-looking statistics. Back up the journal and warehouse privately. The current implementation verifies the full journal during each write; measure storage/latency before very large retention, and use an evidence-preserving rotation/index design if volume requires it.

## Pregame refresh and results

T-90/T-30/T-10 completion now requires a network/revalidated summary obtained during the attempt and a new pregame forecast. It preserves earlier completion markers. Stale fallback/failed fetches remain pending, and failed Discord refresh delivery is retried separately. This establishes source retrieval, not confirmation that every starter or injury is known.

Unresolved prior-date games are revisited after midnight within `FINAL_LOOKBACK_DAYS` (default 7, configurable 1–30). Older unresolved events remain unresolved; inspect/reconcile them manually rather than assuming a loss/win. A previously observed final with failed delivery can still be posted. Different upstream IDs matched to a cached event retain the cache's canonical identity for grading.

## Compare changes honestly

1. Keep the baseline tag and private archived data unchanged. Record the repair commit and model version.
2. Predeclare evaluation dates, leagues, model/horizon and cost/settlement assumptions before examining outcomes.
3. Collect new forecasts before kickoff. Do not manufacture pregame odds or source timestamps from later finals.
4. Compare the same eligible games and the same information sets. Separate versions, horizons, replay data and prospective records. Do not count multiple guild/horizon snapshots as independent extra games.
5. Report sample size, unresolved rows, proper scores, calibration, league/confidence slices, draw/void handling and market-baseline availability. Account for day/league dependence; a few wins are not validation.
6. New challenger promotion requires versioned prospective records. Old replay/legacy data can inform research but cannot alone certify a production promotion. Label availability before the ML holdout is checked.

The local evidence available in this audit contains one dated slate, only five graded warehouse rows, no warehouse model-version identifiers and no market snapshots. It cannot establish the reported historical deterioration or a before/after win-rate improvement. See [the technical audit](SPORTS_ACCURACY_AUDIT.md) for confirmed code defects and outstanding validation.
