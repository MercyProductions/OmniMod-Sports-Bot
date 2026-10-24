import {capturedEventTime} from './capturedEventTime.js';
import {quoteTimeEpoch} from './oddsPricing.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {isConfirmedStarter} from './playerEvidence.js';
import {availabilitySourceRows} from './availabilityReconciliation.js';

const MAX_AGE=15*60000;
const nativeId=value=>/^[1-9]\d{0,11}$/.test(String(value||''));
const sides=['away','home'];
const teamIdentity=game=>Object.fromEntries(sides.map(side=>[side,{id:String(game[side]?.id||''),abbr:game[side]?.abbr||''}]));
const pitcher=role=>/starting pitcher|pitcher|\bsp\b/i.test(String(role||''));
const eventIdentity=game=>({id:String(game.id),leagueKey:game.leagueKey,startTime:game.startTime,seasonYear:game.seasonYear,seasonType:game.seasonType,...teamIdentity(game)});

/** Observed MLB contract only. A probable pitcher is neither a confirmed starter nor a health report. */
export function parseScoreboardStarterEvidence(event,game){
 if(game.leagueKey!=='mlb')return null;
 const competition=event.competitions?.[0],competitors=competition?.competitors;
 if(!Array.isArray(competitors)||!competitors.some(row=>row&&Object.hasOwn(row,'probables')))return null;
 const rejected={},reject=reason=>rejected[reason]=(rejected[reason]||0)+1,records=[];
 const evidence={schema:'sports-scoreboard-starters-v1',sourceEvent:eventIdentity(game),provider:'ESPN',fetchedAt:game.sourceMeta?.fetchedAt||null,
  cacheState:game.sourceMeta?.cacheState||'unknown',sourceObservationAt:null,nativePublicationVerified:false,reportedProbables:0,records,rejected,
  policy:'Provider-reported MLB projections only; no confirmed role, medical clearance, statistical sample or publication-time attestation.'};
 if(!nativeId(game.id)||String(event.id)!==String(game.id)||String(competition.id)!==String(game.id)
  ||competition.date&&capturedEventTime(competition.date)!==capturedEventTime(game.startTime)
  ||[event.status?.type,competition.status?.type].some(status=>status&&(status.completed===true||['in','post'].includes(status.state)))){reject('event_identity_or_status_conflict');return evidence;}
 for(const side of sides){
  const matching=competitors.filter(row=>row?.homeAway===side);
  if(matching.length!==1){reject('ambiguous_competitor_side');continue;}
  const competitor=matching[0],teamId=String(game[side]?.id||'');
  if(!nativeId(teamId)||String(competitor.team?.id)!==teamId||!game[side]?.abbr){reject('team_identity_unverified');continue;}
  if(competitor.probables===undefined)continue;
  if(!Array.isArray(competitor.probables)||competitor.probables.length>50){reject('invalid_or_unbounded_probables');continue;}
  evidence.reportedProbables+=competitor.probables.length;
  const candidates=new Map();
  for(const probable of competitor.probables){
   const athlete=probable?.athlete,id=athlete?.id??probable?.playerId,name=athlete?.displayName||athlete?.fullName;
   const position=typeof athlete?.position==='string'?athlete.position:athlete?.position?.abbreviation;
   if(probable?.name!=='probableStartingPitcher'||position!=='SP'){reject('unsupported_probable_role');continue;}
   if(!nativeId(id)||probable.playerId!==undefined&&String(probable.playerId)!==String(id)||typeof name!=='string'||!name.trim()||name.length>160){reject('invalid_or_conflicting_player_identity');continue;}
   if(athlete.team?.id!==undefined&&String(athlete.team.id)!==teamId){reject('athlete_team_conflict');continue;}
   const row={side,playerId:String(id),name:name.trim(),teamId,role:'Starting Pitcher'};
   if(candidates.has(row.playerId)&&candidates.get(row.playerId)?.name!==row.name){reject('conflicting_player_name');candidates.set(row.playerId,null);}
   else if(!candidates.has(row.playerId))candidates.set(row.playerId,row);
  }
  if(candidates.size>1){reject('conflicting_side_probables');continue;}
  records.push(...[...candidates.values()].filter(Boolean));
 }
 if(records.length===2&&records[0].playerId===records[1].playerId){records.length=0;reject('cross_team_player_identity_conflict');}
 return evidence;
}

export function scoreboardStarterState(evidence,game,now){
 if(!Number.isFinite(now))throw Error('Valid scoreboard starter information cutoff required');
 if(!evidence)return 'not_reported';
 if(evidence.schema!=='sports-scoreboard-starters-v1'||evidence.provider!=='ESPN'||!Array.isArray(evidence.records)||evidence.records.length>2)return 'invalid_evidence';
 if(evidence.rejected?.event_identity_or_status_conflict)return 'source_identity_conflict';
 const source=evidence.sourceEvent,start=capturedEventTime(game.startTime),receipt=quoteTimeEpoch(evidence.fetchedAt);
 if(game.leagueKey!=='mlb'||game.statusKey!=='scheduled'||!Number.isFinite(start)||now>=start)return 'not_eligible_pregame';
 if(!source||source.leagueKey!==game.leagueKey||source.id!==String(game.id)||capturedEventTime(source.startTime)!==start
  ||source.seasonYear!==game.seasonYear||source.seasonType!==game.seasonType
  ||sides.some(side=>!nativeId(game[side]?.id)||source[side]?.id!==String(game[side].id)||source[side]?.abbr!==game[side].abbr)
  ||String(game.away.id)===String(game.home.id))return 'event_or_team_binding_mismatch';
 if(!Number.isFinite(receipt)||receipt>now||now-receipt>=MAX_AGE||!['network','fresh','revalidated'].includes(evidence.cacheState))return 'receipt_stale_future_or_unverified';
 if(evidence.records.some(row=>!row||!sides.includes(row.side)||!nativeId(row.playerId)||row.teamId!==String(game[row.side]?.id)||typeof row.name!=='string'||!row.name.trim()||row.role!=='Starting Pitcher')
  ||new Set(evidence.records.map(row=>row.side)).size!==evidence.records.length||new Set(evidence.records.map(row=>row.playerId)).size!==evidence.records.length)return 'invalid_candidate_binding';
 return null;
}

/** Rechecked at inference as well as enrichment, including after a serialized restart. */
export function scoreboardStarterInputState(row,game,now){
 const evidence=game.scoreboardStarterEvidence,state=scoreboardStarterState(evidence,game,now);if(state)return state;
 const record=evidence.records.find(item=>item.playerId===String(row.sourceAthleteId)&&item.side===row.scoreboardSide);
 const expiry=Math.min(quoteTimeEpoch(evidence.fetchedAt)+MAX_AGE,capturedEventTime(game.startTime));
 if(!record||normalizeEntityName(row.team)!==normalizeEntityName(game[record.side].name||game[record.side].abbr)
  ||row.name!==record.name||quoteTimeEpoch(row.updatedAt)!==quoteTimeEpoch(evidence.fetchedAt)||quoteTimeEpoch(row.availabilityExpiresAt)!==expiry)return 'projection_source_binding_mismatch';
 return null;
}

export function applyScoreboardStarters(games,{now=Date.now()}={}){
 const result={games:0,projected:0,skipped:0,rejections:{}};
 const reject=reason=>result.rejections[reason]=(result.rejections[reason]||0)+1;
 for(const game of games){
  if(!game.scoreboardStarterEvidence)continue;
  // Replace this source's materialized projections only. Summary/injury/official records remain authoritative.
  const existing=(game.autoPlayers||[]).flatMap(row=>row.scoreboardProjection?availabilitySourceRows([row]).filter(input=>!input.scoreboardProjection):[row]),lineups=game.autoLineups||[];
  game.autoPlayers=existing;const state=scoreboardStarterState(game.scoreboardStarterEvidence,game,now);
  if(state){reject(state);continue;}
  result.games++;
  for(const record of game.scoreboardStarterEvidence.records){
   const team=game[record.side],rows=[...existing,...lineups].filter(row=>[team.name,team.abbr].filter(Boolean).some(name=>normalizeEntityName(name)===normalizeEntityName(row.team)));
   if(rows.some(row=>String(row.sourceAthleteId||row.athleteId||'')===record.playerId||normalizeEntityName(row.name)===normalizeEntityName(record.name)
    ||pitcher(row.role)&&(row.starter===true||isConfirmedStarter(row)))){result.skipped++;reject('existing_player_or_starter_evidence');continue;}
   game.autoPlayers.push({id:'scoreboard-probable-'+game.id+'-'+record.playerId,sourceAthleteId:record.playerId,playerIdNamespace:'espn',name:record.name,team:team.name||team.abbr,
    league:game.league,leagueKey:game.leagueKey,role:record.role,starter:true,confirmedStarter:false,confirmationStatus:'projected',availability:null,
    availabilityEvidence:'role_prior_not_injury_clearance',status:'Projected starter; health unknown',impact:6,form:50,stats:{},autoGenerated:true,
    scoreboardProjection:true,scoreboardSide:record.side,source:'ESPN scoreboard probable starter',updatedAt:game.scoreboardStarterEvidence.fetchedAt,
    availabilityExpiresAt:new Date(Math.min(quoteTimeEpoch(game.scoreboardStarterEvidence.fetchedAt)+MAX_AGE,capturedEventTime(game.startTime))).toISOString()});
   result.projected++;
  }
 }
 return result;
}

export function scoreboardStarterCoverage(game,now){
 const evidence=game.scoreboardStarterEvidence,state=scoreboardStarterState(evidence,game,now);
 return {status:state||'current_receipt_projected_only',fetchedAt:evidence?.fetchedAt||null,cacheState:evidence?.cacheState||'unknown',reportedProbables:evidence?.reportedProbables??null,
  retainedCandidates:evidence?.records?.length||0,usableCandidates:state?0:evidence.records.length,rejected:evidence?.rejected||{},confirmedStarters:0,injuryCoverage:'unknown',nativePublicationVerified:false};
}
