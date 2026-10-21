import { finiteNumber } from './dataValidation.js';
import { checkedDatasetRows, nonemptyText } from './advancedDatasetContracts.js';

const fields=['xGoalsFor','xGoalsAgainst','goalsAgainst'];

export function hockeyMeasurementEvidence(row={}) {
 const values={},invalidMeasurements=[],missingMeasurements=[];
 for(const field of fields){
  const observed=finiteNumber(row?.[field]);
  const invalid=observed!==null&&(observed<0||field==='goalsAgainst'&&!Number.isSafeInteger(observed));
  if(observed===null)missingMeasurements.push(field);
  if(invalid)invalidMeasurements.push(field);
  values[field]=invalid?null:observed;
 }
 return {values,invalidMeasurements,missingMeasurements};
}

export function checkedHockeyTeamRows(rows) {
 const parsed=checkedDatasetRows(rows,{source:'moneypuck-team-xg',keys:[['team'],['situation'],['xGoalsFor','xGoalsAgainst','goalsFor','goalsAgainst']],
  features:['xGoalsFor','xGoalsAgainst','goalsFor','goalsAgainst'],identity:row=>nonemptyText(row.team)&&nonemptyText(row.situation)});
 const all=parsed.rows.filter(row=>String(row.situation).trim().toLowerCase()==='all');
 if(!all.length)throw new Error('Advanced source moneypuck-team-xg: no all-situations observations');
 const teams=new Set();
 for(const row of all){
  const key=String(row.team).trim().toUpperCase();
  if(teams.has(key))throw new Error('Advanced source moneypuck-team-xg: duplicate all-situations team identity');
  teams.add(key);
 }
 return {rows:all,rejectedRows:parsed.rejectedRows,excludedSituationRows:parsed.rows.length-all.length};
}
