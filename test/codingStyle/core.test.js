const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseEpiclangOutput, summarize } = require('../../dist-test/codingStyle/parser.js');
const { computeRange, utf8ColumnToIndex } = require('../../dist-test/codingStyle/ranges.js');
const { shellSplit, splitCommandChain } = require('../../dist-test/codingStyle/shell.js');
const { sanitizeFlags } = require('../../dist-test/codingStyle/flags.js');
const { parseJsonc } = require('../../dist-test/codingStyle/jsonc.js');
const { matchesAny } = require('../../dist-test/codingStyle/glob.js');
const project = require('../../dist-test/codingStyle/project.js');
const { lintFile, cleanupTempFiles } = require('../../dist-test/codingStyle/engine.js');
const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types.js');
const { resolveExecutable } = require('../../dist-test/codingStyle/invocation.js');

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'epiclang-sample.txt'), 'utf8');

test('parser: levels, rules, ranges, dedupe, notes', () => {
    const r = parseEpiclangOutput(sample, '/tmp/p');
    assert.equal(r.length, 6); // duplicate C-G7 removed, note not counted
    assert.equal(r[0].bucket, undefined);
    assert.equal(r[1].level, 'Major');
    assert.equal(r[1].ruleId, 'C-C1');
    assert.equal(r[1].message, 'nested while statement at depth 3');
    assert.equal(r[1].severity, 'error');
    assert.equal(r[1].rangeLength, 22);
    assert.equal(r[1].rangeStartColumn, 13);
    assert.equal(r[2].rangeLength, undefined); // single caret only
    assert.equal(r[3].bucket, 'fatal'); // Critical counted as fatal
    assert.equal(r[3].severity, 'error');
    assert.equal(r[4].ruleId, 'C-G7');
    assert.equal(r[5].clangOption, '-Wunused-variable');
    assert.equal(r[5].notes.length, 1);
    assert.equal(r[5].notes[0].message, 'declared here');
    assert.deepEqual(summarize(r), { fatal: 1, major: 1, minor: 2, info: 0, other: 2, functions: 0 });
});

test('parser: strips ANSI, maps temp aliases, caret without gutter', () => {
    const out = '\u001b[1m/tmp/x/a.c:2:3: \u001b[0mwarning: [Banana] [Minor] trailing space (C-G7)\n  foo \n  ^~~\n';
    const r = parseEpiclangOutput(out.replace(/\u001b\[[0-9;]*m/g, (m) => m), '/', new Map([['/tmp/x/a.c', '/real/a.c']]));
    assert.equal(r.length, 1);
    assert.equal(r[0].file, '/real/a.c');
    assert.equal(r[0].rangeLength, 3);
});

test('ranges: token, trailing spaces, line-level, utf8 columns, long lines', () => {
    assert.deepEqual(computeRange('    while (x) {', { column: 5, message: 'nested while' }), { start: 4, end: 9 });
    assert.deepEqual(computeRange('int a;   ', { column: 7, message: 'trailing space' }), { start: 6, end: 9 });
    assert.deepEqual(computeRange('  int   x ;', { column: 1, message: 'bad' }), { start: 2, end: 11 });
    assert.deepEqual(computeRange('abcdef', { column: 4, message: 'line too long' }), { start: 3, end: 6 });
    assert.deepEqual(computeRange('', { column: 1, message: 'x' }), { start: 0, end: 0 });
    assert.equal(utf8ColumnToIndex('é = 1;', 4), 2); // 'é' is 2 bytes
    assert.deepEqual(computeRange('x', { column: 1, message: 'y', rangeStartColumn: 1, rangeLength: 5 }), { start: 0, end: 1 });
});

test('shell: split and chain', () => {
    assert.deepEqual(shellSplit(`gcc -DNAME="a b" 'x y.c' -I\\ inc`), ['gcc', '-DNAME=a b', 'x y.c', '-I inc']);
    assert.deepEqual(splitCommandChain('cd a && gcc x.c; echo "a && b"'), ['cd a', 'gcc x.c', 'echo "a && b"']);
});

test('flags: keeps parse flags, drops build/link flags, absolutises -I', () => {
    const out = sanitizeFlags(
        ['-Wall', '-Wextra', '-Werror', '-O2', '-g3', '-I', 'include', '-Ilib/my', '-DX=1', '-D', 'Y', '-MMD', '-MF', 'a.d', '-c', 'main.c', '-o', 'main.o', '-lm', '-L.', '-std=gnu11', '-fPIC', '-fno-builtin'],
        '/proj', true);
    assert.deepEqual(out, ['-Wall', '-Wextra', '-I', '/proj/include', '-I/proj/lib/my', '-DX=1', '-D', 'Y', '-std=gnu11', '-fno-builtin']);
    assert.deepEqual(sanitizeFlags(['-Xclang', 'foo', 'a.c', '-L', 'x', '-lmy'], '/p', false), ['-Xclang', 'foo']);
});

test('jsonc + glob', () => {
    assert.deepEqual(parseJsonc('{ // c\n "a": [1, 2,], /* x */ "b": "//no" }'), { a: [1, 2], b: '//no' });
    assert.ok(matchesAny(['tests/**', '**/*.tmp'], 'tests/a/b.c'));
    assert.ok(matchesAny(['**/node_modules/**'], 'x/node_modules/y.c'));
    assert.ok(!matchesAny(['tests/**'], 'src/tests.c'));
    assert.ok(matchesAny(['src/*.{c,h}'], 'src/a.h'));
});

function makeProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-proj-'));
    const mk = (f, c = '') => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
    mk('.git/HEAD');
    mk('Makefile', 'CFLAGS += -Wall -I./include -Ilib/my/inc \\\n  -DDEBUG\nSRC = src/main.c\n');
    mk('include/my.h', '#pragma once\n');
    mk('lib/my/inc/lib.h', '');
    mk('lib/my/Makefile', 'all:\n');
    mk('lib/my/str.c', 'int x;\n');
    mk('src/main.c', 'int main(void)\n{\n    while (1) {}\n}\n');
    mk('src/deep/extra.h', '');
    return root;
}

test('CLion CMake profiles supply compile flags while explicit root databases retain precedence', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-clion-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'main.c');
    fs.mkdirSync(path.join(root, 'cmake-build-debug'));
    fs.writeFileSync(path.join(root, 'cmake-build-debug', 'compile_commands.json'), JSON.stringify([
        { file, directory: root, arguments: ['cc', '-DCLION_PROFILE', '-Iinclude', '-c', file] },
    ]));
    assert.deepEqual(project.findCompileCommandsEntry(root, file), { directory: root, tokens: ['-DCLION_PROFILE', '-Iinclude', '-c', file] });
    fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify([
        { file, directory: root, arguments: ['cc', '-DROOT_PROFILE', '-c', file] },
    ]));
    assert.ok(project.findCompileCommandsEntry(root, file).tokens.includes('-DROOT_PROFILE'));
    assert.equal(project.findCompileCommandsEntry(root, path.join(root, 'absent.c')), undefined);
});

test('project root: nearest git repo beats nested Makefile', () => {
    const root = makeProject();
    assert.equal(project.detectProjectRoot(path.join(root, 'lib/my/str.c'), root), fs.realpathSync(root) === root ? root : root);
    // multi-project workspace: workspace has no marker, project folder has .git
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ws-'));
    fs.mkdirSync(path.join(ws, 'a/src'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'a/.git'));
    assert.equal(project.detectProjectRoot(path.join(ws, 'a/src/x.c'), ws), path.join(ws, 'a'));
});

test('project: include discovery and Makefile harvest', async () => {
    const root = makeProject();
    const dirs = await project.discoverIncludeDirs(root);
    assert.equal(dirs[0], path.join(root, 'include'));
    assert.ok(dirs.includes(path.join(root, 'lib/my/inc')));
    assert.ok(dirs.includes(path.join(root, 'src/deep')));
    const h = project.harvestMakefileFlags(root);
    assert.deepEqual(h.includeDirs, [path.join(root, 'include'), path.join(root, 'lib/my/inc')]);
    assert.deepEqual(h.defines, ['-DDEBUG']);
});

const fake = path.join(__dirname, 'fake-epiclang.sh');
const settings = (extra = {}) => ({ ...DEFAULT_SETTINGS, compiler: fake, ...extra });

test('engine: zero-config run, flags, diagnostics mapped to the file', async () => {
    const root = makeProject();
    const log = path.join(root, 'args.log');
    process.env.FAKE_LOG = log;
    const file = path.join(root, 'src/main.c');
    const res = await lintFile({ file, workspaceRoot: root, settings: settings() });
    assert.equal(res.projectRoot, root);
    assert.equal(res.source, 'auto');
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].ruleId, 'C-C1');
    assert.equal(res.items[0].rangeLength, 9);
    const args = fs.readFileSync(log, 'utf8').trim();
    assert.match(args, /-fsyntax-only/);
    assert.match(args, new RegExp(`-I${root}/include`));
    assert.match(args, new RegExp(`-I${root}/lib/my/inc`));
    assert.match(args, /-DDEBUG/);
    assert.ok(args.endsWith(file));
    assert.ok(!/ -o /.test(args));
});

test('engine: unsaved buffer goes through a temp copy and maps back', async () => {
    const root = makeProject();
    process.env.FAKE_LOG = path.join(root, 'args.log');
    const file = path.join(root, 'src/main.c');
    const res = await lintFile({ file, workspaceRoot: root, content: 'while (1) {}\n', settings: settings() });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].file, file);
    const args = fs.readFileSync(path.join(root, 'args.log'), 'utf8');
    assert.match(args, new RegExp(`-I${path.join(root, 'src')}`)); // quote includes still resolve
    assert.ok(!args.trim().endsWith(file));                        // ran on the copy
    cleanupTempFiles();
});

test('engine: compile_commands.json flags run through epiclang, build flags dropped', async () => {
    const root = makeProject();
    process.env.FAKE_LOG = path.join(root, 'args.log');
    const file = path.join(root, 'src/main.c');
    fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify([
        { directory: root, file: 'src/main.c', command: `gcc -Wall -O2 -Iinclude -DFOO="a b" -MMD -MF m.d -c src/main.c -o main.o` },
    ]));
    const res = await lintFile({ file, workspaceRoot: root, settings: settings() });
    assert.equal(res.source, 'compile_commands');
    const args = fs.readFileSync(path.join(root, 'args.log'), 'utf8');
    assert.match(args, new RegExp(`-I${root}/include`));
    assert.doesNotMatch(args, /-O2|-MMD|main\.o|gcc/);
});

test('engine: .bananalens.json exclude, extraArgs, abort and timeout', async () => {
    const root = makeProject();
    process.env.FAKE_LOG = path.join(root, 'args.log');
    fs.writeFileSync(path.join(root, '.bananalens.json'), '{ // comment\n "exclude": ["lib/**"], "extraArgs": ["-DX"], }');
    const skipped = await lintFile({ file: path.join(root, 'lib/my/str.c'), workspaceRoot: root, settings: settings() });
    assert.equal(skipped.skipped, true);
    await lintFile({ file: path.join(root, 'src/main.c'), workspaceRoot: root, settings: settings() });
    assert.match(fs.readFileSync(path.join(root, 'args.log'), 'utf8'), /-DX/);

    process.env.FAKE_SLEEP = '5';
    const ac = new AbortController();
    const pending = lintFile({ file: path.join(root, 'src/main.c'), workspaceRoot: root, settings: settings(), signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const aborted = await pending;
    assert.equal(aborted.aborted, true);
    assert.ok(aborted.durationMs < 3000);
    const timedOut = await lintFile({ file: path.join(root, 'src/main.c'), workspaceRoot: root, settings: settings({ timeoutMs: 200 }) });
    assert.equal(timedOut.timedOut, true);
    delete process.env.FAKE_SLEEP;
});

test('engine: missing epiclang gives a clear error', () => {
    assert.throws(() => resolveExecutable('definitely-not-epiclang', '/nonexistent'), /Cannot find/);
});

test('engine: concurrent buffers for the same file use isolated, cleaned temp files', async () => {
    const root = makeProject();
    const compiler = path.join(root, 'read-buffer');
    fs.writeFileSync(compiler, '#!/bin/sh\nfor last; do :; done\nsleep 0.03\nprintf "%s:1:1: warning: %s\\n" "$last" "$(cat "$last")" >&2\n', { mode: 0o755 });
    const file = path.join(root, 'src/main.c');
    const results = await Promise.all(['FIRST', 'SECOND'].map(content => lintFile({ file, workspaceRoot: root, content, settings: settings({ compiler }) })));
    assert.deepEqual(results.map(r => r.items[0].message), ['FIRST', 'SECOND']);
    for (const result of results) {
        const temporary = result.command.split(' ').at(-1);
        assert.equal(fs.existsSync(temporary), false);
    }
    fs.rmSync(root, { recursive: true, force: true });
});
