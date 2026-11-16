const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatterAsset, installFormatter, FORMATTER_RELEASE, FormatterToolchain } = require('../../dist-test/codingStyle/toolchain');

const asset = 'clang-format-21_linux-amd64';
const bytes = Buffer.from('test formatter payload');
const url = `https://github.com/cpp-linter/clang-tools-static-binaries/releases/download/${FORMATTER_RELEASE}/${asset}`;
function mockFetch(corrupt = false) {
    return async address => address.endsWith(FORMATTER_RELEASE)
        ? new Response(JSON.stringify({ tag_name: FORMATTER_RELEASE, immutable: true, assets: [{ name: asset, browser_download_url: url,
            digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') }] }))
        : new Response(corrupt ? Buffer.from('corrupted') : bytes);
}

test('platform mapping for Linux, WSL, macOS and Windows', () => {
    assert.equal(formatterAsset('linux', 'x64'), asset);
    assert.equal(formatterAsset('darwin', 'arm64'), 'clang-format-21_macos-arm64');
    assert.equal(formatterAsset('win32', 'x64'), 'clang-format-21_windows-amd64.exe');
    assert.throws(() => formatterAsset('linux', 'riscv64'), /unavailable/);
});

test('automatic installation verifies digest and publishes atomically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-tools-'));
    try {
        const file = await installFormatter(root, asset, mockFetch());
        assert.deepEqual(fs.readFileSync(file), bytes);
        assert.equal(fs.readdirSync(root).length, 2);
        assert.match(fs.readFileSync(file + '.sha256', 'utf8'), /^[a-f0-9]{64}$/);
        await assert.rejects(installFormatter(root, asset, mockFetch(true)), /checksum mismatch/);
        assert.deepEqual(fs.readFileSync(file), bytes);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unexpected release, missing asset and HTTP failures never create executable files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-tools-'));
    try {
        for (const response of [new Response('{}'), new Response(JSON.stringify({ tag_name: FORMATTER_RELEASE, immutable: true, assets: [] })), new Response('', { status: 503 })]) {
            await assert.rejects(installFormatter(root, asset, async () => response));
        }
        assert.deepEqual(fs.readdirSync(root), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('concurrent formatter preparation shares work and failures are rate-limited', async () => {
    let errors = 0;
    const toolchain = new FormatterToolchain('/unused', () => errors++);
    const first = toolchain.prepare('/missing/clang-format');
    assert.equal(first, toolchain.prepare('/missing/clang-format'));
    await assert.rejects(first);
    await assert.rejects(toolchain.prepare('/missing/clang-format'), /deferred/);
    assert.equal(errors, 1);
    toolchain.dispose();
});
