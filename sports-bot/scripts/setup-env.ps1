$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"

function Read-PlainSecret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

$discordToken = Read-PlainSecret "Discord bot token"
$oddsKey = Read-PlainSecret "The Odds API key (optional; press Enter to skip)"
$guildId = Read-Host "Discord guild/server ID (optional)"
$channelId = Read-Host "Sports channel ID (optional)"
$resultsChannelId = Read-Host "Sports results channel ID (optional)"
$logChannelId = Read-Host "Sports admin logs channel ID (optional)"
$roleId = Read-Host "Sports notify role ID (optional)"

$lines = @(
    "DISCORD_TOKEN=$discordToken",
    "DISCORD_CLIENT_ID=1522283367767212255",
    "DISCORD_GUILD_ID=$guildId",
    "SPORTS_CHANNEL_ID=$channelId",
    "SPORTS_RESULTS_CHANNEL_ID=$resultsChannelId",
    "SPORTS_LOG_CHANNEL_ID=$logChannelId",
    "SPORTS_NOTIFY_ROLE_ID=$roleId",
    "ODDS_API_KEY=$oddsKey",
    "ODDS_API_REGION=us",
    "TIMEZONE=America/Chicago",
    "DAILY_POST_HOUR=8",
    "DAILY_POST_MINUTE=0",
    "POST_ON_START=true",
    "FINAL_CHECK_MINUTES=10",
    "REGISTER_COMMANDS=true",
    "MAX_GAMES_PER_POST=75",
    "MAX_LEAGUES_PER_REFRESH=24",
    "LOCAL_ONLY=false",
    "SCOREBOARD_CACHE_MINUTES=10",
    "SCOREBOARD_STALE_HOURS=48",
    "ODDS_CACHE_HOURS=6",
    "PREDICTION_HISTORY_DAYS=365",
    "AUTO_ENRICH_ENABLED=true",
    "AUTO_SUMMARY_MAX_GAMES=24",
    "AUTO_SUMMARY_CACHE_MINUTES=180",
    "AUTO_HISTORY_MAX_LEAGUES=10",
    "AUTO_HISTORY_CACHE_HOURS=12",
    "AUTO_HISTORY_MAX_DAYS=365",
    "AUTO_BOXSCORE_MAX_EVENTS=36",
    "AUTO_BOXSCORE_CACHE_DAYS=30",
    "AUTO_OFFICIAL_SOURCES=true",
    "AUTO_LEARNING_ENABLED=true",
    "AUTO_LEARNING_MIN_SAMPLES=30",
    "DRIFT_RECENT_SAMPLES=30"
)

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8
Write-Host "Wrote $envPath"
Write-Host "Secrets are stored locally and ignored by git."
