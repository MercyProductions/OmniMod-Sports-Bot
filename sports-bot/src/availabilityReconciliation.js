import {reconcilePlayerEvidence,samePlayerIdentity,isConfirmedStarter} from './playerEvidence.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {hasAvailabilityObservation,finiteNumber,explicitlyUnavailable} from './dataValidation.js';
import {applySummaryPlayerEvidence} from './summaryPlayerEvidence.js';
const samePlayer=(a,b)=>normalizeEntityName(a.team)===normalizeEntityName(b.team)&&samePlayerIdentity(a,b);
/** Materialized views retain original inputs so one provider cannot erase another source. */
export const availabilitySourceRows=rows=>rows.flatMap(row=>Array.isArray(row.availabilitySourceRows)?structuredClone(row.availabilitySourceRows):[row]);
export function reconcileAvailabilityRows(rows,availability=[]){
 const views=reconcilePlayerEvidence(rows,availability,{retainAvailabilitySources:true});
 for(const view of views){
  const inputs=[...rows,...availability].filter(row=>samePlayer(view,row));
  if(!inputs.some(row=>row.availabilityProvider)){applySummaryPlayerEvidence(view,inputs);continue;}
  const health=inputs.filter(hasAvailabilityObservation),numbers=health.map(row=>finiteNumber(row.availability)).filter(value=>value!==null);
  const denied=health.some(row=>row.active===false||explicitlyUnavailable(row)||finiteNumber(row.availability)===0);
  // A role-only report must never replace a negative or explicit health assertion.
  view.availability=denied?0:numbers.length?Math.min(...numbers):null;
  if(health.length)view.availabilityEvidence='reconciled_observed_assertions_not_medical_verification';
  view.availabilityConflict=Boolean(view.availabilityConflict||new Set(numbers).size>1);
  view.source=[...new Set(inputs.map(row=>row.source).filter(Boolean))].sort().join(' + ');
  applySummaryPlayerEvidence(view,inputs);
 }
 for(const team of new Set(views.map(row=>normalizeEntityName(row.team)))){
  const goalies=views.filter(row=>normalizeEntityName(row.team)===team&&/goalie|goaltender|\bg\b/i.test(row.role||'')&&isConfirmedStarter(row));
  if(goalies.length>1&&goalies.some(row=>row.availabilitySourceRows?.some(input=>input.availabilityProvider))){
   for(const row of goalies){row.confirmedStarter=false;row.starterEvidenceConflict=true;}
  }
 }
 for(const id of new Set(views.filter(row=>row.availabilitySourceRows).map(row=>row.sourceAthleteId))){
  const shared=views.filter(row=>row.sourceAthleteId===id);
  if(new Set(shared.map(row=>normalizeEntityName(row.team))).size>1)for(const row of shared){row.confirmedStarter=false;row.starterEvidenceConflict=true;}
 }
 return views;
}
