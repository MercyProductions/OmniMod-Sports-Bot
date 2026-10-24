/** Numerical floor only; do not cap away correctly certain or very unlikely outcomes. */
export const LOG_LOSS_FLOOR = 1e-12;
export const LOG_LOSS_PROTOCOL = 'multinomial-log-floor-1e-12-v1';
export function probabilityLogLoss(probability) {
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('Log loss requires a finite probability in [0, 1]');
  return -Math.log(Math.max(LOG_LOSS_FLOOR, probability));
}
