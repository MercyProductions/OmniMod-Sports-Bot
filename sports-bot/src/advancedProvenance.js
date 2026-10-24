const observationFields = ['updatedAt','fetchedAt','sourceFetchedAt','recordedAt','observedAt','sourceObservationAt'];
export const ADVANCED_PROVENANCE_METADATA_FIELDS = Object.freeze([
 'provider','provenancePolicy','sourceReceiptTimes','sourceRequestKeys','sourceRefreshStatuses','sourceContributions',
 'requestedSourceKey','publicationTimeVerified','sourcePeriodEvidence',...observationFields
]);
const metadata = new Set(ADVANCED_PROVENANCE_METADATA_FIELDS);
const present = value => value !== undefined && value !== null && value !== '';

/** Replace provenance for overwritten fields; this is input lineage, never an append-only audit journal. */
export function composeAdvancedProvenance(previous, {sourceId, fields=[], rows=[], requestKey=null, refreshStatus=null, dependencyReceiptTimes=[]}) {
 const owned = new Set(fields), currentFields = Object.keys(previous || {}).filter(key => !metadata.has(key));
 const validEntries = previous?.provenancePolicy === 'field-source-contributions-v2'
  && Array.isArray(previous.sourceContributions) && previous.sourceContributions.every(entry => entry && typeof entry.sourceId === 'string'
   && Array.isArray(entry.fields) && entry.fields.every(key => typeof key === 'string')
   && Array.isArray(entry.sourceReceiptTimes) && Array.isArray(entry.sourceRequestKeys) && Array.isArray(entry.sourceRefreshStatuses));
 let entries = validEntries ? previous.sourceContributions.map(entry => ({...entry,
  fields:entry.fields.filter(key => !owned.has(key) && Object.hasOwn(previous,key)),
  sourceReceiptTimes:[...entry.sourceReceiptTimes],sourceRequestKeys:[...entry.sourceRequestKeys],sourceRefreshStatuses:[...entry.sourceRefreshStatuses]
 })).filter(entry => entry.fields.length) : [];
 const attributed = new Set(entries.flatMap(entry => entry.fields));
 const inheritedFields = currentFields.filter(key => !owned.has(key) && !attributed.has(key));
 if(inheritedFields.length){
  const receipts = Array.isArray(previous.sourceReceiptTimes) ? [...previous.sourceReceiptTimes] : [];
  receipts.push(...observationFields.map(key => previous[key]).filter(present));
  if(!validEntries && Array.isArray(previous.sourceContributions))receipts.push(...previous.sourceContributions.flatMap(entry=>Array.isArray(entry?.sourceReceiptTimes)?entry.sourceReceiptTimes:[null]));
  entries.push({sourceId:'inherited-unattributed',fields:inheritedFields,
   sourceReceiptTimes:receipts.length?receipts:[null],
   sourceRequestKeys:Array.isArray(previous.sourceRequestKeys)&&previous.sourceRequestKeys.length?[...previous.sourceRequestKeys]:[null],
   sourceRefreshStatuses:Array.isArray(previous.sourceRefreshStatuses)?[...previous.sourceRefreshStatuses]:[]});
 }
 entries.push({sourceId,fields:[...fields],sourceReceiptTimes:[...(rows.length?rows.map(row=>row?.sourceFetchedAt||null):[null]),...dependencyReceiptTimes],
  sourceRequestKeys:rows.length?rows.map(row=>row?.sourceRequestKey||null):[null],sourceRefreshStatuses:refreshStatus?[{...refreshStatus}]:[]});
 const statuses = new Map();
 for(const entry of entries)for(const status of entry.sourceRefreshStatuses)if(status?.sourceId)statuses.set(status.sourceId,{...status});
 return {...Object.fromEntries(observationFields.map(key=>[key,null])),...Object.fromEntries(fields.map(key=>[key,null])),
  sourceContributions:entries,sourceReceiptTimes:entries.flatMap(entry=>entry.sourceReceiptTimes),
  sourceRequestKeys:entries.flatMap(entry=>entry.sourceRequestKeys),sourceRefreshStatuses:[...statuses.values()],
  requestedSourceKey:requestKey,sourcePeriodEvidence:null,publicationTimeVerified:false,provenancePolicy:'field-source-contributions-v2'};
}
