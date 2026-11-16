const test = require('node:test');
const assert = require('node:assert/strict');
const { CorrectionValidator, introducesDiagnostics } = require('../../dist-test/codingStyle/validation');
const { Limiter } = require('../../dist-test/codingStyle/limiter');
const { DEFAULT_SETTINGS } = require('../../dist-test/codingStyle/types');
const file = '/tmp/main.c';
const diagnostic = (ruleId, line = 1, extra = {}) => ({ file, line, column: 1, ruleId, bucket: 'minor', severity: 'warning', message: 'violation', notes: [], ...extra });
const result = (items = [], extra = {}) => ({ items, aborted: false, timedOut: false, exitCode: 0, durationMs: 1, projectRoot: '/tmp', source: '', detail: '', command: '', ...extra });
const request = { file, settings: DEFAULT_SETTINGS };

test('verification follows shifted lines but rejects new rules, occurrences and locations', () => {
    const before = 'int x=1;\nint y=2;\n';
    const after = '/* header */\nint x = 1;\nint y = 2;\n';
    assert.equal(introducesDiagnostics([diagnostic('C-L3')], [diagnostic('C-L3', 2)], before, after, file), false);
    assert.equal(introducesDiagnostics([diagnostic('C-L3')], [diagnostic('C-L6', 2)], before, after, file), true);
    assert.equal(introducesDiagnostics([diagnostic('C-L3')], [diagnostic('C-L3', 3)], before, after, file), true);
    assert.equal(introducesDiagnostics([diagnostic('C-L3')], [diagnostic('C-L3', 2), diagnostic('C-L3', 2)], before, after, file), true);
    assert.equal(introducesDiagnostics([diagnostic('C-L3')], [], before, after, file), false);
});

test('incomplete compiler results fail closed, including syntax errors in headers', async () => {
    for (const invalid of [{ timedOut: true }, { truncated: true }, { aborted: true }, { skipped: true }, { configError: 'bad config' },
        { exitCode: -1 }, { exitCode: 1 }, { unparsed: 'compiler failed' },
        { items: [diagnostic(undefined, 1, { file: '/tmp/header.h', bucket: undefined, severity: 'error' })] }]) {
        let calls = 0;
        const validator = new CorrectionValidator(new Limiter(1), async () => { calls++; return result([], invalid); });
        assert.equal(await validator.validate(request, 'before', 'after', new AbortController().signal), false);
        assert.equal(calls, 1);
    }
});

test('both sides are verified sequentially using complete unfiltered diagnostics', async () => {
    const calls = [];
    const validator = new CorrectionValidator(new Limiter(1), async req => {
        calls.push(req);
        return result(req.content === 'before' ? [diagnostic('C-L3')] : []);
    });
    assert.equal(await validator.validate(request, 'before', 'after', new AbortController().signal), true);
    assert.deepEqual(calls.map(c => c.content), ['before', 'after']);
    assert.ok(calls.every(c => c.verification));
});

test('validation shares concurrency, cancels queued work and does not spawn after cancellation', async () => {
    const limiter = new Limiter(1);
    let release;
    const busy = limiter.run(() => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    let scans = 0;
    const validator = new CorrectionValidator(limiter, async () => { scans++; return result(); });
    const controller = new AbortController();
    const pending = validator.validate(request, 'before', 'after', controller.signal);
    controller.abort();
    assert.equal(await pending, false);
    release(); await busy;
    assert.equal(scans, 0);
});

test('candidate failures and new violations never validate', async () => {
    for (const next of [result([diagnostic('C-L6')]), result([], { timedOut: true }), result([], { exitCode: -1 })]) {
        let calls = 0;
        const validator = new CorrectionValidator(new Limiter(1), async () => ++calls === 1 ? result() : next);
        assert.equal(await validator.validate(request, 'before', 'after', new AbortController().signal), false);
    }
});

test('identical lines and empty lines are anchored to code-token positions', () => {
    const source = 'work();\n\nwork();\n\nwork();\n';
    assert.equal(introducesDiagnostics([diagnostic('C-L6', 2)], [diagnostic('C-L6', 4)], source, source, file), true);
    assert.equal(introducesDiagnostics([diagnostic('C-L3', 1)], [diagnostic('C-L3', 3)], source, source, file), true);
});

test('exact-buffer baseline reuse avoids a compiler run but never uses filtered findings', async () => {
    let scans = 0;
    const validator = new CorrectionValidator(new Limiter(1), async () => { scans++; return result(); });
    validator.remember(request, 'int x;', result([], { allItems: [] }));
    assert.equal(await validator.validate(request, 'int x;', 'int x;\n', new AbortController().signal), true);
    assert.equal(scans, 1);
    validator.clear();
    scans = 0;
    assert.equal(await validator.validate(request, 'int x;', 'int x;\n', new AbortController().signal), true);
    assert.equal(scans, 2);
    validator.remember(request, 'int x;', result([], { allItems: [diagnostic(undefined, 1, { bucket: undefined, severity: 'error' })] }));
    scans = 0;
    await validator.validate(request, 'int x;', 'int x;\n', new AbortController().signal);
    assert.equal(scans, 2);
});

test('buffer or compiler changes invalidate baseline reuse; cosmetic changes do not', async () => {
    let scans = 0;
    const validator = new CorrectionValidator(new Limiter(1), async () => { scans++; return result(); });
    validator.remember(request, 'int x;', result([], { allItems: [] }));
    await validator.validate({ ...request, settings: { ...DEFAULT_SETTINGS, inline: { ...DEFAULT_SETTINGS.inline, gap: 2 } } }, 'int x;', 'int x;\n', new AbortController().signal);
    assert.equal(scans, 1);
    scans = 0;
    await validator.validate(request, 'int y;', 'int y;\n', new AbortController().signal);
    assert.equal(scans, 2);
    scans = 0;
    await validator.validate({ ...request, settings: { ...DEFAULT_SETTINGS, compiler: 'another' } }, 'int x;', 'int x;\n', new AbortController().signal);
    assert.equal(scans, 2);
});

test('token anchors track columns through whitespace edits and detect moves on one line', () => {
    const before = 'int x=1; int y=2;\n', after = 'int x = 1; int y = 2;\n';
    assert.equal(introducesDiagnostics([diagnostic('C-L3', 1, { column: 6 })], [diagnostic('C-L3', 1, { column: 7 })], before, after, file), false);
    assert.equal(introducesDiagnostics([diagnostic('C-L3', 1, { column: 6 })], [diagnostic('C-L3', 1, { column: 18 })], before, after, file), true);
});
