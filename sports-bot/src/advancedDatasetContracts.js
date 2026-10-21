import {finiteNumber} from './dataValidation.js';

export function advancedDatasetRequest(options={}){
 const now=(options.clock||Date.now)();
 if(!Number.isFinite(now))throw new Error('Valid advanced dataset observation time required');
 const year=options.year===undefined?new Date(now).getUTCFullYear():Number(options.year);
 const seasonStart=options.seasonStart===undefined?(new Date(now).getUTCMonth()<8?year-1:year):Number(options.seasonStart);
 if(!Number.isInteger(year)||year<1000||year>9999)throw new Error('Invalid advanced dataset year');
 if(!Number.isInteger(seasonStart)||seasonStart<1000||seasonStart>9999)throw new Error('Invalid advanced dataset season');
 const requestIdentities={};
 for(const source of ['tennis-atp','tennis-wta','baseball-savant-batter','baseball-savant-pitcher','nflverse-team-stats',
  'nflverse-schedules','moneypuck-team-xg','nba-advanced-teams','statsbomb-open-data']){
  const scope={contract:'advanced-source-contract-v1',source};
  if(/^(tennis-|baseball-savant-)/.test(source))scope.year=year;
  if(source==='nflverse-team-stats')scope.recordContract='regular-season-team-summary-v1';
  if(['nflverse-team-stats','moneypuck-team-xg','nba-advanced-teams'].includes(source))scope.seasonStart=seasonStart;
  if(source==='nflverse-schedules')scope.minimumSeason=seasonStart-1;
  requestIdentities[source]=JSON.stringify(scope);
 }
 return {now,year,seasonStart,requestIdentities};
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
