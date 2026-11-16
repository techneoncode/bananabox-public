/** Mask comments and literals without moving line numbers or columns. */
export function maskC(text: string): string {
  return text.replace(
    /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    token => token.replace(/[^\r\n]/g, ' '),
  );
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
