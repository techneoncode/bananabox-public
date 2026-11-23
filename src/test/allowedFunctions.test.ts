import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDisallowedCalls, isTestPath, parseAuthorizedFunctions, pickSubjectForFunctions, projectNames } from '../domain/allowedFunctions';
import { SubjectFunctions } from '../services/subjectFunctions';
import type { ProjectVM } from '../shared/types';

// As pdf.js extracts it from an Epitech subject: the ✓ dingbat comes out as "3".
const MY_LS = `Authorized Functions
The only system calls and libc function allowed are the following ones:
3 opendir, readdir, closedir, stat, lstat, write,
3 getpwuid, getgrgid, time, ctime, readlink,
3 va_start, va_arg, va_end,
3 malloc, free, perror, strerror, exit
3 gnu_dev_major, gnu_dev_minor
Bonus
Unlike the real ls, column formatting is not required and should be treated as a bonus.`;

test('subject: the "Authorized functions" list is read whole and stops at the next section', () => {
  assert.deepEqual(parseAuthorizedFunctions(`MY_LS\nbinary name: my_ls\n${MY_LS}`), ['opendir', 'readdir', 'closedir', 'stat', 'lstat', 'write', 'getpwuid', 'getgrgid', 'time', 'ctime', 'readlink',
    'va_start', 'va_arg', 'va_end', 'malloc', 'free', 'perror', 'strerror', 'exit', 'gnu_dev_major', 'gnu_dev_minor']);
});

test('subject: my_hunter lists libc calls one per line and allows whole libraries', () => {
  const text = pdfLike();
  const names = parseAuthorizedFunctions(text)!;
  for (const n of ['malloc', 'srand', 'time', 'open', 'fopen', 'fread', 'fclose', 'getline', 'sf*', 'sqrt', 'cosf']) assert.ok(names.includes(n), n);
  const calls = findDisallowedCalls([{ file: 'a.c', text: 'int main(void) { sfRenderWindow_create(m, "a", 0, 0); sqrtf(2); fopen("x", "r"); printf("x"); }' }], new Set(names));
  assert.deepEqual(calls.map(c => c.message), ['printf']);
  function pdfLike() {
    return `Authorized functions\nHere is the full list of authorized functions.\n\nfrom the C library\n\n\n   3 malloc\n   3 free\n   3 memset\n   3 rand\n   3 srand\n
   3 time (only with srand)\n   3 (f)open\n   3 (f)read\n   3 (f)write\n   3 (f)close\n   3 getline\n\n\nfrom the CSFML library\nAll functions\n\nfrom the math library\nAll functions\n\n\n\nDelivery`;
  }
});

test('subject: exceptions to a wildcard stay disallowed (my_radar)', () => {
  const names = parseAuthorizedFunctions('Authorized functions\nfrom the CSFML library\n3 sfClock_*\n3 sfShape_* (except _getLocalBounds and _getGlobalBounds)\nfrom the math library\nAll functions')!;
  assert.ok(names.includes('sfShape_*') && names.includes('!sfShape_getLocalBounds') && names.includes('!sfShape_getGlobalBounds'));
  const calls = findDisallowedCalls([{ file: 'a.c', text: 'int main(void) { sfShape_setPosition(s, p); sfShape_getGlobalBounds(s); sfClock_create(); }' }], new Set(names));
  assert.deepEqual(calls.map(c => c.message), ['sfShape_getGlobalBounds']);
});

test('subject: other wordings of the list are understood; no list means null', () => {
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions: malloc, free, write(2).\nDelivery'), ['malloc', 'free', 'write']);
  assert.deepEqual(parseAuthorizedFunctions('ALLOWED FUNCTIONS\n✓ open, read,\nclose, write\nRequirements'), ['open', 'read', 'close', 'write']);
  assert.deepEqual(parseAuthorizedFunctions('Authorised functions\n• malloc\n• free\nThe project'), ['malloc', 'free']);
  assert.equal(parseAuthorizedFunctions('Introduction\nYou may use any function of the libc.'), null);
  assert.equal(parseAuthorizedFunctions('Authorized functions\nEverything in the libc is authorized, except printf.\nDelivery\nMore text\nAnd more\nStill more'), null);
});

test('subject: "Allowed system function(s)" and "system calls" headings are read', () => {
  assert.deepEqual(parseAuthorizedFunctions('Allowed system function(s): write, malloc, free\nDelivery'), ['write', 'malloc', 'free']);
  assert.deepEqual(parseAuthorizedFunctions('Allowed system calls:\nwrite, malloc\nDelivery'), ['write', 'malloc']);
  assert.deepEqual(parseAuthorizedFunctions('Authorized syscalls\nwrite, malloc\nDelivery'), ['write', 'malloc']);
  assert.deepEqual(parseAuthorizedFunctions('Fonctions autorisées : write, malloc\nLivrables'), ['write', 'malloc']);
});

test('subject: a single inline function under a heading is read', () => {
  assert.deepEqual(parseAuthorizedFunctions('Allowed system function(s): write\nDelivery'), ['write']);
});

test('subject: "The only allowed ... is/are" sentences are read', () => {
  assert.deepEqual(parseAuthorizedFunctions('The only allowed system call for this project is write.'), ['write']);
  assert.deepEqual(parseAuthorizedFunctions('The only allowed functions are write, malloc and free.'), ['write', 'malloc', 'free']);
});

test('subject: "The whole libC is forbidden, except ..." lists the allowed functions, also when wrapped', () => {
  assert.deepEqual(parseAuthorizedFunctions('The whole libC is forbidden, except write, va_start, va_arg, va_end, malloc, free.'),
    ['write', 'va_start', 'va_arg', 'va_end', 'malloc', 'free']);
  assert.deepEqual(parseAuthorizedFunctions('The whole libC is forbidden, except write, va_start, va_arg,\nva_end, malloc, free.'),
    ['write', 'va_start', 'va_arg', 'va_end', 'malloc', 'free']);
  assert.deepEqual(parseAuthorizedFunctions('La libC est interdite, sauf write, malloc.'), ['write', 'malloc']);
});

test('subject: "You are only allowed to use the X function" is read mid-line', () => {
  assert.deepEqual(parseAuthorizedFunctions('- You are only allowed to use the my_putchar function to complete the following tasks, but don\'t push'), ['my_putchar']);
});

test('subject: "The following functions are allowed:" is read', () => {
  assert.deepEqual(parseAuthorizedFunctions('The following functions are allowed: write, malloc'), ['write', 'malloc']);
});

test('subject: a "libc minus" or "all libc" heading is not read, nor the forbidden list after it', () => {
  assert.equal(parseAuthorizedFunctions('Authorized functions: All the libC minus forbidden functions.\nForbidden functions: getpw*, *getsp*, getgr*, *fork*, *clone*, openat*, getpass, getlogin*, cuserid,\nsystem'), null);
  assert.equal(parseAuthorizedFunctions('Authorized functions: All the libC minus forbidden functions.\nForbidden functions: system, fork, execve'), null);
});

test('subject: a forbidden line ends a continued list', () => {
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions:\nwrite, malloc,\nForbidden: system, fork, execve'), ['write', 'malloc']);
  assert.equal(parseAuthorizedFunctions('Authorized functions:\nForbidden: system, fork, execve'), null);
});

test('subject: a lone lowercase name under a "...:" heading is read; stopwords and capitalized words are not', () => {
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions:\nwrite\nDelivery'), ['write']);
  assert.equal(parseAuthorizedFunctions('Authorized functions:\nnone\nDelivery'), null);
  assert.equal(parseAuthorizedFunctions('Authorized functions:\nWrite\nDelivery'), null);
});

test('subject: list items may end in a wildcard, and "and"/"or" separate the last two', () => {
  assert.deepEqual(parseAuthorizedFunctions('Allowed functions: sf*, malloc\nDelivery'), ['sf*', 'malloc']);
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions: write, malloc, and free\nDelivery'), ['write', 'malloc', 'free']);
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions: write or malloc.\nDelivery'), ['write', 'malloc']);
  assert.deepEqual(parseAuthorizedFunctions('Authorized functions: write, malloc;\nDelivery'), ['write', 'malloc']);
});

const files = [
  { file: 'lib/my/my_putstr.c', text: '#include <unistd.h>\nint my_putstr(char const *s)\n{\n    return write(1, s, my_strlen(s));\n}\n' },
  { file: 'include/my.h', text: '#ifndef MY_H\n#define MY_H\n#define MAX(a, b) ((a) > (b) ? (a) : (b))\nint my_strlen(char const *str);\nint my_putstr(char const *);\n#endif\n' },
  { file: 'src/main.c', text: [
    '#include <dirent.h>',
    '#include "my.h"',
    'static int helper(int x);',
    'typedef struct ops { int (*run)(int); } ops_t;',
    'static int apply(int (*cmp)(int, int), int a, int b)',
    '{',
    '    return cmp(a, b);',
    '}',
    'int main(int ac, char **av)',
    '{',
    '    DIR *dir = opendir(av[1]); // printf("ignored")',
    '    ops_t *ops = 0;',
    '    if (S_ISDIR(ac) || sizeof(int) == 4)',
    '        printf("%d\\n", MAX(ac, 2));',
    '    ops->run(1);',
    '    if (strlen("printf(") > 0)',
    '        my_putstr("hello");',
    '    return helper(apply(0, 1, 2));',
    '}',
    'static int helper(int x)',
    '{',
    '    return x;',
    '}',
  ].join('\n') },
];

test('code: calls outside the list are found; the project\'s own functions, macros, pointers and keywords are not', () => {
  const allowed = new Set(['opendir', 'write']);
  const found = findDisallowedCalls(files, allowed);
  assert.deepEqual(found.map(v => `${v.file}:${v.line} ${v.message}`), ['src/main.c:14 printf', 'src/main.c:16 strlen']);
  assert.equal(found[0].column, 9);
  assert.ok(projectNames(files).has('my_strlen'), 'a prototype in a project header counts as the project\'s own');
});

test('code: major()/minor() count as the gnu_dev_* functions the subject allows', () => {
  const src = [{ file: 'src/ls.c', text: 'void show(struct stat *s)\n{\n    my_put_nbr(major(s->st_rdev));\n    my_put_nbr(minor(s->st_rdev));\n}\nint my_put_nbr(int n)\n{\n    return n;\n}\n' }];
  assert.deepEqual(findDisallowedCalls(src, new Set(['gnu_dev_major', 'gnu_dev_minor'])), []);
  assert.deepEqual(findDisallowedCalls(src, new Set()).map(v => v.message), ['major', 'minor']);
});

test('code: a forbidden name is reported even when the list allows it', () => {
  const found = findDisallowedCalls(files, new Set(['opendir', 'write', 'printf', 'strlen']), new Set(['write']));
  assert.deepEqual(found.map(v => v.message), ['write']);
});

test('tests are not delivered code; the bootstrap is never the subject read', () => {
  assert.equal(isTestPath('tests/test_ls.c'), true);
  assert.equal(isTestPath('src/test_utils.c'), true);
  assert.equal(isTestPath('src/attest.c'), false);
  assert.deepEqual(pickSubjectForFunctions([{ name: 'B-PSU-100_bootstrap.pdf' }, { name: 'my_ls.pdf' }]), { name: 'my_ls.pdf' });
  assert.deepEqual(pickSubjectForFunctions([{ name: 'bootstrap.pdf' }]), { name: 'bootstrap.pdf' });
});

test('subject functions: read once and kept, shared while reading, read again on demand, retried later after a failure', async () => {
  const store = new Map<string, unknown>();
  const storage = { get: <T>(k: string) => store.get(k) as T, update: async (k: string, v: unknown) => { store.set(k, v); } };
  let downloads = 0, fail = false, clock = 1_000;
  const changed: number[] = [];
  const service = new SubjectFunctions(storage as never, async () => {
    downloads++;
    if (fail) throw new Error('offline');
    return { name: 'my_ls.pdf', bytes: new Uint8Array([1]) };
  }, async () => MY_LS, id => changed.push(id), () => clock);
  const project = { id: 7, name: 'my_ls' } as ProjectVM;
  assert.equal(service.get('s', 7).status, 'idle');
  const [a, b] = await Promise.all([service.ensure('s', project), service.ensure('s', project)]);
  assert.equal(downloads, 1);
  assert.equal(a.status, 'found');
  assert.deepEqual(a, b);
  assert.equal((await service.ensure('s', project)).names.length, 21);
  assert.equal(downloads, 1, 'kept after the first read');
  assert.equal(service.get('s', 7).doc, 'my_ls.pdf');
  await service.ensure('s', project, true);
  assert.equal(downloads, 2, 'read again on demand');
  assert.ok(changed.includes(7));

  const other = { id: 8, name: 'other' } as ProjectVM;
  fail = true;
  assert.equal((await service.ensure('s', other)).status, 'error');
  await service.ensure('s', other);
  assert.equal(downloads, 3, 'no automatic retry right after a failure');
  clock += 11 * 60_000;
  await service.ensure('s', other);
  assert.equal(downloads, 4);
});
