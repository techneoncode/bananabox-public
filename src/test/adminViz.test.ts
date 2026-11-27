import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, topWithOther, type Box } from '../webview/adminViz';

test('topWithOther keeps every slice up to 8, folds the rest into Other and colours by name, not size', () => {
  const few = topWithOther([{ label: 'b', value: 5 }, { label: 'a', value: 9 }, { label: 'z', value: 0 }], 'Other');
  assert.deepEqual(few.map((s) => [s.label, s.slot]), [['a', 1], ['b', 2]], 'empty slices are dropped');

  const many = topWithOther(Array.from({ length: 10 }, (_, i) => ({ label: `c${i}`, value: 100 - i })), 'Other');
  assert.equal(many.length, 8);
  assert.deepEqual(many.at(-1), { label: 'Other', value: 93 + 92 + 91, slot: null });
  assert.deepEqual(many.slice(0, 7).map((s) => s.slot).sort(), [1, 2, 3, 4, 5, 6, 7], 'each kept slice has its own slot');

  const resized = topWithOther([{ label: 'a', value: 1 }, { label: 'b', value: 50 }], 'Other');
  assert.equal(resized.find((s) => s.label === 'a')!.slot, 1, 'a keeps its colour when it becomes the smallest');
  assert.deepEqual(topWithOther([], 'Other'), []);
});

test('the treemap layout fills the box exactly, with areas proportional to the values', () => {
  const box: Box = { x: 0, y: 0, w: 300, h: 170 };
  const items = [40, 25, 15, 10, 6, 3, 1].map((value, i) => ({ label: String(i), value }));
  const out: Array<(typeof items)[number] & Box> = [];
  layout(items, box, out);
  assert.equal(out.length, items.length);
  const area = (b: Box) => b.w * b.h;
  assert.ok(Math.abs(out.reduce((n, b) => n + area(b), 0) - area(box)) < 1e-6);
  for (const b of out) {
    assert.ok(Math.abs(area(b) / area(box) - b.value / 100) < 1e-9, `tile ${b.label}`);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 300 + 1e-9 && b.y + b.h <= 170 + 1e-9);
  }

  const single: Array<{ value: number } & Box> = [];
  layout([{ value: 7 }], box, single);
  assert.deepEqual(single, [{ value: 7, ...box }]);
  const zeros: Array<{ value: number } & Box> = [];
  layout([{ value: 0 }, { value: 0 }], box, zeros);
  assert.ok(zeros.every((b) => Number.isFinite(b.w) && Number.isFinite(b.h)), 'no NaN when everything is zero');
});

test('byPerson folds one student on two computers into one person, latest computer first', async () => {
  const { byPerson } = await import('../webview/adminViz');
  const user = (user_id: string, last_seen: number, first_name: string | null = 'Niels') => ({
    user_id, first_name, last_initial: first_name && 'C', promotion: 2031, cursus: 'pge', campus: 'Strasbourg', version: '2.1.2', last_seen, launches: 1,
  });
  const groups = byPerson([user('a', 1), user('b', 3), user('c', 2, 'Alex'), user('d', 4, null), user('e', 5, null)]);
  assert.deepEqual(groups.map((g) => g.map((u) => u.user_id)), [['b', 'a'], ['c'], ['d'], ['e']], 'unnamed installs never merge');
});
