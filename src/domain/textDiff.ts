/**
 * Small, dependency-free line diff used to show "Got" versus "Expected"
 * outputs.
 */
export type DiffOp = {
  kind: 'same' | 'removed' | 'added';
  text: string;
  expectedLine?: number;
  gotLine?: number;
};

export interface FirstDifference {
  /** 1-based line where the outputs first differ. */
  line: number;
  expected: string | null;
  got: string | null;
  /** 1-based column of the first differing character, when both lines exist. */
  column: number | null;
  kind: 'missing_line' | 'extra_line' | 'whitespace' | 'content';
  /**
   * Which side is longer, for a one-line hint such as "got has 2 extra
   * characters".
   */
  deltaChars: number;
}

const MAX_LINES = 2000;
const split = (s: string): string[] => (s === ''
  ? []
  : s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/**
 * LCS line diff. Inputs beyond MAX_LINES fall back to a positional comparison.
 */
export function diffLines(expected: string, got: string): DiffOp[] {
  const a = split(expected);
  const b = split(got);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const ops: DiffOp[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) {
        ops.push({
          kind: 'same',
          text: a[i]!,
          expectedLine: i + 1,
          gotLine: i + 1,
        });
      } else {
        if (a[i] !== undefined) {
          ops.push({ kind: 'removed', text: a[i]!, expectedLine: i + 1 });
        }
        if (b[i] !== undefined) {
          ops.push({ kind: 'added', text: b[i]!, gotLine: i + 1 });
        }
      }
    }
    return ops;
  }
  const n = a.length;
  const m = b.length;
  const table: Uint16Array[] = Array.from(
    { length: n + 1 },
    () => new Uint16Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({
        kind: 'same',
        text: a[i]!,
        expectedLine: i + 1,
        gotLine: j + 1,
      });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: 'removed', text: a[i]!, expectedLine: ++i });
    } else {
      ops.push({ kind: 'added', text: b[j]!, gotLine: ++j });
    }
  }
  while (i < n) ops.push({ kind: 'removed', text: a[i]!, expectedLine: ++i });
  while (j < m) ops.push({ kind: 'added', text: b[j]!, gotLine: ++j });
  return ops;
}

/**
 * Where and how two outputs first diverge (position based, like a human
 * reading both).
 */
export function firstDifference(
  expected: string,
  got: string,
  options: { ignoreTrailingNewline?: boolean } = {},
): FirstDifference | null {
  const a = split(expected), b = split(got);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === undefined) {
      return {
        line: i + 1,
        expected: null,
        got: y!,
        column: null,
        kind: 'extra_line',
        deltaChars: y!.length,
      };
    }
    if (y === undefined) {
      return {
        line: i + 1,
        expected: x,
        got: null,
        column: null,
        kind: 'missing_line',
        deltaChars: -x.length,
      };
    }
    let c = 0;
    while (c < x.length && c < y.length && x[c] === y[c]) c++;
    return {
      line: i + 1,
      expected: x,
      got: y,
      column: c + 1,
      kind: x.replace(/\s+/g, '') === y.replace(/\s+/g, '')
        ? 'whitespace'
        : 'content',
      deltaChars: y.length - x.length,
    };
  }
  if (!options.ignoreTrailingNewline
    && expected.replace(/\r\n?/g, '\n') !== got.replace(/\r\n?/g, '\n')) {
    const x = expected.replace(/\r\n?/g, '\n');
    const y = got.replace(/\r\n?/g, '\n');
    return {
      line: Math.max(a.length, 1),
      expected: a.at(-1) ?? '',
      got: b.at(-1) ?? '',
      column: null,
      kind: 'whitespace',
      deltaChars: y.length - x.length,
    };
  }
  return null;
}
