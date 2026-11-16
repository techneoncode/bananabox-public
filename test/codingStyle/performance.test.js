const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Limiter } = require('../../dist-test/codingStyle/limiter');
const { discoverIncludeDirs, clearProjectCaches } = require('../../dist-test/codingStyle/project');
const { globToRegExp } = require('../../dist-test/codingStyle/glob');
const { runProcess } = require('../../dist-test/codingStyle/runner');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('limiter obeys concurrency even when new jobs race with waking waiters', async () => {
    const limiter = new Limiter(2);
    let active = 0, peak = 0;
    const work = () => limiter.run(async () => { peak = Math.max(peak, ++active); await delay(2); active--; });
    await Promise.all(Array.from({ length: 50 }, work));
    assert.equal(peak, 2);
});

test('limiter cancellation removes queued work, and changing concurrency drains safely', async () => {
    const limiter = new Limiter(1);
    let release;
    const first = limiter.run(() => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    const controller = new AbortController();
    let ran = false;
    const second = limiter.run(async () => { ran = true; }, controller.signal);
    controller.abort();
    assert.equal(await second, undefined);
    assert.equal(ran, false);
    limiter.setMax(2);
    await limiter.run(async () => {});
    limiter.setMax(1);
    let thirdRan = false;
    const third = limiter.run(async () => { thirdRan = true; });
    await Promise.resolve();
    assert.equal(thirdRan, false);
    release();
    await Promise.all([first, third]);
    assert.equal(thirdRan, true);
});

test('include discovery is asynchronous, deduplicated, bounded and invalidated', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-discovery-'));
    try {
        for (let i = 0; i < 100; i++) {
            fs.mkdirSync(path.join(root, `include${i}`));
            fs.writeFileSync(path.join(root, `include${i}`, 'a.h'), '');
        }
        const first = discoverIncludeDirs(root);
        assert.equal(first, discoverIncludeDirs(root));
        let settled = false;
        first.then(() => { settled = true; });
        await Promise.resolve();
        assert.equal(settled, false);
        assert.equal((await first).length, 20);
        clearProjectCaches();
        assert.notEqual(discoverIncludeDirs(root), first);
        await discoverIncludeDirs(root);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('glob patterns reuse compiled expressions', () => {
    assert.equal(globToRegExp('**/*.c'), globToRegExp('**/*.c'));
});

test('pre-cancelled processes never spawn', async () => {
    const result = await runProcess('/missing/executable', [], { cwd: '/', timeoutMs: 100, signal: AbortSignal.abort() });
    assert.equal(result.aborted, true);
    assert.equal(result.stderr, '');
});

test('interactive scans have priority over queued project work', async () => {
    const limiter = new Limiter(1);
    const order = [];
    let release;
    const first = limiter.run(() => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    const project = limiter.run(async () => { order.push('project'); });
    const interactive = limiter.run(async () => { order.push('interactive'); }, new AbortController().signal, true);
    release();
    await Promise.all([first, project, interactive]);
    assert.deepEqual(order, ['interactive', 'project']);
});
