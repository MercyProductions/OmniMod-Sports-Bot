# Configuration reference

Generated from `sports-bot/.env.example`. Copy the template, never another person's `.env`. Template defaults are starting settings, not account/risk recommendations. Read its comments and source before changing a safety control.

| Variable | Template default | Role |
| --- | --- | --- |
| `DISCORD_TOKEN` | your own value; optional when its source is disabled | Private credential from your own account/application. |
| `DISCORD_CLIENT_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `DISCORD_GUILD_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `SPORTS_CHANNEL_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `SPORTS_RESULTS_CHANNEL_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `SPORTS_LOG_CHANNEL_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `SPORTS_NOTIFY_ROLE_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `SPORTS_ADMIN_ROLE_ID` | your own value; optional when its source is disabled | Your own server/application/account identifier. |
| `ODDS_API_KEY` | your own value; optional when its source is disabled | Private credential from your own account/application. |
| `ODDS_API_REGION` | us | Runtime, data-source, cost, review or safety setting; see template comments. |
| `TIMEZONE` | America/Chicago | Runtime, data-source, cost, review or safety setting; see template comments. |
| `DAILY_POST_HOUR` | 8 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `DAILY_POST_MINUTE` | 0 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `POST_ON_START` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `FINAL_CHECK_MINUTES` | 10 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `FINAL_LOOKBACK_DAYS` | 7 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `REGISTER_COMMANDS` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `MAX_GAMES_PER_POST` | 75 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `MAX_LEAGUES_PER_REFRESH` | 24 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `LOCAL_ONLY` | false | Runtime, data-source, cost, review or safety setting; see template comments. |
| `SCOREBOARD_CACHE_MINUTES` | 10 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `SCOREBOARD_STALE_HOURS` | 48 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `ODDS_CACHE_HOURS` | 6 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `SPORTS_VALUE_REFRESH_DAILY_CAP` | 0 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `SPORTS_VALUE_REFRESH_COOLDOWN_MINUTES` | 5 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `PREDICTION_HISTORY_DAYS` | 365 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_ENRICH_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_SUMMARY_MAX_GAMES` | 24 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_SUMMARY_CACHE_MINUTES` | 180 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_HISTORY_MAX_LEAGUES` | 10 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_HISTORY_CACHE_HOURS` | 12 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_HISTORY_MAX_DAYS` | 365 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_BOXSCORE_MAX_EVENTS` | 36 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_BOXSCORE_CACHE_DAYS` | 30 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_OFFICIAL_SOURCES` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_LEARNING_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `AUTO_LEARNING_MIN_SAMPLES` | 30 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `DRIFT_RECENT_SAMPLES` | 30 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `PREGAME_REFRESH_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `PREGAME_REFRESH_WINDOWS` | 90,30,10 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `FEATURE_WAREHOUSE_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `HISTORICAL_REPLAY_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `HISTORICAL_REPLAY_MAX_ROWS` | 8000 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `CHALLENGER_MIN_SAMPLES` | 75 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `LOCAL_ML_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `LOCAL_ML_MIN_SAMPLES` | 150 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `PLAY_BY_PLAY_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `HORIZON_EVALUATION_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `SOURCE_REDUNDANCY_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `ADVANCED_DATASETS_ENABLED` | true | Runtime, data-source, cost, review or safety setting; see template comments. |
| `ADVANCED_DATASET_SYNC_DAYS` | 7 | Runtime, data-source, cost, review or safety setting; see template comments. |
| `ADVANCED_NBA_STATS_ENABLED` | false | Runtime, data-source, cost, review or safety setting; see template comments. |
