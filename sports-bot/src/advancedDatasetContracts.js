import {finiteNumber} from './dataValidation.js';

export const SOURCE_PERIOD_FIELDS=Object.freeze({
 'baseball-savant-batter':'year','baseball-savant-pitcher':'year','nflverse-team-stats':'seasonStart',
 'nflverse-schedules':'minimumSeason','moneypuck-team-xg':'seasonStart','nba-advanced-teams':'seasonStart'
});

export function advancedDatasetRequest(options={}){
 const now=(options.clock||Date.now)();
 if(!Number.isFinite(now))throw new Error('Valid advanced dataset observation time required');
 const year=options.year===undefined?new Date(now).getUTCFullYear():Number(options.year);
 const seasonStart=options.seasonStart===undefined?(new Date(now).getUTCMonth()<8?year-1:year):Number(options.seasonStart);
 if(!Number.isInteger(year)||year<1000||year>9999)throw new Error('Invalid advanced dataset year');
 if(!Number.isInteger(seasonStart)||seasonStart<1000||seasonStart>9999)throw new Error('Invalid advanced dataset season');
 const supplied=options.sourcePeriods===undefined?{}:options.sourcePeriods,sourcePeriods={};
 if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))throw new Error('Invalid source period configuration');
 for(const [source,scope] of Object.entries(supplied)){
  if(!Object.hasOwn(SOURCE_PERIOD_FIELDS,source))throw new Error('Unknown source period selector');
  const field=SOURCE_PERIOD_FIELDS[source];
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).length!==1||!Object.hasOwn(scope,field))throw new Error('Invalid source period fields');
  const value=Number(scope[field]),minimum=field==='minimumSeason'?999:1000;
  if(!Number.isInteger(value)||value<minimum||value>9999)throw new Error('Invalid source period year or season');
  sourcePeriods[source]={[field]:value};
 }
 const requestIdentities={};
 for(const source of ['tennis-atp','tennis-wta','baseball-savant-batter','baseball-savant-pitcher','nflverse-team-stats',
  'nflverse-schedules','moneypuck-team-xg','nba-advanced-teams','statsbomb-open-data']){
  const scope={contract:'advanced-source-contract-v1',source};
  if(/^(tennis-|baseball-savant-)/.test(source))scope.year=year;
  if(source==='nflverse-team-stats')scope.recordContract='regular-season-team-summary-v1';
  if(['nflverse-team-stats','moneypuck-team-xg','nba-advanced-teams'].includes(source))scope.seasonStart=seasonStart;
  if(source==='nflverse-schedules')scope.minimumSeason=seasonStart-1;
  Object.assign(scope,sourcePeriods[source]||{});
  requestIdentities[source]=JSON.stringify(scope);
 }
 return {now,year,seasonStart,sourcePeriods,requestIdentities};
}

export const nonemptyText=value=>typeof value==='string'&&Boolean(value.trim());
export function calendarDay(value){
 const raw=String(value||'').trim();
 const day=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:raw;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const time=Date.parse(day+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day?day:null;
}

/** Validate the implemented adapter contract, not an external provider entitlement or full domain schema. */
export function checkedDatasetRows(rows,{source,keys=[],features=[],identity=()=>true}={}){
 if(!Array.isArray(rows)||!rows.length)throw new Error(`Advanced source ${source}: no usable observations`);
 const columns=new Set(rows.flatMap(row=>row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row):[]));
 if(keys.some(group=>!group.some(key=>columns.has(key))))throw new Error(`Advanced source ${source}: unsupported payload schema`);
 const accepted=rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&identity(row));
 if(!accepted.length||features.length&&!accepted.some(row=>features.some(key=>finiteNumber(row[key])!==null)))
  throw new Error(`Advanced source ${source}: no usable observations`);
 return {rows:accepted,rejectedRows:rows.length-accepted.length};
}

/** The REG endpoint is one season-summary record per team, never weekly observations. */
export function checkedNflSeasonRows(rows,seasonStart){
 const parsed=checkedDatasetRows(rows,{source:'nflverse-team-stats',
  keys:[['season'],['season_type'],['team'],['games'],['passing_epa','rushing_epa','passing_cpoe']],
  features:['passing_epa','rushing_epa','passing_cpoe'],identity:row=>nonemptyText(row.team)});
 const teams=new Set();
 for(const row of parsed.rows){
  const key=row.team.trim().toUpperCase();
  if(finiteNumber(row.season)!==seasonStart||String(row.season_type).trim().toUpperCase()!=='REG'
   ||nonemptyText(row.week)||teams.has(key))throw new Error('Advanced source nflverse-team-stats: conflicting season-summary identity');
  teams.add(key);
 }
 return parsed;
}


/** Compare NFL season-year assertions without guessing other leagues' start/end-year conventions. */
export function nflGameSeasonEvidence(game={},rows=[]){
 const year=value=>{const number=finiteNumber(value);return Number.isInteger(number)&&number>=1000&&number<=9999?number:null;};
 const present=value=>value!==undefined&&value!==null&&value!=='';
 let sourceConflict=false;
 const sourceEvidence=rows.map(row=>{
  let requested=null;
  try{
   const key=JSON.parse(row?.sourceRequestKey||'null');
   if(key?.source==='nflverse-team-stats'&&key.recordContract==='regular-season-team-summary-v1')requested=year(key.seasonStart);
  }catch{}
  const native=year(row?.season);
  if(present(row?.season)&&(native===null||requested!==null&&native!==requested))sourceConflict=true;
  return {season:native??requested,basis:native!==null?'native_row_assertion':requested!==null?'validated_request_contract':'unknown'};
 });
 const gameSeason=year(game.seasonYear),sourceSeasons=sourceEvidence.map(row=>row.season);
 const state=sourceConflict?'source_season_conflict':present(game.seasonYear)&&gameSeason===null?'game_season_invalid':gameSeason===null?'game_season_unknown'
  :sourceSeasons.length!==2||sourceSeasons.some(value=>value===null)?'source_season_unknown':sourceSeasons.some(value=>value!==gameSeason)?'season_mismatch':'matched';
 return {sourceId:'nflverse-team-stats',gameSeason,sourceSeasons,sourceEvidence,state,
  blocked:['source_season_conflict','game_season_invalid','source_season_unknown','season_mismatch'].includes(state),
  nativePublicationVerified:false};
}


/** NHL official composite IDs are observed in stored captures; other providers' four-digit conventions remain unmapped. */
export function nhlGameSeasonEvidence(game={},rows=[]){
 const raw=String(game.seasonYear??'').trim();
 const provided=raw!=='';
 const start=/^\d{8}$/.test(raw)?Number(raw.slice(0,4)):null;
 const end=/^\d{8}$/.test(raw)?Number(raw.slice(4)):null;
 const gameSeason=start!==null&&start>=1000&&end===start+1?start:null;
 const sourceSeasons=rows.map(row=>{
  try{
   const key=JSON.parse(row?.sourceRequestKey||'null'),season=finiteNumber(key?.seasonStart);
   return key?.source==='moneypuck-team-xg'&&Number.isInteger(season)&&season>=1000&&season<=9999?season:null;
  }catch{return null;}
 });
 const state=!provided?'game_season_unknown':/^\d{4}$/.test(raw)?'game_season_convention_unverified':gameSeason===null?'game_season_invalid'
  :sourceSeasons.length!==2||sourceSeasons.some(value=>value===null)?'source_season_unknown'
  :sourceSeasons.some(value=>value!==gameSeason)?'season_mismatch':'request_season_matched_native_unverified';
 return {sourceId:'moneypuck-team-xg',gameSeason,sourceSeasons,state,
  sourceEvidence:sourceSeasons.map(season=>({season,basis:season===null?'unknown':'request_scope_only'})),
  blocked:['game_season_convention_unverified','game_season_invalid','source_season_unknown','season_mismatch'].includes(state),
  nativePeriodVerified:false,nativePublicationVerified:false};
}


const calendarYear=value=>{const number=finiteNumber(value);return Number.isInteger(number)&&number>=1000&&number<=9999?number:null;};
const provided=value=>value!==undefined&&value!==null&&value!=='';

/** A request URL is a scope assertion, not proof of native publication or revision lineage. */
export function checkedBaseballSeasonRows(rows,year,role){
 const parsed=checkedDatasetRows(rows,{source:`baseball-savant-${role}`,
  keys:[['last_name, first_name','player_name'],['est_ba','est_slg','est_woba']],features:['est_ba','est_slg','est_woba'],
  identity:row=>nonemptyText(row['last_name, first_name']||row.player_name)});
 for(const row of parsed.rows)for(const field of ['year','season']){
  if(provided(row[field])&&String(row[field]).trim()&&calendarYear(row[field])!==year)throw new Error(`Advanced source baseball-savant-${role}: conflicting native year assertion`);
 }
 return parsed;
}

export function mlbGameSeasonEvidence(game={},rows=[]){
 let sourceConflict=false;
 const sourceEvidence=rows.map(row=>{
  let requested=null;
  try{const key=JSON.parse(row?.sourceRequestKey||'null');if(key?.source==='baseball-savant-batter')requested=calendarYear(key.year);}catch{}
  const native=calendarYear(row?.seasonYear);
  if(provided(row?.seasonYear)&&(native===null||requested!==null&&native!==requested))sourceConflict=true;
  return {season:native??requested,basis:native!==null?'native_row_assertion':requested!==null?'request_scope_only':'unknown'};
 });
 const gameSeason=calendarYear(game.seasonYear),sourceSeasons=sourceEvidence.map(row=>row.season);
 const state=sourceConflict?'source_season_conflict':provided(game.seasonYear)&&gameSeason===null?'game_season_invalid':gameSeason===null?'game_season_unknown'
  :!rows.length||sourceSeasons.some(value=>value===null)?'source_season_unknown':sourceSeasons.some(value=>value!==gameSeason)?'season_mismatch'
  :sourceEvidence.every(row=>row.basis==='native_row_assertion')?'matched':'request_season_matched_native_unverified';
 return {sourceId:'baseball-savant-batter',gameSeason,sourceSeasons,sourceEvidence,state,
  blocked:['source_season_conflict','game_season_invalid','source_season_unknown','season_mismatch'].includes(state),
  nativePeriodVerified:state==='matched',nativePublicationVerified:false};
}
