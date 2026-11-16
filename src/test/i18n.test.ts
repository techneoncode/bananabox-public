import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dictionaries } from '../shared/i18n';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('English and French dictionaries define the same keys and placeholders', () => {
  const en = Object.keys(dictionaries.en).sort();
  const fr = Object.keys(dictionaries.fr).sort();
  assert.deepEqual(fr, en);
  for (const key of en) {
    assert.equal(placeholders(dictionaries.fr[key]), placeholders(dictionaries.en[key]), `placeholders differ for ${key}`);
  }
});

test('every static translation key used by the webview exists', () => {
  const used = new Set<string>();
  for (const file of sources('src/webview')) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-z]+\.[A-Za-z_.-]+)'/g)) {
      used.add(m[1]);
    }
  }
  assert.ok(used.size > 50, 'expected to find the webview translation keys');
  const missing = [...used].filter((k) => !(k in dictionaries.en));
  assert.deepEqual(missing, []);
});
