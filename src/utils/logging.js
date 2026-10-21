/** Escapes line breaks so each log event occupies one line. */
export function singleLine(value) {
  return value.replace(/\r\n|\r|\n/g, '\\n');
}
