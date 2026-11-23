/** Mask comments and literals without moving line numbers or columns. */
export function maskC(text: string): string {
  return text.replace(
    /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    token => token.replace(/[^\r\n]/g, ' '),
  );
}

/**
 * Whether `name` matches a subject pattern: `write`, `getpw*` (prefix),
 * `*getsp*` (anywhere) or `*fork` (suffix).
 */
export function matchesName(pattern: string, name: string): boolean {
  const lead = pattern.startsWith('*'), trail = pattern.endsWith('*');
  const core = pattern.slice(lead ? 1 : 0, trail ? -1 : undefined);
  if (lead && trail) return name.includes(core);
  if (lead) return name.endsWith(core);
  if (trail) return name.startsWith(core);
  return name === core;
}

export function findForbiddenFunctions(
  text: string,
  names: readonly string[],
): Array<{ line: number; column: number; message: string }> {
  const banned = new Set(names), masked = maskC(text), result = [];
  for (const match of masked.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    if (!banned.has(match[1])) continue;
    const prefix = masked.slice(0, match.index!);
    result.push({
      line: prefix.split('\n').length,
      column: match.index! - prefix.lastIndexOf('\n'),
      message: match[1],
    });
  }
  return result;
}
