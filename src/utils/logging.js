/** Creates detached JSON-compatible log data without exposing sensitive fields. */
export function sanitizeLogData(event) {
  const ancestors = new Set();
  function copy(value) {
    if (typeof value === 'bigint') return String(value);
    if (!value || typeof value !== 'object') return value;
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    try {
      if (value instanceof Error) return copyObject({ ...value, name: value.name, message: value.message, stack: value.stack });
      if (typeof value.toJSON === 'function') return copy(value.toJSON());
      if (Array.isArray(value)) return value.map(copy);
      return copyObject(value);
    } finally { ancestors.delete(value); }
  }
  function copyObject(value) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key,
      /password|passwd|token|secret|api[_-]?key/i.test(key) ? '[REDACTED]' : copy(nested)]));
  }
  try { return JSON.parse(JSON.stringify(copy(event))); }
  catch { return { message: 'Unable to serialize log data' }; }
}
