import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeInlineTexts } from '../codingStyle/ui';

test('lens: messages differing only by their last word are merged in place', () => {
  assert.deepEqual(mergeInlineTexts(["[warning]: unused parameter 'argc'", '[Minor] C-G7: trailing space', "[warning]: unused parameter 'argv'"]),
    ["[warning]: unused parameter 'argc', 'argv'", '[Minor] C-G7: trailing space']);
  assert.deepEqual(mergeInlineTexts(['[Major]', "[warning]: unused parameter 'argc'", "[warning]: unused parameter 'argc'"]), ['[Major]', "[warning]: unused parameter 'argc'"]);
});
