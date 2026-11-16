/**
 * What a subject asks of the Makefile: the rules it must define and the binary
 * it must build.
 */
export interface SubjectMakefile {
  rules: string[];
  binary?: string;
}

/**
 * Rule names subjects ask for; anything else must at least look like a rule
 * (`tests_run`, `unit_tests`).
 */
const KNOWN_RULES = new Set([
  'all', 'clean', 'fclean', 're', 'bonus', 'tests_run', 'unit_tests',
  'debug', 'install', 'coverage', 'lib',
]);
const WORDS = new Set([
  'the', 'and', 'or', 'with', 'rule', 'rules', 'makefile', 'including',
  'include', 'includes', 'containing', 'contain', 'contains', 'must', 'should',
  'your', 'following', 'via', 'compilation', 'compile', 'a', 'an', 'its', 'at',
  'least', 'also', 'as', 'well', 'usual', 'classic', 'have', 'has', 'be', 'in',
  'of', 'to', 'by', 'for', 'which', 'that', 'will', 'these', 'those', 'ones',
  'one', 'other', 'all_the',
]);

const ruleWord = (word: string) => KNOWN_RULES.has(word)
  || (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(word) && !WORDS.has(word));

/**
 * Reads the Makefile requirements out of a subject's text: "compilation: via
 * Makefile, including re, clean and fclean rules", "Your Makefile must contain
 * the rules unit_tests and tests_run", and "binary name: my_ls".
 */
export function parseSubjectMakefile(text: string): SubjectMakefile {
  const lines = text.split(/\r?\n/)
    .map(l => l.replace(/[“”"'`‘’]/g, ' ').trim());
  const rules: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/makefile/i.test(lines[i]!)) continue;
    let segment = lines[i]!.slice(lines[i]!.search(/makefile/i));
    if (!/\brules?\b/i.test(segment)
      && /\brules?\b/i.test(lines[i + 1] ?? '')) {
      segment += ` ${lines[i + 1]}`;
    } else if (/,\s*$|\b(?:and|rules?:?)\s*$/i.test(segment)) {
      segment += ` ${lines[i + 1] ?? ''}`;
    }
    if (!/\brules?\b/i.test(segment)) continue;
    const sentence = segment.split(/(?<=[a-z0-9_)])\.(?:\s|$)/i)[0]!;
    for (const word of sentence.toLowerCase().split(/[\s,;:()/]+/)) {
      if (ruleWord(word) && !rules.includes(word)) rules.push(word);
    }
  }
  const binary = /\bbinary\s+name\s*:?\s*([A-Za-z0-9_.\-/]+)/i
    .exec(text)?.[1]?.replace(/[.,;]$/, '');

  return {
    rules,
    ...(binary && !/^(?:none|n\/a)$/i.test(binary) ? { binary } : {}),
  };
}
