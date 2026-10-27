# Isolated cross-date final execution

## Implemented

The prospective runner now accepts `--action=reconcile`. It verifies the study and capture receipts, derives the bounded pending-final query plan, and executes one job for each selected source role/date through that role's archived `refreshFinalGrades` implementation. Original game and prediction records are supplied; the job does not run new inference.

```powershell
npm --prefix sports-bot run research:prospective -- --action=reconcile --directory=C:/private/sports-study --data=live
npm --prefix sports-bot run research:prospective -- --action=report --directory=C:/private/sports-study
```

As with collection, network access is an explicit `--data=live` choice. Without it, reconciliation is an offline rehearsal and cannot enter live-market scoring. Default query bounds remain seven days and at most three dates per role. Each worker retains its existing timeout and stripped credentials; the same study owner lock serializes collection and reconciliation.

Jobs are written as new private files with content hashes, role and pinned source commit. The worker rejects wrong filenames, changed bytes, mismatched roles/source pins, malformed dates or future job creation times before invoking the refresher. It reads/writes only its existing isolated configured state through the archived implementation. No production learner, paid odds key or Discord startup is used.

Result captures are explicitly `purpose: final_reconciliation`, get verified capture receipts, and cannot enter the forecast-selection loop. They can only contribute subsequently observed final games. Their original pregame probabilities and generation times remain unchanged. The summary reports zero new pregame forecasts for this operation. Missing or provider-rejected results remain pending; changed schedules cannot be joined to the original event identity by the paired evaluator.

The query planner now reopens both roles when their latest observed final scores disagree, rather than treating them as permanently resolved. A later agreeing observation can reconcile that conflict. This does not decide which original provider was correct or backdate a correction.

## Pinned worker compatibility

New study manifests declare `collect` and `reconcile` worker capabilities. Existing studies are not silently modified or upgraded. A non-empty reconciliation plan fails closed if its pinned worker lacks this capability. Preserve its evidence and prepare a compatible study with an explicitly reviewed migration procedure; do not replace its worker or rewrite its original capture receipts. An empty plan needs no worker and can truthfully return `no_pending_final_queries` for an older study.

## Verification

Previous checkpoint: 223 passing Sports tests at `c6d0239eb9e7a93e733b816d78d69191301c23b6`. Current full suite: 225 passing, zero failures/skips; configured syntax and whitespace checks pass.

The integration fixture archives both source versions and directly executes each pinned worker's prior-date refresh against explicit synthetic local results. It verifies final status/correctness, unchanged probability vectors and original generation times, the result-only purpose, zero new forecasts, and rejection of changed job hashes. Unit coverage verifies result-only captures cannot issue forecasts and conflicting finals remain queryable.

An early full-suite run rejected a capture chronology check; its focused rerun passed. A subsequent integration failure correctly rejected fixture results lacking recorded availability; the fixture was corrected with explicit availability, without weakening the learning gate. The final full suite passed, including a second full pass after adding altered-job rejection. No chronology gate was relaxed or timestamp invented to pass verification.

The actual existing private live study returned `no_pending_final_queries`, zero selected dates, zero captures and no provider calls, because it has no eligible pregame forecasts. This does not verify live final retrieval or actual forward grading. Its earlier captures and source pins remain unchanged.

Remaining Sports work: capture real pregame forecasts and follow their finals; resolve permitted provider coverage; verify deployed source/configuration/jobs; finish broader feature provenance and the requirement-to-evidence report; evaluate sufficient matched outcomes and realistic costs. No accuracy or profitability improvement is established. No deployment, Discord changes, paid requests, orders or model promotions occurred. Crypto and Stocks remain queued after Sports.
