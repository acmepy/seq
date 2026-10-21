/** Formats local time consistently for console and configured log handlers. */
export function logPrefix(level, operation, now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join(':');
  return `[${date} ${time}] [${level.toUpperCase()}] [SEQ] [${operation}]`;
}

export function logOperation(payload) {
  const metadata = payload.find(value => value && typeof value === 'object' && !Array.isArray(value) && value.type);
  if (metadata?.type === 'sql') return 'sql';
  if (metadata?.type === 'model-operation') return `${metadata.model}.${metadata.operation}`;
  if (payload.some(value => value?.operation === 'dependency')) return 'dependency';
  const message = String(payload[0] ?? '');
  if (message.startsWith('Cache ')) return 'cache';
  if (message.startsWith('Sync ')) return 'sync';
  if (message === 'Seq initialized') return 'init';
  if (message === 'conectado') return 'connect';
  if (message === 'desconectado') return 'close';
  return 'log';
}

export function singleLine(value) {
  return value.replace(/\r\n|\r|\n/g, '\\n');
}
