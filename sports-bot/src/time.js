import { config } from './config.js';

export function localParts(date = new Date(), timezone = config.timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function localDateKey(date = new Date(), timezone = config.timezone) {
  const p = localParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function espnDateKey(date = new Date(), timezone = config.timezone) {
  return localDateKey(date, timezone).replaceAll('-', '');
}

export function formatLocalTime(iso, timezone = config.timezone) {
  if (!iso) return 'TBD';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function isDailyPostTime(now = new Date(), options = {}) {
  const p = localParts(now);
  const hour = Number.isFinite(Number(options.hour)) ? Number(options.hour) : config.dailyPostHour;
  const minute = Number.isFinite(Number(options.minute)) ? Number(options.minute) : config.dailyPostMinute;
  return p.hour === hour && p.minute === minute;
}
