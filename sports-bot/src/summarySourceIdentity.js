import {normalizeEntityName} from './intelligenceStore.js';
import {capturedEventTime} from './capturedEventTime.js';
import {finiteNumber} from './dataValidation.js';

/** Native IDs route to ESPN only when an explicit mapping or ESPN origin exists. */
export function espnSummaryEventId(row={}){
 if(row.espnEventId!==undefined)return /^\d+$/.test(String(row.espnEventId))?String(row.espnEventId):null;
 const id=String(row.id||''),origin=row.sourceMeta?.provider==='ESPN'||/ESPN/i.test(row.source||'')||id.startsWith('espn:');
 const candidate=id.replace(/^espn:/,'');return origin&&/^\d+$/.test(candidate)?candidate:null;
}
const identity=value=>value===undefined||value===null||value===''?null:
 (typeof value==='string'&&value.trim()&&value.length<=80||typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)?String(value).trim():false;
const teamOf=(subject,side)=>subject[side]||{id:subject[side+'TeamId'],name:subject[side+'Team'],abbr:subject[side+'Abbr']};
const espnOrigin=subject=>subject.sourceMeta?.provider==='ESPN'||/ESPN/i.test(subject.source||'')||String(subject.id||'').startsWith('espn:');

/** An exact native ID may canonicalize a display alias; an opposing known name is a conflict. */
export function summaryTeamBinding(team={},subject={}){
 const sourceId=identity(team?.id),sourceNames=[team?.displayName,team?.name,team?.abbreviation].map(normalizeEntityName).filter(Boolean);
 if(sourceId===false)return {side:null,reason:'invalid_team_id'};
 const teams=['away','home'].map(side=>({side,team:teamOf(subject,side)}));
 const byName=teams.filter(row=>[row.team?.name,row.team?.abbr,...(row.team?.aliases||[])].map(normalizeEntityName).filter(Boolean).some(name=>sourceNames.includes(name)));
 const knownIds=espnOrigin(subject)?teams.filter(row=>identity(row.team?.id)):[];
 const byId=sourceId?knownIds.filter(row=>identity(row.team.id)===sourceId):[];
 if(byId.length>1||byName.length>1)return {side:null,reason:'ambiguous_team_identity'};
 if(byId.length===1&&byName.length===1&&byId[0].side!==byName[0].side)return {side:null,reason:'team_id_name_conflict'};
 if(sourceId&&knownIds.length===2&&!byId.length)return {side:null,reason:'foreign_native_team_id'};
 const match=byId[0]||byName[0];
 if(match)return {side:match.side,teamName:match.team.name||match.team.abbr,quality:byId.length?'native_id_assertion':'name_assertion',reason:null};
 const expectedNames=teams.flatMap(row=>[row.team?.name,row.team?.abbr,...(row.team?.aliases||[])]).filter(Boolean);
 if(!expectedNames.length&&!knownIds.length)return {side:null,teamName:team?.displayName||team?.name||'',quality:'unverified_legacy',reason:null};
 return {side:null,reason:'team_not_matched'};
}

/** Inspect declared source identity; absence is partial evidence, never a verification certificate. */
export function inspectSummarySourceIdentity(summary,subject={},options={}){
 const reasons=[],observed={eventIds:[],startTimes:[]},checks={eventId:'not_reported',startTime:'not_reported',orderedTeams:'not_reported',season:'not_reported',league:'not_reported'};
 const finish=()=>({schema:'sports-summary-identity-v1',status:reasons.length?'conflict':checks.eventId==='matched'&&checks.startTime==='matched'&&checks.orderedTeams==='matched'?'matched_assertions':'partial',
  expectedEventId:espnSummaryEventId(subject),reasons:[...new Set(reasons)],checks,observed,independentlyVerified:false,publicationTimeVerified:false});
 if(!summary||typeof summary!=='object'||Array.isArray(summary)){reasons.push('invalid_summary_object');return finish();}
 const header=summary.header;
 if(header!==undefined&&(!header||typeof header!=='object'||Array.isArray(header))){reasons.push('invalid_header');return finish();}
 const competitions=header?.competitions;
 if(competitions!==undefined&&(!Array.isArray(competitions)||competitions.length>1)){reasons.push('ambiguous_or_invalid_competitions');return finish();}
 const competition=competitions?.[0];
 if(competition!==undefined&&(!competition||typeof competition!=='object'||Array.isArray(competition))){reasons.push('invalid_competition');return finish();}
 for(const value of [header?.id,competition?.id])if(value!==undefined&&value!==null&&value!==''){
  const id=identity(value);if(id===false){reasons.push('invalid_source_event_id');continue;}observed.eventIds.push(id);
 }
 const expected=espnSummaryEventId(subject);
 if(new Set(observed.eventIds).size>1||expected&&observed.eventIds.some(id=>id!==expected))reasons.push('event_id_mismatch');
 else if(expected&&observed.eventIds.length)checks.eventId='matched';
 else if(observed.eventIds.length)checks.eventId='expected_identity_unknown';
 const expectedStart=capturedEventTime(subject.startTime);
 for(const value of [header?.date,competition?.date])if(value!==undefined&&value!==null&&value!==''){
  const at=capturedEventTime(value);if(!Number.isFinite(at)){reasons.push('invalid_source_start');continue;}
  observed.startTimes.push(new Date(at).toISOString());if(Number.isFinite(expectedStart)&&at!==expectedStart)reasons.push('start_time_mismatch');
 }
 if(new Set(observed.startTimes).size>1)reasons.push('conflicting_source_starts');
 if(observed.startTimes.length)checks.startTime=Number.isFinite(expectedStart)?'matched':'expected_start_unknown';
 if(competition?.competitors!==undefined){
  if(!Array.isArray(competition.competitors))reasons.push('invalid_competitors');
  else{
   const matched=[];
   for(const side of ['away','home']){
    const rows=competition.competitors.filter(row=>row?.homeAway===side);if(rows.length>1){reasons.push('duplicate_competitor_side');continue;}
    if(!rows.length)continue;const binding=summaryTeamBinding(rows[0].team,subject);
    if(binding.reason||binding.side&&binding.side!==side)reasons.push('ordered_team_mismatch');else if(binding.side===side)matched.push(side);
   }
   if(matched.length===2)checks.orderedTeams='matched';else checks.orderedTeams='partial';
  }
 }
 for(const season of [header?.season,competition?.season])if(season!==undefined&&season!==null){
  if(typeof season!=='object'||Array.isArray(season)){reasons.push('invalid_season');continue;}
  for(const [key,expectedValue]of [['year',subject.seasonYear],['type',subject.seasonType]]){
   const raw=key==='type'&&typeof season.type==='object'?season.type?.id:season[key];if(raw===undefined||raw===null)continue;
   const value=finiteNumber(raw),target=finiteNumber(expectedValue);if(value===null||!Number.isInteger(value))reasons.push('invalid_season');
   else if(target!==null&&value!==target)reasons.push('season_mismatch');else checks.season=target===null?'expected_season_unknown':'matched';
  }
 }
 const sourceLeague=header?.league?.slug,expectedLeague=options.leagueRoute||subject.leagueKey;
 if(sourceLeague!==undefined){if(typeof sourceLeague!=='string'||!sourceLeague.trim())reasons.push('invalid_league');
  else if(expectedLeague&&sourceLeague.toLowerCase()!==String(expectedLeague).toLowerCase())reasons.push('league_mismatch');else checks.league=expectedLeague?'matched':'expected_league_unknown';}
 return finish();
}
