/** A conflict removes a label until an explicitly linked reconciliation result follows it. */
export function journalResultState(records=[]){
  const eligible=new Map(),conflicts=new Map();
  for(const record of records){
    const row=record.payload||{},id=row.forecastId;
    if(record.type==='result_conflict'){
      conflicts.set(id,record);eligible.delete(id);
    }else if(record.type==='result'&&['away','home','draw'].includes(row.actualSide)){
      const conflict=conflicts.get(id);
      if(conflict&&row.resolvesConflictId!==conflict.payload.conflictId)continue;
      conflicts.delete(id);eligible.set(id,record);
    }
  }
  return {eligible,conflicts};
}
