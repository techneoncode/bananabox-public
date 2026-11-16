import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivities } from '../domain/activities';
import { dueReminder, formatCountdown, isUrgent, reminderKey } from '../domain/deadlines';
import { blockingCount, buildScanVM, describeIssue, MAX_ISSUES, resolveInside } from '../domain/styleScan';
import type { StyleScanResult } from '../codingStyle/api';

test('activities: kick-off and bootstrap are recognised, sorted and malformed entries are dropped', () => {
  const raw = [
    { id: 22765, name: 'Bootstrap - mini_printf', startDate: '2026-10-12T07:30:00.000Z', endDate: '2026-10-12T10:00:00.000Z', mandatory: false, hasStudentDocuments: true, eventId: 15080, status: 'registered' },
    { id: 22764, name: 'Kick-off - mini_printf', startDate: '2026-10-12T07:00:00.000Z', endDate: '2026-10-12T07:30:00.000Z', mandatory: true, hasStudentDocuments: false, eventId: 15079, status: 'registered' },
    { id: 1, name: 'Broken', startDate: 'nope', endDate: '2026-10-12T07:30:00.000Z' },
    null,
    { id: 2, name: 'Workshop', startDate: '2026-10-11T07:00:00.000Z', endDate: '2026-10-11T08:00:00.000Z' },
  ];
  const out = normalizeActivities(raw);
  assert.deepEqual(out.map((a) => [a.name, a.kind]), [['Workshop', 'activity'], ['Kick-off - mini_printf', 'kickoff'], ['Bootstrap - mini_printf', 'bootstrap']]);
  assert.equal(out[1].mandatory, true);
  assert.equal(out[2].hasDocuments, true);
  assert.equal(out[0].status, null);
  assert.deepEqual(normalizeActivities({ not: 'an array' }), []);
});

test('deadlines: J-1 and H-3 fire once, the tightest threshold wins and nothing fires after closing', () => {
  const end = '2026-10-13T17:42:00.000Z';
  const at = (hoursBefore: number) => Date.parse(end) - hoursBefore * 3_600_000;
  assert.equal(dueReminder(1, end, at(30), new Set()), null);
  const day = dueReminder(1, end, at(23), new Set());
  assert.equal(day?.hours, 24);
  assert.deepEqual(day?.keys, [reminderKey(1, end, 24)]);
  assert.equal(dueReminder(1, end, at(22), new Set(day!.keys)), null);
  const late = dueReminder(1, end, at(2), new Set(day!.keys));
  assert.equal(late?.hours, 3);
  const cold = dueReminder(1, end, at(2), new Set());
  assert.equal(cold?.hours, 3);
  assert.deepEqual(cold?.keys, [reminderKey(1, end, 3), reminderKey(1, end, 24)]);
  assert.equal(dueReminder(1, end, at(2), new Set(cold!.keys)), null);
  assert.equal(dueReminder(1, end, at(-1), new Set()), null);
  assert.equal(dueReminder(1, 'garbage', at(1), new Set()), null);
  assert.equal(dueReminder(2, end, at(2), new Set(cold!.keys))?.hours, 3, 'another project is independent');
});

test('deadlines: countdown format and urgency', () => {
  assert.equal(formatCountdown(2 * 86_400_000 + 4 * 3_600_000), '2d 4h');
  assert.equal(formatCountdown(3 * 3_600_000 + 12 * 60_000), '3h 12m');
  assert.equal(formatCountdown(42 * 60_000), '42m');
  assert.equal(formatCountdown(10_000), '1m');
  assert.equal(formatCountdown(-5), '0m');
  assert.equal(isUrgent(2 * 3_600_000), true);
  assert.equal(isUrgent(4 * 3_600_000), false);
  assert.equal(isUrgent(0), false);
});

const result = (over: Partial<StyleScanResult> = {}): StyleScanResult => ({
  root: '/home/me/proj',
  files: 4,
  summary: { fatal: 1, major: 2, minor: 1, info: 0, other: 3, functions: 0 },
  durationMs: 900,
  cancelled: false,
  issues: [
    { file: '/home/me/proj/src/b.c', line: 9, column: 1, bucket: 'minor', ruleId: 'C-L3', message: 'bad spacing' },
    { file: '/home/me/proj/src/a.c', line: 20, column: 5, bucket: 'major', ruleId: 'C-F3', message: 'too many lines' },
    { file: '/home/me/proj/src/a.c', line: 3, column: 1, bucket: 'fatal', ruleId: 'C-G1', message: 'missing header' },
    { file: '/elsewhere/x.h', line: 1, column: 1, bucket: 'major', message: 'outside the project' },
  ],
  ...over,
});

test('style scan: worst first, relative paths, outside files dropped, blocking = fatal + major', () => {
  const vm = buildScanVM(7, 'preflight', result(), 123);
  assert.deepEqual(vm.issues.map((i) => `${i.bucket}:${i.file}:${i.line}`), ['fatal:src/a.c:3', 'major:src/a.c:20', 'minor:src/b.c:9']);
  assert.equal(vm.status, 'done');
  assert.equal(vm.scannedAt, 123);
  assert.deepEqual(vm.summary, { fatal: 1, major: 2, minor: 1, info: 0 });
  assert.equal(blockingCount(vm.summary), 3);
  assert.equal(vm.issues[0].rule, 'C-G1');
});

test('style scan: errors surface as an error state and long lists are capped', () => {
  const failed = buildScanVM(7, 'manual', result({ issues: [], error: { message: 'epiclang not found', notFound: true } }));
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'epiclang not found');
  const many = Array.from({ length: MAX_ISSUES + 25 }, (_, i) => ({ file: '/home/me/proj/f.c', line: i + 1, column: 1, bucket: 'minor' as const, message: 'x' }));
  const capped = buildScanVM(7, 'manual', result({ issues: many }));
  assert.equal(capped.issues.length, MAX_ISSUES);
  assert.equal(capped.truncated, true);
});

test('style scan: issue descriptions are single-line and bounded', () => {
  const text = describeIssue({ file: 'src/a.c', line: 3, column: 1, bucket: 'major', rule: 'C-F3', message: 'a very long message '.repeat(20) }, 60);
  assert.ok(text.length <= 60 && text.endsWith('…') && !text.includes('\n'));
  assert.match(describeIssue({ file: 'a.c', line: 1, column: 1, bucket: 'info', rule: null, message: 'm' }), /\[info\]/);
});

test('openFile paths cannot escape the project root', () => {
  assert.equal(resolveInside('/home/me/proj', 'src/a.c'), '/home/me/proj/src/a.c');
  assert.equal(resolveInside('/home/me/proj', '../secret'), null);
  assert.equal(resolveInside('/home/me/proj', 'src/../../secret'), null);
  assert.equal(resolveInside('/home/me/proj', '/etc/passwd'), null);
  assert.equal(resolveInside('/home/me/proj', ''), null);
  assert.equal(resolveInside('/home/me/proj', 'a\0b'), null);
  assert.equal(resolveInside('/home/me/proj', '.'), null);
});
