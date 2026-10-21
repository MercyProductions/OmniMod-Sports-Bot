import { advancedDatasetRequest, SOURCE_PERIOD_FIELDS, nhlGameSeasonEvidence } from './advancedDatasetContracts.js';
import { nbaGameSeasonEvidence } from './nbaDatasetEvidence.js';
import { finiteNumber } from './dataValidation.js';

const year=value=>{const n=finiteNumber(value);return Number.isInteger(n)&&n>=1000&&n<=9999?n:null;};

/** Choose one unambiguous period per source for a slate; never guess among conflicting game seasons. */
export function planSourceCollectionPeriods(games=[],options={}){
 const request=advancedDatasetRequest(options),sourcePeriods={...request.sourcePeriods},selection={},conflicts=[];
 const globalPin=options.year!==undefined||options.seasonStart!==undefined;
 const leagueSources={nfl:['nflverse-team-stats','nflverse-schedules'],nhl:['moneypuck-team-xg'],nba:['nba-advanced-teams'],mlb:['baseball-savant-batter','baseball-savant-pitcher']};
 for(const [league,sources] of Object.entries(leagueSources)){
  const observations=games.filter(game=>String(game.leagueKey||'').toLowerCase()===league).map(game=>({gameId:String(game.id||''),
   season:league==='nba'?year(nbaGameSeasonEvidence(game).gameSeason):league==='nhl'?year(nhlGameSeasonEvidence(game).gameSeason):year(game.seasonYear)})).filter(row=>row.season!==null);
  const seasons=[...new Set(observations.map(row=>row.season))];
  for(const source of sources){
   const field=SOURCE_PERIOD_FIELDS[source],fallback=JSON.parse(request.requestIdentities[source])[field];
   let period=fallback,basis=Object.hasOwn(request.sourcePeriods,source)?'explicit_source_period':globalPin?'explicit_global_period':'calendar_fallback';
   if(!Object.hasOwn(request.sourcePeriods,source)&&!globalPin){
    if(seasons.length===1){period=seasons[0]-(field==='minimumSeason'?1:0);sourcePeriods[source]={[field]:period};basis='game_season_metadata';}
    else if(seasons.length>1){basis='conflicting_game_seasons';period=null;conflicts.push(source);}
   }
   selection[source]={field,period,basis,gameSeasons:seasons,gameIds:observations.map(row=>row.gameId)};
  }
 }
 return {options:{...options,sourcePeriods,collectionPeriodConflicts:conflicts},selection,conflicts};
}
