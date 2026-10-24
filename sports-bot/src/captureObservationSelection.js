/** Deterministic receipt-time selection; conflicting ties stay ambiguous until a strictly preferred receipt. */
export function selectCaptureObservation(previous,next,{earliest=false}={}) {
  if(!Number.isFinite(next?.issued)||typeof next.signature!=='string')throw new Error('Valid capture observation required');
  if(!previous)return next;
  if(next.issued!==previous.issued)return (earliest?next.issued<previous.issued:next.issued>previous.issued)?next:previous;
  const chosen=String(next.tieKey||'').localeCompare(String(previous.tieKey||''))<0?next:previous;
  return previous.conflict||next.conflict||previous.signature!==next.signature?{...chosen,conflict:true}:chosen;
}
