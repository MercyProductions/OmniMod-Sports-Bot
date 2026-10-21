import {quoteTimeEpoch} from './oddsPricing.js';

/** Source event start only: explicit minute precision denotes :00 seconds; never infer a zone or receipt clock. */
export function capturedEventTime(value) {
  if(typeof value!=='string')return NaN;
  const canonical=value.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/i,'$1:00$2');
  return quoteTimeEpoch(canonical);
}
