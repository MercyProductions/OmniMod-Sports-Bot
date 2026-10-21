import {normalizeEntityName} from './intelligenceStore.js';
import {finiteNumber} from './dataValidation.js';
import {isConfirmedStarter,reconcilePlayerEvidence,samePlayerIdentity} from './playerEvidence.js';

export function observationReceiptTimes(row, fallback=null){
 const times=[row?.updatedAt,row?.fetchedAt,row?.sourceFetchedAt,row?.observedAt,row?.sourceObservationAt,
  row?.sourceMeta?.fetchedAt,row?.sourceMeta?.sourceObservationAt,row?.environment?.fetchedAt,
  row?.environment?.sourceFetchedAt,row?.environment?.sourceObservationAt,...Object.values(row?.fetchedAtBySide||{})].filter(value=>value!==undefined&&value!==null&&value!=='');
 if(Array.isArray(row?.sourceReceiptTimes))times.push(...row.sourceReceiptTimes.map(value=>value||null));
 return times.length?times:[fallback||null];
}

/** Select current provider/manual starter assertions; matching a stat row never establishes lineup membership. */
export function selectMlbBatters(game,side){
 const team=game[side]||{},names=new Set([team.name,team.abbr,...(team.aliases||[])].filter(Boolean).map(normalizeEntityName));
 const belongs=row=>names.has(normalizeEntityName(row.team));
 const raw=(game.autoLineups||[]).filter(belongs);
 const availability=(game.autoPlayers||[]).filter(row=>belongs(row)&&raw.some(lineup=>samePlayerIdentity(lineup,row)));
 const reconciled=reconcilePlayerEvidence(raw,availability);
 const counts=new Map();
 for(const row of reconciled){const name=normalizeEntityName(row.name);if(name)counts.set(name,(counts.get(name)||0)+1);}
 const ambiguousNames=[...counts].filter(([,count])=>count>1).map(([name])=>name);
 const rejected={notConfirmed:0,pitcherWithoutBattingSlot:0,unverifiedBatterRole:0,ambiguousIdentity:0};
 const batters=reconciled.filter(row=>{
  if(!isConfirmedStarter(row)||row.active===false){rejected.notConfirmed++;return false;}
  if(ambiguousNames.includes(normalizeEntityName(row.name))){rejected.ambiguousIdentity++;return false;}
  const slot=finiteNumber(row.batOrder),hasSlot=Number.isInteger(slot)&&slot>0;
  if(/pitcher|\bsp\b|\brp\b/i.test(row.role||'')&&!hasSlot){rejected.pitcherWithoutBattingSlot++;return false;}
  if(!hasSlot&&!/batter|hitter|catcher|shortstop|baseman|fielder|\b(?:c|1b|2b|3b|ss|lf|cf|rf|dh)\b/i.test(row.role||'')){rejected.unverifiedBatterRole++;return false;}
  return Boolean(normalizeEntityName(row.name));
 });
 const slots=batters.map(row=>finiteNumber(row.batOrder)).filter(value=>Number.isInteger(value)&&value>0);
 const duplicateBattingSlots=[...new Set(slots.filter((value,index)=>slots.indexOf(value)!==index))];
 const fallback=game.autoEnrichment?.fetchedAt||null;
 const dependencyReceiptTimes=[...raw,...availability].flatMap(row=>observationReceiptTimes(row,row.source==='ESPN current event roster'||row.updatedBy==='automatic-enrichment'?fallback:null));
 if(game.autoEnrichment)dependencyReceiptTimes.push(...observationReceiptTimes(game.autoEnrichment));
 return {batters,dependencyReceiptTimes,evidence:{expectedBatters:9,confirmedBatters:batters.length,ambiguousNames,duplicateBattingSlots,rejected}};
}
