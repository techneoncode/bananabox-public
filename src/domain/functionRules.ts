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
      || !/^!?[A-Za-z_]\w*\*?$/.test(name))) {
    return null;
  }
  return [...new Set(raw)];
}

export const mergeFunctionNames = (...lists: readonly string[][]): string[] =>
  [...new Set(lists.flat())];
