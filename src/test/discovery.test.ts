import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { discoverPlan, inferRecipe, parseMakefile, traceCommands } from '../delivery/discovery';
import { ReadinessService } from '../services/readinessService';
import { ReproductionService } from '../services/reproductionService';
import { gitBytes } from '../git/commitData';
import { createT } from '../shared/i18n';
import type { TestTask, StyleScanVM } from '../shared/types';
Object.assign(vscode.workspace, { isTrusted: true, textDocuments: [] });
const task = (name: string, trace = ''): TestTask => ({ name, trace, status: 'failed', count: 1, passed: 0, crashed: 0, mandatoryFailed: 0, steps: [] });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bb-autodetect-'));
  await gitBytes(root, ['init', '-b', 'main']);
  for (const name of ['task01', 'task02']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'main.c'), 'int main(void) { return 0; }\n');
    await writeFile(join(root, name, 'Makefile'), `NAME = ${name}\nSRC = main.c\nall: $(NAME)\n$(NAME): $(SRC)\n\tcc main.c -o $(NAME)\n`);
  }
  return root;
}
const style = (id: number): StyleScanVM => ({ projectId: id, status: 'done', source: 'manual', files: 2, summary: { fatal: 0, major: 0, minor: 0, info: 0 }, issues: [], truncated: false, durationMs: 0, scannedAt: Date.now(), error: null });

test('Makefile detection expands ordinary variables but never evaluates shell commands', () => {
  const parsed = parseMakefile('BINARY = task01\nNAME = $(BINARY)\nSRC = main.c \\\n util.c\nall: $(NAME)\n$(NAME): $(SRC)\ntests_run: all\n\t@echo ignored: target\n');
  assert.equal(parsed.name, 'task01'); assert.deepEqual(parsed.sources, ['main.c', 'util.c']);
  assert.ok(parsed.targets.includes('task01')); assert.ok(parsed.targets.includes('tests_run'));
  assert.equal(parseMakefile('NAME = $(shell touch /tmp/should-not-run)\n').name, null);
});

test('a project with one Makefile per task works without creating any configuration', async () => {
  const root = await fixture();
  const service = new ReadinessService(async id => style(id), createT('en'));
  try {
    const plan = await discoverPlan(root);
    assert.equal(plan.manual, false); assert.equal(plan.builds.length, 2);
    assert.deepEqual(plan.builds.map(c => c.command), [['make', '-C', 'task01'], ['make', '-C', 'task02']]);
    const checked = await service.check(1, root);
    assert.equal(checked?.checks.find(c => c.id === 'build')?.status, 'pass');
    assert.equal(checked?.stale, false);
    assert.equal(checked?.taskCount, 2); assert.equal(checked?.detected, true);
    const inferred = await inferRecipe(root, task('01 - task01'), plan);
    assert.deepEqual(inferred?.recipe.command, ['make', '-C', 'task01']); assert.equal(inferred?.mode, 'build');
    await assert.rejects(import('node:fs/promises').then(fs => fs.readFile(join(root, '.bananabox.json'))));
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('known task tests and grader binary invocations are reproduced automatically in the correct folder', async () => {
  const root = await fixture();
  const reproduce = new ReproductionService(createT('en'));
  try {
    const plan = await discoverPlan(root);
    const command = await inferRecipe(root, task('01 - task01', '~/.> make && ./task01'), plan);
    assert.equal(command?.mode, 'tests'); assert.equal(command?.recipe.cwd, 'task01');
    await reproduce.run(1, root, 1, '01 - task01', command!.recipe, undefined, command!.mode, true);
    assert.equal(reproduce.get(1)?.status, 'passed');
    await writeFile(join(root, 'task02', 'Makefile'), 'all:\n\t@true\ntests_run:\n\t@printf "test completed\\n"\n');
    const newPlan = await discoverPlan(root);
    assert.deepEqual(newPlan.tests[0].command, ['make', '-C', 'task02', 'tests_run']);
    const inferred = await inferRecipe(root, task('02 - task02'), newPlan);
    assert.deepEqual(inferred?.recipe.command, ['make', '-C', 'task02', 'tests_run']);
  } finally { reproduce.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('root Makefile avoids duplicate builds and missing sources declared in Makefile become actionable failures', async () => {
  const root = await fixture();
  const service = new ReadinessService(async id => style(id), createT('en'));
  try {
    await writeFile(join(root, 'Makefile'), 'SRC = missing.c\nall:\n\t@true\n');
    const plan = await discoverPlan(root);
    assert.deepEqual(plan.builds.map(c => c.command), [['make']]);
    assert.ok(plan.config.requiredFiles.includes('missing.c'));
    const checked = await service.check(1, root);
    assert.equal(checked?.checks.find(c => c.id === 'files')?.status, 'fail');
    assert.match(checked?.checks.find(c => c.id === 'files')?.detail ?? '', /missing.c/);
  } finally { service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('unrecognised grader shell commands are never executed, and ambiguous task matches do not guess a folder', async () => {
  const root = await fixture();
  try {
    assert.deepEqual(traceCommands('~/.> make && ./task01\n~/.> ./task01 $(touch secret)\n~/.> echo input | ./task01'), [['make'], ['./task01']]);
    const plan = await discoverPlan(root);
    assert.equal(await inferRecipe(root, task('unknown'), plan), null);
    const inferred = await inferRecipe(root, task('01 - task01', '~/.> rm -rf .\n~/.> /bin/sh -c dangerous'), plan);
    assert.deepEqual(inferred?.recipe.command, ['make', '-C', 'task01']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
