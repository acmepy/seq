import { ConfigurationError } from '../core/errors/ConfigurationError.js';

export function validateTimezone(value, allowLocal = false) {
  if (value === undefined || value === 'Z' || allowLocal && value === 'local') return value;
  const match = typeof value === 'string' && value.match(/^([+-])(\d{2}):(\d{2})$/);
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) : NaN;
  if (!match || Number(match[3]) > 59 || minutes < -720 || minutes > 840) {
    throw new ConfigurationError('timezone must be Z or an offset between -12:00 and +14:00', { code: 'SEQ_INVALID_TIMEZONE', details: { timezone: value } });
  }
  return value;
}

export function formatDateInTimezone(date, timezone = 'Z', precision = 3) {
  if (timezone === 'local') {
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    const value = pad(date.getFullYear(), 4) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    return precision ? value + '.' + pad(date.getMilliseconds(), 3) : value;
  }
  const minutes = timezone === 'Z' ? 0 : (Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4))) * (timezone[0] === '-' ? -1 : 1);
  return new Date(date.getTime() + minutes * 60000).toISOString().slice(0, precision ? 23 : 19).replace('T', ' ');
}

export function parseDateInTimezone(value, timezone = 'Z') {
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(value)) {
    const normalized = value.length === 10 ? value + 'T00:00:00' : value.replace(' ', 'T');
    return new Date(normalized + (timezone === 'local' ? '' : timezone));
  }
  return new Date(value);
}
