import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorColumn, errorFindings, formatBytes, groupErrors, groupLeaks, leakColumn, leakFindings, parseHeapUsage, parseValgrindLog } from '../codingStyle/valgrind';

const LOG = `==7== Memcheck, a memory error detector
==7== Process terminating with default action of signal 11 (SIGSEGV)
==7== HEAP SUMMARY:
==7==     in use at exit: 4,240 bytes in 6 blocks
==7==   total heap usage: 1,284 allocs, 1,278 frees, 52,345 bytes allocated
==7==
==7== 24 bytes in 1 blocks are definitely lost in loss record 1 of 6
==7==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==7==    by 0x1091A1: init (/p/src/init.c:12)
==7==    by 0x109201: main (/p/src/main.c:5)
==7==
==7== 40 (16 direct, 24 indirect) bytes in 1 blocks are definitely lost in loss record 2 of 6
==7==    at 0x4846828: malloc (vg_replace_malloc.c:381)
==7==    by 0x1091A1: init (/p/src/init.c:12)
==7==
==7== 8 bytes in 1 blocks are indirectly lost in loss record 3 of 6
==7==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==7==    by 0x4A1B2C: strdup (in /usr/lib/x86_64-linux-gnu/libc.so.6)
==7==    by 0x1091B0: name (/p/lib/my/name.c:3)
==7==
==7== 4,096 bytes in 1 blocks are definitely lost in loss record 4 of 6
==7==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==7==    by 0x5C0D0E: sf::Texture::create (in /usr/lib/libsfml-graphics.so.2.6)
==7==    by 0x109300: main (/p/src/main.c:9)
==7==
==7== 32 bytes in 1 blocks are definitely lost in loss record 5 of 6
==7==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==7==    by 0x109300: main (in /p/my_hunter)
==7==
==7== 64 bytes in 1 blocks are possibly lost in loss record 6 of 6
==7==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==7==    by 0x109300: main (/p/src/main.c:7)
==7==
==7== LEAK SUMMARY:
==7==    definitely lost: 4,168 bytes in 4 blocks
==7== ERROR SUMMARY: 5 errors from 5 contexts (suppressed: 0 from 0)`;

test('valgrind log: project leaks at the allocating line, library leaks omitted, missing -g counted, heap read', () => {
  const report = parseValgrindLog(LOG, '/p');
  assert.deepEqual(report.leaks.map(l => [l.file, l.line, l.bytes, l.allocator]), [
    ['/p/src/init.c', 12, 24, 'malloc'], ['/p/src/init.c', 12, 16, 'malloc'], ['/p/lib/my/name.c', 3, 8, 'strdup']]);
  assert.equal(report.omitted, 1);
  assert.equal(report.unlocated, 1);
  assert.equal(report.bytes, 24 + 16 + 8 + 4096 + 32, 'the total counts every lost block once, as LEAK SUMMARY does');
  assert.equal(report.signal, 'SIGSEGV');
  assert.deepEqual(report.heap, { allocs: 1284, frees: 1278, bytes: 52345, inUse: 4240 });
  assert.equal(report.finished, true);
  assert.equal(parseValgrindLog('valgrind: ./nope: No such file or directory', '/p').finished, false);
});

test('leaks of one line add up, biggest first, and land on the allocator call', () => {
  const grouped = groupLeaks(parseValgrindLog(LOG, '/p').leaks);
  assert.deepEqual(grouped.map(l => [l.file, l.bytes]), [['/p/src/init.c', 40], ['/p/lib/my/name.c', 8]]);
  assert.equal(leakColumn('    char *s = malloc(4);', 'malloc'), 15);
  assert.equal(leakColumn('    char *s = my_strdup(x);', 'strdup'), 1);
  const [first] = leakFindings(grouped, 'auto', () => '    p = malloc(40);');
  assert.deepEqual([first!.line, first!.column, first!.level, first!.ruleId, first!.message], [12, 9, 'Major', 'VALGRIND', '40 B never freed']);
});

test('bytes in the chosen unit, or the largest that fits', () => {
  assert.equal(formatBytes(0, 'auto'), '0 B');
  assert.equal(formatBytes(999, 'auto'), '999 B');
  assert.equal(formatBytes(2400, 'auto'), '2.4 kB');
  assert.equal(formatBytes(3_500_000, 'auto'), '3.5 MB');
  assert.equal(formatBytes(2400, 'B'), '2400 B');
  assert.equal(formatBytes(2400, 'MB'), '0 MB');
});

test('heap usage line, with thousands separators', () => {
  assert.deepEqual(parseHeapUsage('==12== HEAP SUMMARY:\n==12==     in use at exit: 40 bytes in 2 blocks\n==12==   total heap usage: 1,284 allocs, 1,279 frees, 52,345 bytes allocated'), { allocs: 1284, frees: 1279, bytes: 52345, inUse: 40 });
  assert.equal(parseHeapUsage('nothing here'), undefined);
});

const ERRORS = `==9== Memcheck, a memory error detector
==9== Invalid read of size 4
==9==    at 0x109189: get (/p/src/list.c:20)
==9==    by 0x1091F2: main (/p/src/main.c:8)
==9==  Address 0x4a8d068 is 0 bytes after a block of size 40 alloc'd
==9==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==    by 0x10917A: init (/p/src/list.c:10)
==9==
==9== Invalid read of size 4
==9==    at 0x109189: get (/p/src/list.c:20)
==9==    by 0x1091F2: main (/p/src/main.c:8)
==9==  Address 0x4a8d06c is 4 bytes after a block of size 40 alloc'd
==9==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==    by 0x10917A: init (/p/src/list.c:10)
==9==
==9== Conditional jump or move depends on uninitialised value(s)
==9==    at 0x484ED28: strlen (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==    by 0x1092AA: my_putstr (/p/lib/my/putstr.c:6)
==9==
==9== Invalid free() / delete / delete[] / realloc()
==9==    at 0x484B27F: free (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==    by 0x109300: destroy (/p/src/list.c:31)
==9==  Address 0x4a8d040 is 0 bytes inside a block of size 40 free'd
==9==    at 0x484B27F: free (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==    by 0x1092F0: destroy (/p/src/list.c:30)
==9==  Block was alloc'd at
==9==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==9==
==9== Invalid write of size 8
==9==    at 0x5C0D0E: sf::Window::close (in /usr/lib/libsfml-window.so.2.6)
==9==    by 0x4A00AA: sfRenderWindow_close (in /usr/lib/libcsfml-graphics.so.2.6)
==9==
==9== Use of uninitialised value of size 8
==9==    at 0x109400: main (in /p/my_ls)
==9==
==9== HEAP SUMMARY:
==9==     in use at exit: 0 bytes in 0 blocks
==9==   total heap usage: 10 allocs, 11 frees, 400 bytes allocated
==9== ERROR SUMMARY: 6 errors from 5 contexts (suppressed: 0 from 0)`;

test('memcheck errors land on the project line, with the block they hit and the library call they went through', () => {
  const report = parseValgrindLog(ERRORS, '/p');
  assert.deepEqual(report.errors.map(e => [e.kind, e.what, e.file, e.line, e.fn, e.via ?? null]), [
    ['read', 'Invalid read of size 4', '/p/src/list.c', 20, 'get', null],
    ['read', 'Invalid read of size 4', '/p/src/list.c', 20, 'get', null],
    ['uninit', 'Conditional jump or move depends on uninitialised value(s)', '/p/lib/my/putstr.c', 6, 'my_putstr', 'strlen'],
    ['free', 'Invalid free() / delete / delete[] / realloc()', '/p/src/list.c', 31, 'destroy', 'free']]);
  const [first] = report.errors;
  assert.equal(first!.detail, "0 bytes after a block of size 40 alloc'd");
  assert.deepEqual(first!.origin, { fn: 'init', file: '/p/src/list.c', line: 10 });
  assert.deepEqual(first!.stack.map(f => f.line), [20, 8]);
  assert.deepEqual(report.errors[3]!.origin, { fn: 'destroy', file: '/p/src/list.c', line: 30 }, 'a double free points at the first free');
  assert.equal(report.errorsOmitted, 1, 'an error entirely inside SFML is not the project\'s');
  assert.equal(report.unlocated, 1, 'an error in the project binary built without -g has no line');
  assert.equal(report.leaks.length, 0);
});

test('identical errors count once, and land on the call or the line\'s first character', () => {
  const grouped = groupErrors(parseValgrindLog(ERRORS, '/p').errors);
  assert.deepEqual(grouped.map(e => [e.kind, e.line, e.count]), [['read', 20, 2], ['uninit', 6, 1], ['free', 31, 1]]);
  assert.equal(errorColumn('    write(1, s, strlen(s));', 'strlen'), 17);
  assert.equal(errorColumn('    return list[i];', undefined), 5);
  const [read] = errorFindings(grouped, () => '    return list[i];');
  assert.deepEqual([read!.column, read!.rangeLength, read!.message], [5, 15, 'Invalid read of size 4 (×2)']);
});

// valgrind 3.26 with its debug sources: the allocator shows as a file, glibc's strdup as a relative path.
const REAL = `==178360== Memcheck, a memory error detector
==178360== Copyright (C) 2002-2024, and GNU GPL'd, by Julian Seward et al.
==178360== Using Valgrind-3.26.0 and LibVEX; rerun with -h for copyright info
==178360== Command: ./prog
==178360== Parent PID: 178349
==178360== 
==178360== Invalid write of size 4
==178360==    at 0x40011F8: main (/p/src/main.c:11)
==178360==  Address 0x4aa12a8 is 0 bytes after a block of size 40 alloc'd
==178360==    at 0x4850858: malloc (/usr/src/valgrind-1:3.26.0-0ubuntu1/coregrind/m_replacemalloc/vg_replace_malloc.c:447)
==178360==    by 0x40011CA: main (/p/src/main.c:7)
==178360== 
==178360== Conditional jump or move depends on uninitialised value(s)
==178360==    at 0x4001207: main (/p/src/main.c:12)
==178360== 
==178360== 
==178360== HEAP SUMMARY:
==178360==     in use at exit: 558 bytes in 3 blocks
==178360==   total heap usage: 4 allocs, 1 frees, 566 bytes allocated
==178360== 
==178360== 6 bytes in 1 blocks are definitely lost in loss record 1 of 3
==178360==    at 0x4850858: malloc (/usr/src/valgrind-1:3.26.0-0ubuntu1/coregrind/m_replacemalloc/vg_replace_malloc.c:447)
==178360==    by 0x493896E: strdup (string/./string/strdup.c:42)
==178360==    by 0x40011A4: dup (/p/src/main.c:3)
==178360==    by 0x40011EB: main (/p/src/main.c:9)
==178360== 
==178360== 40 bytes in 1 blocks are definitely lost in loss record 2 of 3
==178360==    at 0x4850858: malloc (/usr/src/valgrind-1:3.26.0-0ubuntu1/coregrind/m_replacemalloc/vg_replace_malloc.c:447)
==178360==    by 0x40011CA: main (/p/src/main.c:7)
==178360== 
==178360== 512 bytes in 1 blocks are definitely lost in loss record 3 of 3
==178360==    at 0x4850858: malloc (/usr/src/valgrind-1:3.26.0-0ubuntu1/coregrind/m_replacemalloc/vg_replace_malloc.c:447)
==178360==    by 0x40011BC: main (/p/src/main.c:6)
==178360== 
==178360== LEAK SUMMARY:
==178360==    definitely lost: 558 bytes in 3 blocks
==178360==    indirectly lost: 0 bytes in 0 blocks
==178360==      possibly lost: 0 bytes in 0 blocks
==178360==    still reachable: 0 bytes in 0 blocks
==178360==         suppressed: 0 bytes in 0 blocks
==178360== 
==178360== Use --track-origins=yes to see where uninitialised values come from
==178360== For lists of detected and suppressed errors, rerun with: -s
==178360== ERROR SUMMARY: 5 errors from 5 contexts (suppressed: 0 from 0)`;

test('a real valgrind 3.26 log: leaks land on the project line behind the allocator, not in "other libraries"', () => {
  const report = parseValgrindLog(REAL, '/p');
  assert.deepEqual(report.leaks.map(l => [l.line, l.bytes, l.allocator]), [[3, 6, 'strdup'], [7, 40, 'malloc'], [6, 512, 'malloc']]);
  assert.equal(report.omitted, 0);
  assert.equal(report.bytes, 558);
  assert.deepEqual(report.errors.map(e => [e.kind, e.line]), [['write', 11], ['uninit', 12]]);
  assert.deepEqual(report.errors[0]!.origin, { fn: 'main', file: '/p/src/main.c', line: 7 });
  assert.deepEqual(report.heap, { allocs: 4, frees: 1, bytes: 566, inUse: 558 });
});
