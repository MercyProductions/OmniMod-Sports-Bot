import {finalReplyFor} from './finalResultIdentity.js';
/** Revisit unresolved events and bounded acknowledged-final corrections using public data. */
export function pendingFinalDateKeys(caches = [], { today, now = Date.now(), lookbackDays = 7,correctionHours=24,correctionMinutes=60 } = {}) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(now)) throw new Error('Valid final-reconciliation dates are required.');
  if(!Number.isFinite(correctionHours)||correctionHours<0||!Number.isFinite(correctionMinutes)||correctionMinutes<1)throw new Error('Invalid correction recheck bounds');
  const dates = new Set();
  for (const cache of caches) {
    const age = (todayMs - Date.parse(`${cache.dateKey}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0 || age > lookbackDays) continue;
    const slate = cache.slate || {};
    if ((slate.predictions || []).some(row => row.predictionMode === 'pregame' && row.eligibleForCalibration !== false
      && Number.isFinite(Date.parse(row.startTime || '')) && Date.parse(row.startTime) <= now
      && (typeof row.predictionCorrect !== 'boolean' || !finalReplyFor({...slate,dateKey:slate.dateKey||cache.dateKey},row) || slate.finalDeliveryFailures?.some(row=>row.retryable!==false)
       || (correctionHours>0&&now-Date.parse(row.startTime)<=correctionHours*3600000&&(!Number.isFinite(Date.parse(slate.lastFinalCorrectionCheckAt||''))||now-Date.parse(slate.lastFinalCorrectionCheckAt)>=correctionMinutes*60000))))) dates.add(cache.dateKey);
  }
  return [...dates].sort().reverse();
}
