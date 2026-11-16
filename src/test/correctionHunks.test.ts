import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHunks, hunkDiff, hunkNear } from '../codingStyle/correctionHunks';

const apply = (before: string, hunks: ReturnType<typeof computeHunks>) =>
  [...hunks].reverse().reduce((text, h) => text.slice(0, h.startOffset) + h.newText + text.slice(h.endOffset), before);

test('a blank line with trailing spaces inside a function is one precise "remove" hunk', () => {
  const before = 'int main(void)\n{\n    puts("a");\n    \n    return 0;\n}\n';
  const after = 'int main(void)\n{\n    puts("a");\n    return 0;\n}\n';
  const hunks = computeHunks(before, after);
  assert.equal(hunks.length, 1);
  assert.deepEqual([hunks[0]!.kind, hunks[0]!.title, hunks[0]!.start, hunks[0]!.oldLines.length], ['removeBlank', 'Remove this blank line', 3, 1]);
  assert.equal(apply(before, hunks), after);
});

test('independent fixes become separate hunks with their own titles and in-line changes', () => {
  const before = 'int f(int a,int b)\n{\n  return a;   \n}\n\n\nint g(void)\n{\n    return (0);\n}\n';
  const after = 'int f(int a, int b)\n{\n    return a;\n}\n\nint g(void)\n{\n    return (0);\n}\n';
  const hunks = computeHunks(before, after);
  assert.deepEqual(hunks.map(h => [h.kind, h.title]), [
    ['spacing', 'Fix spacing'],
    ['indent', 'Fix indentation and trailing whitespace'],
    ['removeBlank', 'Remove this blank line'],
  ]);
  assert.deepEqual(hunks[0]!.inline, [{ start: 12, remove: 0, insert: ' ' }]);
  assert.equal(apply(before, hunks), after);
  // Each hunk applies alone too: accepting one keeps the others valid after a new diff.
  const once = before.slice(0, hunks[1]!.startOffset) + hunks[1]!.newText + before.slice(hunks[1]!.endOffset);
  assert.deepEqual(computeHunks(once, after).map(h => h.kind), ['spacing', 'removeBlank']);
});

test('headers, braces, final newline and CRLF are described precisely', () => {
  const header = computeHunks('int x;\n', '/*\n** EPITECH PROJECT, 2026\n*/\n\nint x;\n');
  assert.deepEqual(header.map(h => [h.kind, h.title]), [['header', 'Add the Epitech header (C-G1)']]);
  const brace = computeHunks('int f(void) {\n    return 0;\n}\n', 'int f(void)\n{\n    return 0;\n}\n');
  assert.deepEqual(brace.map(h => [h.kind, h.title]), [['layout', 'Put the brace on its own line']]);
  const eof = computeHunks('int x;', 'int x;\n');
  assert.deepEqual(eof.map(h => [h.kind, h.newText]), [['finalNewline', 'int x;\n']]);
  // Line endings alone are not a hunk; a CRLF line still diffs against its LF form.
  assert.deepEqual(computeHunks('a\r\nb  \r\n', 'a\nb\n').map(h => [h.kind, h.start]), [['trailing', 1]]);
  assert.match(hunkDiff(brace[0]!), /^- int f\(void\) \{\n\+ int f\(void\)\n\+ \{$/);
});

test('the proposed hunk follows the cursor', () => {
  const hunks = computeHunks('a  \nb\nc\nd  \n', 'a\nb\nc\nd\n');
  assert.equal(hunkNear(hunks, 0), 0);
  assert.equal(hunkNear(hunks, 1), 1);
  assert.equal(hunkNear(hunks, 9), 1);
  assert.equal(hunkNear([], 0), -1);
});

test('an added header stays its own hunk when the first line is reformatted too', () => {
  const before = 'int f(void){return(0);}', after = '/*\n** EPITECH PROJECT, 2026\n** x\n** File description:\n** x\n*/\n\nint f(void)\n{\n    return (0);\n}\n';
  const hunks = computeHunks(before, after);
  assert.deepEqual(hunks.map(h => h.kind), ['header', 'layout']);
  assert.equal(apply(before, hunks), after);
});
