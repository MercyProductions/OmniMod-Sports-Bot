import {eventObservationHash} from './journalEventMatch.js';
import {quoteTimeEpoch as instant} from './oddsPricing.js';

/** Audit caller-visible forecast records only; never mutates or authenticates a journal. */
export function auditJournalForecastIdentities(records=[]) {
  const groups=new Map();let invalidIdRecords=0,unverifiableRecordTimes=0;
  for(const event of records){
    if(event.type!=='forecast')continue;
    const id=event.payload?.forecastId;
    if(typeof id!=='string'||!id.trim()){invalidIdRecords++;continue;}
    if(!Number.isFinite(instant(event.recordedAt))){unverifiableRecordTimes++;continue;}
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(event);
  }
  const events=[],conflictingIds=new Set();let conflictingRecords=0,duplicateRecords=0;
  for(const [id,copies] of groups){
    if(new Set(copies.map(event=>eventObservationHash(event.payload))).size>1){
      conflictingIds.add(id);conflictingRecords+=copies.length;continue;
    }
    const ordered=[...copies].sort((a,b)=>instant(a.recordedAt)-instant(b.recordedAt));
    events.push(ordered[0]);duplicateRecords+=copies.length-1;
  }
  events.sort((a,b)=>instant(a.recordedAt)-instant(b.recordedAt)||a.payload.forecastId.localeCompare(b.payload.forecastId));
  return {events,canonicalEvents:new Set(events),conflictingIds,conflictingRecords,duplicateRecords,invalidIdRecords,unverifiableRecordTimes};
}
