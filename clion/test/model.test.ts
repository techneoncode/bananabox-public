import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, Uri, Range, TextEdit, editedText } from '../host/model';
import { createT } from '../../src/shared/i18n';

test('CLion build identifies its host in French and English', () => {
  for (const language of ['fr', 'en'] as const) {
    assert.match(createT(language)('login.tagline'), /CLion/);
    assert.match(createT(language)('subject.open.editor'), /CLion/);
  }
});

test('URI round trips spaces, percent signs, Unicode and virtual commit revisions', () => {
  const file = Uri.file('/tmp/école #1/100% main.c');
  assert.equal(Uri.parse(file.toString()).fsPath, '/tmp/école #1/100% main.c');
  const commit = Uri.from({ scheme: 'bananabox-commit', authority: 'snapshot', path: '/source é.c', query: 'abc123' });
  assert.equal(Uri.parse(commit.toString()).path, '/source é.c');
  assert.equal(Uri.parse(commit.toString()).query, 'abc123');
});
test('UTF-16 positions and CRLF agree with the shared correction engine', () => {
  const doc = new Document(Uri.file('/tmp/main.c'), 'é😀\r\nnext  \r\n');
  assert.equal(doc.lineAt(0).text.length, 3);
  assert.equal(doc.offsetAt(doc.lineAt(1).range.start), 5);
  assert.equal(doc.positionAt(5).line, 1);
  assert.equal(doc.lineCount, 3);
  const edits = [TextEdit.replace(new Range(1, 4, 1, 6), ''), TextEdit.setEndOfLine(1)];
  assert.equal(editedText(doc, edits), 'é😀\nnext\n');
  assert.equal(doc.getText(), 'é😀\r\nnext  \r\n');
});
test('simultaneous replacements use original offsets and reject overlaps', () => {
  const doc = new Document(Uri.file('/tmp/main.c'), 'abcdef');
  assert.equal(editedText(doc, [TextEdit.replace(new Range(0, 0, 0, 1), 'long'), TextEdit.replace(new Range(0, 4, 0, 6), '!')]), 'longbcd!');
  assert.throws(() => editedText(doc, [TextEdit.replace(new Range(0, 0, 0, 3), ''), TextEdit.replace(new Range(0, 2, 0, 4), '')]), /Overlapping/);
});
