# Prediction model and evaluation

OmniMod Evidence Ensemble v6.0 is a transparent, offline-first probabilistic framework. It is not a claim that any formula can perfectly model a sport. Baseball, basketball, football, hockey, soccer, tennis, and combat have separate specialist probability models in addition to separate priors, home advantage, volatility, season regression, player importance, draw behavior, feature weights, and maximum optional-market influence. Learned weights, specialist hybrids, and local machine-learning challengers are activated only after chronological out-of-sample validation.

## Pipeline

1. Load cached public schedules and merge local schedule overrides.
2. For active leagues, load a capped, cached historical-final window ending before prediction day.
3. Derive chronological Elo, offseason regression, shrunk team strength, iterative opponent adjustment, schedule strength, form, rest, congestion, recent head-to-head, and available box-score efficiency.
4. Load a balanced, capped set of immutable historical summaries. Derive player performance, starter rate, pair residuals, compact play-by-play efficiency, and observational official tendencies.
5. For selected upcoming games, load capped/cached summaries and extract injuries, current roster/lineup starters, probable pitchers, available officials/environment, compact play evidence, and a free line when exposed.
6. Project each player's availability and sport-specific workload from status, participation history, starter rate, and available minutes/snaps/plate-appearance/pitch evidence.
7. Corroborate supported MLB/NHL events with cached keyless official feeds and NFL events with the independently cached nflverse schedule dataset; record matches and conflicts.
8. Calculate travel distance, daylight-saving-aware time-zone change, altitude change, back-to-back/short-rest fatigue, schedule congestion, road streak, postseason context, and available critical-starter rest locally.
9. Load optional local teams, players, game contexts, manual results, and eligible frozen prediction history. Matching manual records override automatic records.
10. Build per-sport walk-forward feature models using only earlier predictions. Activate learned multipliers only when later holdout Brier score improves; otherwise retain fixed sport defaults.
11. Train a per-sport local gradient-boosted challenger from complete earlier feature snapshots with a fixed chronological holdout. Persist only models that pass sample, Brier, and log-loss gates.
12. Compare recent per-sport calibration/accuracy/Brier score with its older baseline and calculate a confidence penalty when drift is material.
13. Attach a durable paid odds snapshot only when the daily provider batch is explicitly claimed.
14. Create bounded sport-specific feature contributions and convert their sum to outcome probabilities. For draw sports, allocate an explicit draw prior adjusted for matchup parity.
15. Optionally blend bounded, de-vigged market evidence; multi-book consensus earns more weight than a single-book fallback.
16. Shrink thin evidence toward the sport prior, apply drift/transition penalties, and apply conservative local calibration only when a confidence bin has enough eligible history.
17. Run the specialist hybrid and local ML model in shadow. Use the persisted per-sport registry to select only a challenger that has beaten the evidence champion on the same chronological population.
18. Estimate an heuristic uncertainty band from sport volatility, sample size, evidence quality, model disagreement, market dispersion, projected participation, situational volatility, transition risk, feature agreement, and drift. Withhold the official pick when outcomes cannot be defensibly separated.
19. Publish separate Prediction, Prediction Uncertainty, API, Local Data, and Evidence values; freeze the complete compact feature state and grade it against later finals.
20. At T-90/T-30/T-10, force only the due event summary, append a market snapshot, update the existing Discord post, and never claim another paid odds batch.
21. When a result becomes final, grade every eligible stored horizon and report like-for-like performance by horizon, league, season phase, and favorite/underdog status.

## Sport specialist models

- Baseball: independent Poisson expected-runs distribution with offense/defense scoring history, probable starting-pitcher and bullpen availability, park/run context, and Baseball Savant lineup xwOBA when matched. Regulation ties are split as extra-inning win probability.
- Basketball: possession/pace and efficiency margin model with lineup value, turnover rate, and an empirically bounded score-margin distribution.
- Football: score-margin model using EPA, drive efficiency, quarterback and offensive-line availability, scoring history, and football-specific variance.
- Hockey: independent goal distribution using team xG/shot quality, MoneyPuck inputs when available, and goalie availability/GSAx evidence. Regulation ties are split as overtime/shootout probability.
- Soccer: three-way independent-Poisson score distribution using expected goals, shots/shot quality, and goalkeeper availability. Draw probability is produced by the score distribution rather than appended afterward.
- Tennis: two-way logistic model using surface Elo, serve points won, return points won, travel/fatigue, and the evidence-ensemble strength signal.
- Combat: two-way logistic model using opponent-adjusted strength, striking/grappling differentials, style matchup, form, and the evidence signal.

Each specialist produces a full outcome vector and optional expected score. The specialist challenger is a bounded hybrid, not an unrestricted replacement. The evidence ensemble remains champion until a specialist or local-ML challenger passes the registry's minimum sample, Brier, log-loss, and recent-stability gates.

## Feature warehouse and replay

The private feature warehouse stores deduplicated historical finals, immutable historical box summaries, bounded compact plays, player/lineup snapshots, frozen prediction candidates with complete compact input states, and timestamped market snapshots. It is bounded and atomically written, migrates older warehouse versions, and lets strict-local builds reuse evidence without a provider request.

Replay sorts finals chronologically and predicts before learning each result. Games with the same start timestamp are all predicted before any of those results are applied. Replay candidates and later frozen production candidates are scored with multiclass Brier score and log loss. A promoted specialist or ML challenger automatically rolls back to the evidence ensemble if a complete recent comparison window becomes materially worse.

## Prediction uncertainty and abstention

Prediction Confidence remains the selected outcome probability. Prediction Uncertainty is a separate heuristic uncertainty band (coverage not validated), displayed as plus/minus probability points. It widens for volatile sports, small samples, weak evidence, specialist/ensemble/ML disagreement, bookmaker dispersion, source conflicts, uncertain projected workload, unusual official/environment context, incomplete late critical lineups, season transitions, feature disagreement, and drift.

The output policy has three states: `prediction`, `lean_only`, and `withheld`. A withheld row keeps its leading outcome and full probability vector for transparent grading/calibration, but is not an official pick and cannot appear on strongest/value/low-risk/upset-pick boards.

## Core features

### Elo

All teams begin at 1500 unless a local seed is supplied. Automatically fetched history, imported results, and cached finals update both competitors chronologically. Duplicate results are removed before updating. The historical fetch ends before prediction day, so a final cannot leak into its own pregame prediction. The expected home result uses the standard logistic Elo relationship and a sport-specific home advantage. Neutral-site games remove it. The update rate responds to sport volatility and score margin but is capped to prevent one event from rewriting long-term strength.

### Bayesian record strength

Raw early-season win percentages are noisy. The engine shrinks records toward 50% with a prior sample, using a smaller prior for short football seasons. Ties count as half a win. Missing records remain neutral and lower evidence quality.

### Team, matchup, and form

Power, offense, defense, opponent-adjusted strength, advanced efficiency, schedule strength, and recent form are separate contributions. Automatic profiles derive them relative to teams in the same league, then shrink every value toward neutral based on sample size. Opponent adjustment iterates scoring-margin residuals against opponent ratings; schedule strength is the average adjusted strength faced. Available box scores add sport-specific possession/efficiency evidence, such as basketball scoring per estimated possession, football yards-per-play/third-down/turnover context, baseball baserunner/total-base context, hockey shots/power play, and soccer shots/xG when exposed. Missing statistics produce no contribution.

Win rate uses a Bayesian prior; recent form uses the latest ten results with its own prior. The offense-versus-defense term compares both sides symmetrically. A matching manual team profile takes precedence over the corresponding basic automatic ratings, while automatic opponent, advanced, transition, and chronological Elo evidence remain available to the ensemble.

Recent head-to-head uses at most six prior automatic results and strong Bayesian shrinkage. It is a small feature because repeated matchups are correlated with team strength and older meetings may involve different rosters.

### Players

Historical box scores learn each athlete's participation, statistical performance, starter rate, recent form, and role-sensitive value. The value is reliability-shrunk, so a one-game star cannot receive the same trust as a recurring high-participation starter. Event-summary injuries and probable starters are matched by provider athlete ID/name to the learned profile; unavailable impact therefore uses evidence-based value when history exists and a conservative role fallback otherwise.

Version 6 projects participation as a distribution instead of treating every status as a binary switch. Status-derived availability is combined with historical participation and starter rate, then converted into an expected sport-specific workload such as minutes, snaps, plate appearances, or pitches when the source exposes enough evidence. The availability contribution uses the expected workload share, while disagreement and missing history increase the uncertainty interval. These projections are assistance estimates, not claims about an official lineup.

Current roster/lineup rows are compared with each team's expected high-value starters. The lineup feature includes confirmed-side coverage, learned-player coverage, starter continuity, current value/form, and pair-level interaction evidence. Pair interaction is the historical result residual for two starters after removing their team's baseline, then heavily shrinking sparse pairs. It is a modest interaction term, not a claim of causal on/off value. A matching manual player record remains authoritative when it supplies a better status, role, value, or sport-specific statistic.

Important role examples:

- Baseball: starting pitcher, pitcher, closer, catcher.
- Basketball: starter, point guard, center, primary scorer.
- Football: quarterback, left tackle, edge, cornerback, kicker.
- Hockey: starting goalie, goalie, center, defenseman.
- Soccer: goalkeeper, striker, center back, playmaker.

Combat and tennis primarily model the competitors directly through team/entity ratings and context; separate player-roster influence is intentionally small.

### Situation

Rest and recent game counts are derived from historical finals. Historical probable-starter IDs/names are matched to today's pitcher, goalie, or quarterback when exposed, producing a days-since-last-start feature without another request. A built-in venue-city/time-zone table calculates approximate travel distance, daylight-saving-aware time-zone shift, and altitude change without a geocoder. Sport-specific congestion expectations convert games in the prior three/seven days and short rest into bounded fatigue. Road streak and postseason context are also automatic.

Available event weather, roof, surface, precipitation, wind direction, and officials are frozen with the prediction. Weather changes direction only when a relative weather-fit input exists; otherwise it raises uncertainty. Historical official effects are calculated relative to the league baseline, reliability-shrunk, and bounded because assignments are observational and may be confounded. Verified travel disruption and coaching-change fields are recognized separately from ordinary distance and team ratings. Manual context fields override matching automatic fields, while chemistry, detailed motivation, and matchup judgments remain optional.

### Season and roster transitions

At a season-year boundary, every league's Elo ratings regress toward 1500 by a sport-specific amount. Team profiles also shrink when the last game is separated by an offseason-like gap or when current competition type differs from the history window. Current-lineup learned coverage and continuity provide a roster-change signal: a lineup that cannot be matched to recent expected starters receives less lineup evidence. High transition risk prevents a prediction from receiving the lowest risk tier.

### Sport-specific walk-forward learning

Every frozen pregame prediction stores its unmodified feature contributions. For each sport, the learner processes games chronologically. It scores each later game using only weights learned from earlier games, then updates bounded multipliers after observing the result. The baseline and learned paths are compared on the same later-game population. Learned weights remain disabled unless the model has the configured training minimum, at least 20 walk-forward evaluation games, and a Brier improvement greater than 0.001. Accepted weights are still shrunk toward 1 and clamped, preventing automation from rewriting the ensemble after a small streak.

### Local machine-learning challenger

The local ML path is deliberately small and dependency-free: one per-sport gradient-boosted ensemble of bounded decision stumps with reliability-shrunk league intercepts. It learns from numerical feature vectors stored before the outcome, never from final-score fields. Training uses the oldest 70% of each chronological sport sample and evaluates once on the newest 30%; there is no random split that could mix future and past regimes. Minimum samples, Brier improvement, log-loss protection, comparable-population scoring, and recent rollback remain mandatory. Until those gates pass, ML appears only as a shadow candidate and cannot affect the public probability.

This design favors auditability and safe local retraining over a large black-box model. It also means adding more trustworthy, timestamped local history is more valuable than increasing tree count or model confidence.

### Drift monitoring

For each sport, the most recent complete window is compared with an earlier baseline on Brier score, expected calibration error, and accuracy. Insufficient samples produce no penalty. Material degradation creates a bounded penalty that lowers Evidence Quality and probability reliability; severe drift also prevents the lowest risk tier. This is deliberately asymmetric: recent improvement does not inflate confidence beyond the normal model.

### Live state

If a slate is first created after an event is live, the current score contributes with a sport-specific scale. The signal explicitly states that clock/period detail is not modeled. These predictions are higher risk and excluded from pregame calibration.

## Market consensus

For every bookmaker with a complete head-to-head market, raw American prices are converted to implied probabilities and divided by their sum. This removes that bookmaker's overround. Fair probabilities are aggregated by median, and disagreement becomes part of API Confidence.

Market influence is capped by sport, bookmaker count, dispersion, freshness, and API Confidence. A free line exposed by an event summary is de-vigged but treated as a one-book fallback with less confidence and a small blend. A paid multi-book snapshot may replace it. A single-book extreme probability above 88% is treated as unconfirmed context and cannot steer the ensemble. Odds may improve accuracy when they efficiently summarize public information, but the bot remains functional with no odds provider.

## Confidence separation

- Prediction Confidence is the calibrated probability of the selected outcome.
- API Confidence measures public schedule/history/box/lineup/injury/market completeness, freshness, and source agreement. ESPN-only evidence is capped at 88%. A matching independent MLB, NHL, or NFL schedule source can raise the cap to 96%, while start/status conflicts reduce the score. Only complete multi-book consensus can reach the top of the scale.
- Local Data Confidence measures only server-owned manual team/player/context coverage plus locally graded calibration history. Automatic enrichment cannot inflate it.
- Evidence Quality combines the two coverage channels and available records to control prior shrinkage and risk; it is not another win probability.

Spread and total lines are displayed as context only. Version 6 does not falsely advertise a winner model as a validated spread-cover or total model.

## Draws

Soccer begins with a draw prior near 26%. Close matchups increase it modestly; dominance reduces the remaining side balance. A complete three-way market may inform the draw estimate. Outcome probabilities always sum to approximately 100% after rounding.

## Calibration

Calibration operates on the displayed selected-outcome probability. It includes only predictions created in pregame mode and graded later. Each sport/confidence bin needs at least eight observations before any adjustment. A Bayesian prior centered on the original probability and a capped reliability weight prevent small samples from overreacting. Drift monitoring runs after evaluation and can only reduce trust; it cannot manufacture a higher probability.

Calibration is local to the bot's recorded history. An eight-game threshold only permits a tiny adjustment; it is not enough evidence to trust the band. Hundreds of comparable predictions are preferable.

## Metrics

- Accuracy: fraction of displayed picks that were correct.
- Average confidence: mean displayed selected-outcome probability.
- Brier score: mean squared error between probability and outcome. Lower is better.
- Log loss: negative log likelihood. It strongly penalizes confident misses. Lower is better.
- Expected calibration error: weighted absolute difference between confidence and observed accuracy in probability bins. Lower is better.
- Bootstrap 95% interval: deterministic resampling range for the reported metric; a wide interval warns that the sample is still inconclusive.
- Closing-probability edge: the model's probability for its displayed selected outcome minus the last stored pregame market probability for that same outcome. It is reported only when a comparable closing market snapshot exists and is not profit.

Metrics are grouped by T-90/T-30/T-10/daily horizon, league, season phase, and favorite/underdog side when the required fields exist. For a two-way baseline at 50%, the selected-outcome binary Brier score is 0.25. Comparisons must use the same event population, outcome representation, and prediction policy. A strong-looking accuracy on favorites can coexist with poor probability calibration.

## Leakage prevention

- pregame: eligible for evaluation and calibration.
- late_pregame: scheduled event whose listed start passed; may be graded but is excluded.
- in_play: score-aware, may be graded but is excluded from pregame evaluation.
- retrospective_ungraded: first seen after final; never graded as a model success.

The daily cache freezes model version, compact input state, ML feature vector, probabilities, snapshot stage, source context, and timestamps. Final refreshes update scores without recomputing the old pick and grade every eligible stored horizon. A manual recalculate updates only events that have not started; live/final events retain their original frozen prediction.

When rebuilding a historical date, the calibration, walk-forward learner, drift monitor, and cached-result Elo input are filtered to daily caches strictly earlier than that date. Historical provider windows end before prediction day, and current-game box scores/provider win-probability feeds are never pregame inputs. These rules block outcome, same-day, and future-weight leakage.

## Known limitations

- Provider records may be incomplete or use inconsistent formats.
- Public injury reports are not uniformly available across leagues, and a provider status can lag an official team announcement.
- Projected workloads estimate participation from available evidence; they cannot anticipate an undisclosed restriction, tactical substitution, ejection, or last-minute scratch.
- Compact play-by-play is retained prospectively and as historical summary caches refresh. Older cached games that never contained play data cannot be reconstructed without fetching or importing them again.
- Official tendencies, surface splits, and similar situational effects are observational and may reflect teams, venues, or assignments rather than a causal effect; shrinkage reduces but cannot remove that confounding.
- The local ML challenger needs a substantial body of complete, frozen, sport-comparable feature snapshots. Until then it remains inactive, and even a promoted model can degrade after rule, roster, or provider changes.
- Automatic player value is derived only when compatible historical box rows are exposed; sparse, missing, or cross-provider-incompatible statistics remain heavily shrunk.
- Starter-pair residuals are observational and can reflect substitutions, opponents, or coaching choices; they receive a small bounded influence and are not causal on/off estimates.
- Historical team aggregates are correlated with Elo and cannot capture every roster, coaching, or rule change; shrinkage limits but does not eliminate that risk.
- The generic live model lacks full clock, possession, period, and sport-specific win-probability state.
- Local subjective ratings can add bias or double-count public information.
- Multi-participant field events are not modeled as a full joint field; use head-to-head/manual competitor matchups.
- Current-game box scores and provider win-probability feeds are intentionally excluded from pregame automatic features to prevent leakage.
- Imported results improve Elo, opponent adjustment, and evaluation but cannot recreate historical player/lineup/context features that were not stored before the event.
- Free or paid market prices can still change between stored refresh windows; the warehouse records observed opening/current/T-10 snapshots, not every tick.
- No backtest can guarantee future performance under roster, rule, league, or provider changes.

The correct path to higher accuracy is better timestamped data, sport-specific validation, honest uncertainty, and continuous out-of-sample evaluation—not simply increasing displayed confidence.

## Review safeguards (September 2026)

- Missing scores remain unknown. Cancelled/suspended games and soccer finals marked as extra time or penalties are not graded as ordinary regulation results. Combat/tennis winner flags can establish the winner without comparable team scores.
- Odds require matching competitors and a start time within one hour. Ambiguous equal-time matches are rejected. Two-way and three-way markets are kept separate; duplicate bookmakers do not increase consensus size. Spread/total displays retain real offered point/price combinations.
- Markets explicitly marked stale, dated more than six hours ago, or dated more than five minutes in the future cannot steer the ensemble. This is a freshness guard, not a promise that a displayed price is currently executable. Legacy quotes without timestamps remain context of unknown age.
- Historical Elo excludes missing scores and missing Elo seeds; imported results respect the prediction-date cutoff. Horizon reports reject missing/post-start prediction timestamps and post-start closing snapshots.
- The uncertainty band is a heuristic sensitivity estimate. Its empirical coverage has not been validated, so it has no claimed confidence level. Positive model-versus-market disagreement is not a measured return after bookmaker margin, commissions, or execution costs.
- Corrupt persisted histories/settings fail closed rather than being replaced with empty tracking data. Restore a verified backup before resuming.

These fixes improve data integrity and evaluation correctness. They do not establish profitable betting performance, and the bot does not place wagers. Existing records that were already graded from incomplete or incorrectly matched data are not automatically rewritten by this review.

Provider reference: [The Odds API v4 documentation](https://the-odds-api.com/liveapi/guides/v4/) defines event start timestamps, bookmaker update times, and explicit American odds formatting used by the integration.

## Quoted value layer

For an American price `a`, net winning payout per unit is `a / 100` if positive, or `100 / abs(a)` if negative. With outcome probability `p`, modeled net return is `p * (1 + payout) - 1`, and break-even probability is `1 / (1 + payout)`. The stressed return substitutes `max(0, p - heuristicHalfWidth)` for `p`; it is not a statistical lower confidence bound.

`oddsValue.js` checks every outcome and selects the largest stressed return that clears all gates. Alternative bookmaker quotes are preserved so a stale attractive quote cannot displace a fresh offered price. An opportunity requires: a scheduled future event; normal-strength prediction; known compatible full-game two-way or regulation soccer three-way scope; at least two distinct fresh books; provider update timestamps no older than 15 minutes and not in the future; evidence >=65; selected-pick calibration >=40; at least 40 verified pregame observations in the sport/side/probability bin; bin calibration error <=0.10; nominal EV >=0.02; and stressed EV >0. Price/model gaps above 50% return are withheld for manual verification. Tennis retirement, combat draw/no-contest and football tie settlement are not modeled, so their quotes do not qualify.

The thresholds are conservative screening choices, not optimized or empirically proven profit thresholds. The side/probability-bin counts include unselected outcomes, with unknown/post-start timestamps excluded. Current probabilities may already include bookmaker inputs, so this is not an independent market-beating signal. Fetch-time-only fallback quotes and legacy unverified settlement scopes are withheld. A qualifying quote is still an observed research opportunity, not a confirmed tradable stake or guaranteed return.

Frozen warehouse rows preserve `valueAnalysis.outcomes`, `bestOpportunity`, `bestObserved`, quotes, probabilities, policy, evaluated time and withholding reasons alongside the eventual `actualSide`. Keep the original quote for forward evaluation; refreshing the Discord display rechecks its age without retroactively rewriting the archived observation. Multiple horizons for one game must not be treated as independent bets when measuring performance.

`valueAnalysis.issuedAt` identifies the original analysis time. Re-recording the same frozen prediction retains its original value analysis even if the supplied display analysis has since expired. Final grading adds `resolvedAt` with `resolvedAtSource: first_observed_final`; this is when the bot observed the final, not the exact event ending time. An event-level paper audit should choose its decision policy in advance (for example the first qualifying issued quote), count one outcome per event and keep hypothetical fills separate from actual wagers.

Explicit admin h2h refreshes create separately issued `snapshotStage: quote-refresh` / `quoteRefreshOnly: true` records. Their `predictionGeneratedAt` is the new quote-decision issuance time, and `modelAsOf` preserves the source model time. Source models must predate the request and be at most six hours old. They are not refitted using the refreshed quote; reusing forecasts prevents pretending new odds were known when the original model was issued. Quote-only rows are excluded from horizon forecast evaluation, selected-pick calibration, side/bin validation and warehouse candidate training.

The Odds API now documents market-level `last_update` as its observed market timestamp and deprecates bookmaker-level updates. Value opportunities therefore require market timestamps; bookmaker-only timestamps may remain model context but cannot establish a fresh tradable-price assumption. HTTP response freshness and modeled probability freshness are separate checks.
