/**
 * Accept a function name, a library prefix (`sf*`) or a pasted list, preserving
 * C's case sensitivity.
 */
export function parseFunctionNames(text: string): string[] | null {
  if (text.length > 16_384) return null;
  const names = text
    .replace(/([A-Za-z_]\w*)\s*\(\s*\)/g, '$1')
    .split(/[\s,;]+/)
    .filter(Boolean);
  return validateFunctionNames(names);
}

export function validateFunctionNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 1000
    || raw.some(name => typeof name !== 'string' || name.length > 128
      || !/^!?\*?[A-Za-z_]\w*\*?$/.test(name))) {
    return null;
  }
  return [...new Set(raw)];
}

export const mergeFunctionNames = (...lists: readonly string[][]): string[] =>
  [...new Set(lists.flat())];

/**
 * The rules a check applies: the subject's allowed list and the student's
 * names, plus every function the subject forbids as a `!` entry. When the
 * subject allows the whole libC minus a forbidden list, the student's allowed
 * names add nothing (everything else is allowed already) and only their `!`
 * entries count.
 */
export function effectiveFunctions(
  subject: { names: readonly string[]; forbidden?: readonly string[] },
  custom: readonly string[],
): string[] {
  const banned = (subject.forbidden ?? []).map(n => `!${n}`);
  const allowed = subject.names.length || !banned.length
    ? [...subject.names, ...custom]
    : custom.filter(n => n.startsWith('!'));
  return [...new Set([...allowed, ...banned])];
}
