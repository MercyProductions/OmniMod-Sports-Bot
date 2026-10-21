# Pinned upcoming-day research and first real pregame pairs

## Implemented

New isolated studies can declare `--day-offset=1` at preparation to collect tomorrow's local-date slate. Default zero preserves current-date sampling. Only zero/one are supported, and the value/timezone are frozen in the hashed study manifest. Existing studies and archived versions are not silently modified. Collection reads the pinned setting rather than a runtime day override. Midnight/daylight-saving calendar handling targets the next Chicago calendar date rather than treating a forecast's information time as tomorrow.

```powershell
npm --prefix sports-bot run research:prospective -- --action=prepare --directory=C:/private/sports-upcoming --repository=C:/repos/OmniMod-Sports-Bot --baseline=baseline/pre-readme-sports-audit-2026-10-20 --challenger=REVIEWED_COMMIT --day-offset=1
npm --prefix sports-bot run research:prospective -- --action=collect --directory=C:/private/sports-upcoming --data=live
npm --prefix sports-bot run research:prospective -- --action=report --directory=C:/private/sports-upcoming
```

The offset is a rolling sampling policy. On a later local date, offset one collects that later date's following slate; it does not reinterpret earlier forecasts. Original games remain available to bounded final reconciliation using their own recorded dates. No continuous collector or follow-up automation was started.

Captures record the offset and actual target date. Receipt loading rejects an offset inconsistent with the study manifest. Issuance and receipt times remain real collection times; the target game date does not move the inference information cutoff forward. Earlier model versions retain their own archived behavior and are not rewritten into the repaired algorithm.

## Actual live evidence

A separate isolated study used:

- Baseline `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`, model v6.0.0.
- Challenger `d73fd5f0c097c5c0cfa57f48801dce505c415073`, model v6.0.7.
- The existing bounded four-league cold-start profile, no paid odds, advanced datasets, local ML, Discord or production state.

Collection occurred at **2026-10-21 04:25:12–04:25:14 UTC**. Each version selected two scheduled NHL games for local October 21, both starting **23:30 UTC**. Each generated two pregame forecasts before kickoff. Verified baseline/challenger receipts were **838 ms** apart, satisfying the two-minute pairing limit. The read-only report contains **two paired forecasts and two unresolved results**. Their original capture files, hashes and receipt chain are preserved privately outside Git.

Both versions had zero comparable calibration samples and both predictions remained `withheld`. These are genuine pregame research observations, not validated betting recommendations or qualified wagers. No outcomes were inferred from the schedule, no post-game predictions were manufactured, and no performance or profit claim follows from two pending games.

Schedule fallback behavior and provider access limitations persist: primary ESPN requests returned 403, NHL CDN returned 404, and official NHL schedule fallback supplied the two games. No broader market coverage, lineup completeness or successful history access is established. NBA/NFL/MLB provider events that did not match the target local date did not enter this slate.

## Verification

Previous checkpoint: 231 passing tests at `d73fd5f0c097c5c0cfa57f48801dce505c415073`. Current Sports suite: 232 passing, zero failures/skips; syntax and whitespace checks pass.

The added integration test archives both versions, pins tomorrow sampling, provides an explicitly synthetic offline tomorrow game, executes both workers and verifies actual issuance/cutoff times stay before the target event. It also verifies receipt loading and rejection of unsupported offsets. The separate live run above is actual market-schedule evidence; fixture outcomes are not used as performance evidence.

Production source/configuration/learner, Discord messages, paid services, live orders and promotions remain unchanged. Remaining Sports requirements include observing these and further games through final results, adequate prospective sample size, provider coverage, actual deployed-host inspection, nested input provenance and a complete requirement-to-evidence report. Crypto and Stocks remain queued afterward.
