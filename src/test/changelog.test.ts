import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelog, selectChangelog } from '../domain/changelog';
import { CHANGELOG_MAX_BYTES, fetchChangelog } from '../services/changelog';

const SAMPLE = `# Changelog

## [Unreleased]

### Added
- Not released yet.

## [1.10.0] - 2026-01-03

### Highlights
- Newest.

## [1.9.0] - 2026-01-02
- Older, numbers compare as numbers.

\`\`\`md
## [9.9.9] - 2026-01-01
\`\`\`

## [1.2.0] - 2025-12-31
- Oldest.
`;

test('the changelog parser reads released versions, skips Unreleased and keeps the markdown body', () => {
  const entries = parseChangelog(SAMPLE);
  assert.deepEqual(entries.map((entry) => entry.version), ['1.10.0', '1.9.0', '1.2.0']);
  assert.deepEqual(entries[0], { version: '1.10.0', date: '2026-01-03', body: '### Highlights\n- Newest.' });
  assert.equal(entries[1].body.startsWith('- Older, numbers compare as numbers.'), true);
  assert.equal(entries[1].body.includes('9.9.9'), true, 'a heading inside a code fence stays in the body');
});

test('the changelog parser accepts CRLF line endings and headings without a date', () => {
  const entries = parseChangelog('## [2.0.0]\r\n- Big one.\r\n## [1.0.0] - 2026-02-01\r\n- Start.\r\n');
  assert.deepEqual(entries, [
    { version: '2.0.0', date: '', body: '- Big one.' },
    { version: '1.0.0', date: '2026-02-01', body: '- Start.' },
  ]);
});

test('selectChangelog keeps the versions after the installed one, up to the target, newest first', () => {
  const entries = parseChangelog(SAMPLE);
  assert.deepEqual(selectChangelog(entries, '1.2.0', '1.10.0').map((entry) => entry.version), ['1.10.0', '1.9.0']);
  assert.deepEqual(selectChangelog(entries, '1.9.0', '1.9.0'), []);
  assert.deepEqual(selectChangelog(entries, '1.0.0', '1.9.0').map((entry) => entry.version), ['1.9.0', '1.2.0']);
  assert.deepEqual(selectChangelog(entries, '1.0.0', '1.2.0').map((entry) => entry.version), ['1.2.0']);
});

test('fetchChangelog reads the release tag, falls back to main on 404 and refuses oversized files', async () => {
  const requested: string[] = [];
  const signal = new AbortController().signal;
  const serve = (routes: Record<string, () => Response>) => (async (url: string | URL | Request) => {
    const href = String(url);
    requested.push(href);
    return routes[href]?.() ?? new Response('', { status: 404 });
  }) as typeof fetch;

  const tagged = 'https://raw.githubusercontent.com/techneoncode/bananabox-public/v2.0.2/CHANGELOG.md';
  const main = 'https://raw.githubusercontent.com/techneoncode/bananabox-public/main/CHANGELOG.md';
  assert.equal(await fetchChangelog('2.0.2', serve({ [tagged]: () => new Response('## [2.0.2]\n- Tagged.') }), signal), '## [2.0.2]\n- Tagged.');
  assert.deepEqual(requested, [tagged]);

  requested.length = 0;
  assert.equal(await fetchChangelog('2.0.3', serve({ [main]: () => new Response('## [2.0.3]\n- Main.') }), signal), '## [2.0.3]\n- Main.');
  assert.deepEqual(requested, [tagged.replace('v2.0.2', 'v2.0.3'), main]);

  await assert.rejects(fetchChangelog('2.0.4', serve({}), signal));
  await assert.rejects(fetchChangelog('2.0.2', serve({ [tagged]: () => new Response('x'.repeat(CHANGELOG_MAX_BYTES + 1)) }), signal));
  await assert.rejects(fetchChangelog('2.0.2', serve({ [tagged]: () => new Response('', { status: 500 }) }), signal));
  await assert.rejects(fetchChangelog('2.0.2/../x', serve({}), signal), 'a malformed version never reaches the URL');
});
