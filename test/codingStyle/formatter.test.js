const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { formatC, safeCandidate } = require('../../dist-test/codingStyle/formatter');
const options = { executable: process.env.CLANG_FORMAT || 'clang-format' };
const available = spawnSync(options.executable, ['--version']).status === 0;
const formatTest = (name, fn) => test(name, { skip: !available && 'Install clang-format 14–21 to run formatter integration tests' }, fn);

formatTest('formats braceless dangling else without altering control flow; idempotent', async () => {
    const input = 'int f(int a,int b){if(a) if(b) return(1); else return(2); return(3);}';
    const output = await formatC(input, options);
    assert.equal(output, 'int f(int a, int b)\n{\n    if (a)\n        if (b)\n            return (1);\n        else\n            return (2);\n    return (3);\n}\n');
    assert.ok(safeCandidate(input, output));
    assert.equal(await formatC(output, options), undefined);
    const clang = spawnSync('clang', ['--version']);
    if (clang.status === 0) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-ast-'));
        const file = path.join(dir, 'sample.c');
        const ast = source => {
            fs.writeFileSync(file, source);
            const result = spawnSync('clang', ['-x', 'c', '-fsyntax-only', '-Xclang', '-ast-dump=json', file], { encoding: 'utf8', timeout: 3000 });
            assert.equal(result.status, 0, result.stderr);
            return JSON.stringify(JSON.parse(result.stdout), (key, value) => ['id', 'loc', 'range'].includes(key) ? undefined : value);
        };
        try { assert.equal(ast(input), ast(output)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
});

formatTest('layout, operators, pointers, statements, function separation and EOF', async () => {
    const input = '\n\nint f(int * p,int n){for(int i=0;i<n;i++){p[i]+=1;}return * p;}\nint g(void){return 0;}   \n\n\n';
    const output = await formatC(input, options);
    assert.ok(output.startsWith('int f(int *p, int n)\n{\n'));
    assert.match(output, /for \(int i = 0; i < n; i\+\+\) \{/);
    assert.match(output, /p\[i\] \+= 1;/);
    assert.match(output, /return \*p;/);
    assert.match(output, /}\n\nint g/);
    assert.ok(output.endsWith('}\n'));
    assert.equal(await formatC(output, options), undefined);
});

formatTest('preserves comments, strings, includes and stringifying macro arguments', async () => {
    const input = '#include "z.h"\n#include "a.h"\n#define str(x) #x\nint f(void){puts(str(a+b));puts("{ if(x)  ; }");return 0;}\n';
    const output = await formatC(input, options);
    assert.ok(output.startsWith('#include "z.h"\n#include "a.h"'));
    assert.match(output, /str\(a\+b\)/);
    assert.match(output, /"\{ if\(x\)  ; }"/);
    assert.ok(safeCandidate(input, output));
});

formatTest('preprocessor indentation includes header guards and is idempotent', async () => {
    const input = '#ifndef H\n#define H\n#if A\n#include "a.h"\n#else\n#include "b.h"\n#endif\n#endif\n';
    const output = await formatC(input, options);
    assert.equal(output, '#ifndef H\n    #define H\n    #if A\n        #include "a.h"\n    #else\n        #include "b.h"\n    #endif\n#endif\n');
    assert.equal(await formatC(output, options), undefined);
});

formatTest('CRLF and missing final newline', async () => {
    assert.equal(await formatC('int x;\r\n', options), 'int x;\n');
    assert.equal(await formatC('int x;', options), 'int x;\n');
});

test('unsafe or oversized inputs and cancelled jobs are skipped before spawning', async () => {
    for (const source of ['#define X \\\n  1\n', 'int x = __LINE__;\n', '??=define X 1\n', 'int x; // clang-format off\n', ' '.repeat(300000)]) {
        assert.equal(await formatC(source, { executable: '/does/not/exist' }), undefined);
    }
    assert.equal(await formatC('int x;', { executable: '/does/not/exist', signal: AbortSignal.abort() }), undefined);
});

test('guard rejects changed tokens, merged operators, literals, comments and directives', () => {
    for (const [a, b] of [['x + +y;', 'x++y;'], ['puts("a b");', 'puts("ab");'], ['/* a */ x;', '/* b */ x;'], ['#define F(x) x\n', '#define F (x) x\n'], ['x=1e+2;', 'x=1e +2;'], ['if(x) f();', 'if(x) {f();}']]) {
        assert.equal(safeCandidate(a, b), false, a);
    }
});

test('missing formatter rejects without returning a partial edit', async () => {
    await assert.rejects(formatC('int x;', { executable: '/does/not/exist' }));
});

formatTest('unfinished code does not yield an edit', async () => {
    await assert.rejects(formatC('int f(void) { if (', options));
});

formatTest('imported lowercase whitespace-sensitive macro can be protected explicitly', async () => {
    const output = await formatC('const char *s=stringify(a+b);', { ...options, whitespaceSensitiveMacros: ['stringify'] });
    assert.match(output, /stringify\(a\+b\)/);
});

test('unterminated comments are skipped in bounded time', async () => {
    assert.equal(await formatC('/* '.repeat(50000), { executable: '/does/not/exist' }), undefined);
});

test('slow and cancelled formatters terminate without edits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-slow-'));
    const file = path.join(dir, 'formatter');
    fs.writeFileSync(file, `#!${process.execPath}\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
    try {
        await assert.rejects(formatC('int x;', { executable: file, timeoutMs: 40 }), /budget/);
        const controller = new AbortController();
        const pending = formatC('int x;', { executable: file, signal: controller.signal });
        setTimeout(() => controller.abort(), 30);
        await assert.rejects(pending, /cancelled/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

formatTest('C-L6 removes the blank line in delete_current_node without changing tokens', async () => {
    const source = `static void delete_current_node(
    linked_list_t **begin, linked_list_t **current, linked_list_t *prev)
{
    if (prev == NULL)
        *begin = (*current)->next;
    else
        prev->next = (*current)->next;
    free(*current);
    
    *current = (prev == NULL) ? *begin : prev->next;
}
`;
    const result = await formatC(source, options);
    assert.match(result, /free\(\*current\);\n    \*current =/);
    assert.ok(safeCandidate(source, result));
    assert.equal(await formatC(result, options), undefined);
});

formatTest('C-L6 preserves declaration separation, comments and function separation', async () => {
    const source = `void f(void)
{
    custom_type value;

    use(value);
    /* A comment

       with an intentional blank line. */

    done();
}

void g(void)
{
    work();

    done();
}
`;
    const result = await formatC(source, options);
    assert.match(result, /custom_type value;\n\n    use\(value\);/);
    assert.match(result, /A comment\n\n       with an intentional blank line/);
    assert.match(result, /}\n\nvoid g/);
    assert.match(result, /work\(\);\n    done\(\);/);
    assert.ok(safeCandidate(source, result));
});

test('C-L6 leaves macro-sensitive and conditional bodies unchanged', () => {
    const { removeStatementBlankLines } = require('../../dist-test/codingStyle/blankLines');
    for (const code of ['void f(void)\n{\n    work();\n\n    SENSITIVE(x);\n}\n', 'void f(void)\n{\n    work();\n#if X\n\n    done();\n#endif\n}\n']) {
        assert.equal(removeStatementBlankLines(code, new Set(['SENSITIVE'])), code);
    }
});

test('C-L6 preserves declaration separators in nested blocks and multiline initializers', () => {
    const { removeStatementBlankLines } = require('../../dist-test/codingStyle/blankLines');
    for (const body of [
        '    int pos = 24;\n\n    sprite.setTexture();',
        '    int pos =\n        get_pos();\n\n    use(pos);',
        '    int values[] = {\n        get_pos(),\n        24,\n    };\n\n    use(values);',
        '    work();\n    if (ready) {\n        int pos = 24;\n\n        sprite.setTexture();\n    }',
    ]) {
        const source = `void f(void)\n{\n${body}\n}\n`;
        assert.equal(removeStatementBlankLines(source, new Set()), source);
    }
});

formatTest('C-L6 formatting keeps nested declaration separators and converges', async () => {
    const source = 'void f(void)\n{\n    work();\n    if(ready) {\n        int pos=24;\n\n        sprite.setTexture();\n    }\n\n    done();\n}\n';
    const result = await formatC(source, options);
    assert.match(result, /int pos = 24;\n\n        sprite\.setTexture\(\);/);
    assert.match(result, /}\n    done\(\);/);
    assert.ok(safeCandidate(source, result));
    assert.equal(await formatC(result, options), undefined);
});

test('proposal explanations describe blank lines, whitespace and indentation without source snippets', () => {
    const { describeCorrections } = require('../../dist-test/codingStyle/correctionDescriptions');
    assert.deepEqual(describeCorrections('    free(p);\n    \n    next();\n', '    free(p);\n    next();\n'), ['Removing the blank line', 'Removing trailing whitespace']);
    assert.deepEqual(describeCorrections('call();  \n', 'call();\n'), ['Removing trailing whitespace']);
    assert.deepEqual(describeCorrections('  call();\n', '    call();\n'), ['Correcting indentation']);
    assert.deepEqual(describeCorrections('call(a,b);\n', 'call(a, b);\n'), ['Correcting spacing']);
});

test('C-G1 fills a missing header from the project and filename without altering the body', () => {
    const { addEpitechHeader } = require('../../dist-test/codingStyle/header');
    const source = '#include "env.h"\n\nint env_get_setter(void)\n{\n    return (0);\n}\n';
    const result = addEpitechHeader(source, '/projects/mysh/src/env_get_setter.c', '/projects/mysh', 2026);
    assert.equal(result, '/*\n** EPITECH PROJECT, 2026\n** mysh\n** File description:\n** Env get setter\n*/\n\n' + source);
    assert.equal(addEpitechHeader(result, '/projects/mysh/src/env_get_setter.c', '/projects/mysh', 2027), result);
    assert.match(addEpitechHeader('', '/projects/mysh/include/env.h', '/projects/mysh', 2026), /\*\* Env\n/);
});

test('C-G1 preserves existing headers, leading licenses, CRLF, BOM and protected code', () => {
    const { addEpitechHeader } = require('../../dist-test/codingStyle/header');
    const add = source => addEpitechHeader(source, '/repo/main.c', '/repo', 2026);
    const existing = '/*\n** EPITECH PROJECT, 2020\n** Custom project and description\n*/\n\nint x;\n';
    assert.equal(add(existing), existing);
    assert.equal(add('/* License */\n' + existing), '/* License */\n' + existing);
    assert.ok(add('/* License */\nint x;\n').endsWith('/* License */\nint x;\n'));
    const windows = '\uFEFFint x;\r\n';
    const result = add(windows);
    assert.ok(result.startsWith('\uFEFF/*\r\n'));
    assert.ok(result.endsWith('int x;\r\n'));
    assert.ok(!/(?<!\r)\n/.test(result));
    for (const input of ['int line = __LINE__;\n', '#line 20\nint x;\n', '/* unfinished', 'char *s = "unfinished', '// clang-format off\nint x;', 'x'.repeat(300000)]) {
        assert.equal(add(input), input);
    }
    const unsafeName = addEpitechHeader('int x;\n', '/repo/evil\nname.c', '/repo/project\nname', 2026);
    assert.match(unsafeName, /\*\* project name\n/);
    assert.match(unsafeName, /\*\* Evil name\n/);
});

formatTest('C-G1 and layout corrections converge after one save', async () => {
    const { addEpitechHeader } = require('../../dist-test/codingStyle/header');
    const source = 'int main(void){return(0);}';
    const formatted = await formatC(source, options);
    const result = addEpitechHeader(formatted, '/repo/main.c', '/repo', 2026);
    assert.equal(await formatC(result, options), undefined);
    assert.equal(addEpitechHeader(result, '/repo/main.c', '/repo', 2026), result);
});
