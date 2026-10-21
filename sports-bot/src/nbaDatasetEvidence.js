import { finiteNumber } from './dataValidation.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { checkedDatasetRows } from './advancedDatasetContracts.js';

const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const year=value=>{const n=finiteNumber(value);return Number.isInteger(n)&&n>=1000&&n<=9999?n:null;};
const seasonStart=label=>{
 const match=/^(\d{4})-(\d{2})$/.exec(String(label??''));
 return match&&Number(match[2])===(Number(match[1])+1)%100?year(match[1]):null;
};

export function checkedNbaTeamRows(rows,requestedSeason){
 const parsed=checkedDatasetRows(rows,{source:'nba-advanced-teams',keys:[['TEAM_NAME'],['PACE','NET_RATING','OFF_RATING','DEF_RATING']],
  features:['PACE','NET_RATING','OFF_RATING','DEF_RATING'],identity:row=>typeof row.TEAM_NAME==='string'&&Boolean(normalizeEntityName(row.TEAM_NAME))});
 const names=new Set(),ids=new Set();
 for(const row of parsed.rows){
  const name=normalizeEntityName(row.TEAM_NAME),id=present(row.TEAM_ID)?String(row.TEAM_ID).trim():null;
  if(names.has(name)||id!==null&&ids.has(id))throw new Error('Advanced source nba-advanced-teams: duplicate team identity');
  if(present(row.SEASON_YEAR)&&seasonStart(row.SEASON_YEAR)!==requestedSeason)throw new Error('Advanced source nba-advanced-teams: conflicting native season label');
  names.add(name);if(id!==null)ids.add(id);
 }
 return parsed;
}

/** ESPN's ending-year convention is observed in saved October 2026 NBA responses. */
export function nbaGameSeasonEvidence(game={},rows=[]){
 const raw=game.seasonYear,endingYear=year(raw),provider=String(game.sourceMeta?.provider||'');
 const mapped=['ESPN','ESPN CDN'].includes(provider),gameSeason=endingYear!==null&&mapped?endingYear-1:null;
 let conflict=false;
 const sourceEvidence=rows.map(row=>{
  let requested=null;
  try{const key=JSON.parse(row?.sourceRequestKey||'null');if(key?.source==='nba-advanced-teams')requested=year(key.seasonStart);}catch{}
  const native=seasonStart(row?.nativeSeasonLabel);
  if(present(row?.nativeSeasonLabel)&&(native===null||requested!==null&&native!==requested))conflict=true;
  return {season:native??requested,basis:native!==null?'native_row_assertion':requested!==null?'request_scope_only':'unknown'};
 });
 const sourceSeasons=sourceEvidence.map(row=>row.season);
 const state=conflict?'source_season_conflict':!present(raw)?'game_season_unknown':endingYear===null?'game_season_invalid':!mapped?'game_season_convention_unverified'
  :rows.length!==2||sourceSeasons.some(value=>value===null)?'source_season_unknown':sourceSeasons.some(value=>value!==gameSeason)?'season_mismatch'
  :sourceEvidence.every(row=>row.basis==='native_row_assertion')?'matched':'request_season_matched_native_unverified';
 return {sourceId:'nba-advanced-teams',gameSeason,provider,gameSeasonBasis:gameSeason===null?'unknown':'observed_espn_ending_year_convention',sourceSeasons,sourceEvidence,state,
  blocked:['source_season_conflict','game_season_invalid','game_season_convention_unverified','source_season_unknown','season_mismatch'].includes(state),
  nativePeriodVerified:state==='matched',nativePublicationVerified:false};
}

export function nbaTeamSampleEvidence(away,home){
 const measure=row=>{const games=finiteNumber(row?.games);return {games,positiveSample:Number.isInteger(games)&&games>0};};
 const a=away?.teamId,h=home?.teamId;
 const sharedTeamIdentity=Boolean(away&&home&&(away===home||present(a)&&present(h)&&String(a).trim()===String(h).trim()));
 return {away:measure(away),home:measure(home),sharedTeamIdentity,identityBasis:present(a)&&present(h)?'native_team_ids':'normalized_team_names_only',nativeIdentityMappingVerified:false,sampleAdequacyValidated:false};
}
