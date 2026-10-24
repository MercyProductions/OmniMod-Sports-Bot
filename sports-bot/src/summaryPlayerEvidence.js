import {sportProfile} from './sportProfiles.js';
import {availabilityFraction,hasAvailabilityObservation} from './dataValidation.js';

/** Existing automatic-impact coefficients, shared without retuning. */
export function automaticPlayerImpact(game,position,starter){
 const profile=sportProfile(game),role=String(position||'').toLowerCase();let impact=1.2;
 if(profile.key==='baseball')impact=/starting pitcher|\bsp\b/.test(role)?6:/pitcher|\brp\b|closer/.test(role)?2.2:/catcher|\bc\b/.test(role)?2:1.2;
 if(profile.key==='basketball')impact=2.3;
 if(profile.key==='football')impact=/quarterback|\bqb\b/.test(role)?6.5:/tackle|\bot\b|receiver|\bwr\b|running back|\brb\b|corner/.test(role)?2.4:1.5;
 if(profile.key==='hockey')impact=/goalie|goaltender|\bg\b/.test(role)?5.5:1.8;
 if(profile.key==='soccer')impact=/goalkeeper|\bgk\b/.test(role)?4.5:/forward|striker/.test(role)?2.8:1.8;
 if(profile.key==='tennis'||profile.key==='combat')impact=7;
 return Math.max(.5,Math.min(9,impact*(starter?1.35:1)));
}

function roleDescriptor(role,profile){
 const text=String(role||'').trim(),lower=text.toLowerCase();
 if(!text||/^(probable )?starter$|^player$/i.test(text))return null;
 if(profile==='baseball'){
  if(/starting pitcher|\bsp\b/.test(lower))return {key:'starter',family:'pitcher',canonical:'Starting Pitcher'};
  if(/relief|closer|bullpen|\brp\b/.test(lower))return {key:'relief',family:'pitcher',canonical:'Relief Pitcher'};
  if(/^(pitcher|p)$/.test(lower))return {key:null,family:'pitcher',canonical:'Pitcher'};
 }
 if(profile==='hockey'&&/goalie|goaltender|^g$/.test(lower))return {key:'goalie',family:'goalie',canonical:'Goalie'};
 if(profile==='football'&&/quarterback|^qb$/.test(lower))return {key:'quarterback',family:'quarterback',canonical:'Quarterback'};
 if(profile==='soccer'&&/goalkeeper|^gk$/.test(lower))return {key:'goalkeeper',family:'goalkeeper',canonical:'Goalkeeper'};
 return {key:null,family:'other',canonical:text};
}

/** Derive one player view while retaining independent original summary observations. */
export function applySummaryPlayerEvidence(view,inputs){
 const summary=inputs.filter(row=>row.summaryObservationType);if(!summary.length)return;
 const profile=sportProfile(view).key,roles=inputs.map(row=>({row,role:roleDescriptor(row.role,profile)})).filter(item=>item.role);
 const critical=[...new Set(roles.map(item=>item.role.key).filter(Boolean))],selected=critical.length===1?roles.find(item=>item.role.key===critical[0]):null;
 const conflict=critical.length>1||Boolean(selected&&roles.some(item=>item.role.family!==selected.role.family));
 const priority={injury:0,probable:1,roster:2};
 const ordered=[...inputs].sort((a,b)=>(priority[a.summaryObservationType]??3)-(priority[b.summaryObservationType]??3)||String(a.role||'').localeCompare(String(b.role||'')));
 view.role=conflict?'':selected?.role.canonical||ordered.map(row=>roleDescriptor(row.role,profile)?.canonical).find(Boolean)||'';
 view.starter=summary.some(row=>row.starter===true)||view.starter===true;
 if(conflict){view.confirmedStarter=false;view.starterEvidenceConflict=true;}
 view.confirmationStatus=view.confirmedStarter?'provider_roster_starter':conflict?'conflicting_role_reports':view.starter?'projected':'not_confirmed';
 view.summaryRoleEvidence={status:conflict?'conflict':view.role?'reported':'unknown',selectedRole:view.role||null,
  observations:roles.map(({row})=>({kind:row.summaryObservationType||(row.availabilityProvider?'provider':'independent'),role:row.role,source:row.source||null,updatedAt:row.updatedAt||null})),publicationVerified:false};
 view.impact=automaticPlayerImpact(view,view.role,view.starter);
 const stats={},conflicts=new Set();
 for(const row of inputs)for(const [key,value]of Object.entries(row.stats||{})){
  if(Object.hasOwn(stats,key)&&stats[key]!==value)conflicts.add(key);else if(!Object.hasOwn(stats,key))stats[key]=value;
 }
 for(const key of conflicts)stats[key]=null;
 view.stats=stats;view.summaryStatEvidence={conflicts:[...conflicts].sort(),sourceKinds:[...new Set(inputs.filter(row=>Object.keys(row.stats||{}).length).map(row=>row.summaryObservationType||(row.availabilityProvider?'provider':'independent')))],samplePeriodVerified:false};
 // Injury rows previously used neutral form; retaining metadata must not add a performance bonus to them.
 if(summary.some(row=>row.summaryObservationType==='injury')||conflicts.size)view.form=50;
 const health=inputs.filter(hasAvailabilityObservation).map(row=>({row,value:availabilityFraction(row)})).filter(item=>item.value!==null);
 if(health.length){
  const minimum=Math.min(...health.map(item=>item.value));view.availability=minimum*100;
  const selectedHealth=health.filter(item=>item.value===minimum).sort((a,b)=>String(a.row.status||'').localeCompare(String(b.row.status||'')))[0].row;
  view.status=selectedHealth.status||'Reported availability assertion';view.availabilityEvidence=health.length===1?(selectedHealth.availabilityEvidence||'reported_status'):'reconciled_observed_assertions_not_medical_verification';
  view.availabilityConflict=Boolean(view.availabilityConflict||new Set(health.map(item=>item.value)).size>1);
  if(minimum===0){view.active=false;view.confirmedStarter=false;view.confirmationStatus=conflict?'conflicting_role_reports':view.starter?'projected':'not_confirmed';}
 }else{view.availability=null;view.availabilityEvidence=summary.some(row=>row.summaryObservationType==='injury')?'unknown_reported_status':'role_prior_not_injury_clearance';}
 view.source=[...new Set(inputs.map(row=>row.source).filter(Boolean))].sort().join(' + ');
 view.sources=[...new Set(inputs.flatMap(row=>row.sources||[row.source]).filter(Boolean))].sort();
}
