import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthorizedFunctions } from '../domain/allowedFunctions';

// Regression corpus: short excerpts of real Epitech subjects as pdf.js extracts them
// (the ✓ dingbat comes out as "3", the ∇ is a screenshot artifact). Each case pins the
// list that parseAuthorizedFunctions must return for the excerpt.
// mode "exact": deepEqual. mode "includes": every expected name must be present.
// expect null: the subject states no enumerable list.

interface Case {
  name: string;
  text: string;
  expect: string[] | null;
  mode?: 'exact' | 'includes';
}

const CASES: Case[] = [
  {
    name: 'G-PSU-100_my_ls: 21 functions, bullets as "3", list ends at Bonus',
    text: `./include:
... etc
Authorized Functions
The only system calls and libc function allowed are the following ones:
3 opendir, readdir, closedir, stat, lstat, write,
3 getpwuid, getgrgid, time, ctime, readlink,
3 va_start, va_arg, va_end,
3 malloc, free, perror, strerror, exit
3 gnu_dev_major, gnu_dev_minor
Bonus
Unlike the real ls, column formatting is not required and should be treated as a bonus.`,
    expect: ['opendir', 'readdir', 'closedir', 'stat', 'lstat', 'write', 'getpwuid', 'getgrgid', 'time', 'ctime', 'readlink',
      'va_start', 'va_arg', 'va_end', 'malloc', 'free', 'perror', 'strerror', 'exit', 'gnu_dev_major', 'gnu_dev_minor'],
  },
  {
    name: 'G-MUL-100_my_hunter: "(f)open" expands to open and fopen; CSFML and math sections not enumerable',
    text: `Authorized functions
Here is the full list of authorized functions.
from the C library
3 malloc
3 free
3 memset
3 rand
3 srand
3 time (only with srand)
3 (f)open
3 (f)read
3 (f)write
3 (f)close
3 getline
from the CSFML library`,
    expect: ['malloc', 'free', 'memset', 'rand', 'srand', 'time', 'open', 'fopen', 'read', 'fread',
      'write', 'fwrite', 'close', 'fclose', 'getline'],
    mode: 'includes',
  },
  {
    name: 'Setting_Up-project: "Authorized functions:" on one line',
    text: `SETTING UP
If you are a PGE student
binary name: setting_up
language: C
compilation: via Makefile, including re, clean and fclean rules
Authorized functions: open, read, write, close, malloc, free, stat
If you are a BACH student`,
    expect: ['open', 'read', 'write', 'close', 'malloc', 'free', 'stat'],
  },
  {
    name: 'cpool_Day07: "Allowed system function(s): write"',
    text: `Your library will be built using the lib/my/build.sh script you will create in the first task.
Clone your repository at the beginning of the day and submit your work on a regular basis!
The delivery directory is specified within the instructions for each task.
In order to keep your repository clean, pay attention to gitignore.
Allowed system function(s): write
We still encourage you to write unit tests for all your functions!`,
    expect: ['write'],
  },
  {
    name: 'cpool_Day08: "Allowed system function(s): write, malloc, free"',
    text: `The delivery directory is specified within the instructions for each task.
In order to keep your repository clean, pay attention to gitignore.
Allowed system function(s): write, malloc, free
We still encourage you to write unit tests for all your functions!`,
    expect: ['write', 'malloc', 'free'],
  },
  {
    name: 'cpool_Day09: "Allowed system function(s): write, malloc, free"',
    text: `The delivery directory is specified within the instructions for each task.
In order to keep your repository clean, pay attention to gitignore.
Allowed system function(s): write, malloc, free
We still encourage you to write unit tests for all your functions!`,
    expect: ['write', 'malloc', 'free'],
  },
  {
    name: 'cpool_Day10: "Allowed system function(s): write, malloc, free"',
    text: `found in lib/my/. For those of you using .h files, they must be located in include/ (like the my.h file).
Clone your repository at the beginning of the day and submit your work on a regular basis!
The delivery directory is specified within the instructions for each task.
In order to keep your repository clean, pay attention to gitignore.
Allowed system function(s): write, malloc, free
We still encourage you to write unit tests for all your functions!
Check out Day06 if you need an example, and re-read chapter Unit tests for C/C++.`,
    expect: ['write', 'malloc', 'free'],
  },
  {
    name: 'cpool_Day12: "Allowed system function(s): open, read, write, close"',
    text: `If you use your libmy for the following tasks, it must be built (if required) from the task's Makefile.
The preferred way to do this is to call the lib's Makefile from the project's Makefile.
Allowed system function(s): open, read, write, close`,
    expect: ['open', 'read', 'write', 'close'],
  },
  {
    name: 'cpool_Rush1: "Allowed function: write." (singular label)',
    text: `your delivery.
- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.
- If one of your files prevents you from compiling with *.c, the Autograder will not be able to correct
your work and you will receive a 0.
Segfault, bus error, floating exception are all grounds for disqualification!
Allowed function: write.`,
    expect: ['my_putchar', 'write'],
  },
  {
    name: 'G-MUL-100_my_radar: list runs over a page footer; CSFML names with * inside and (except ...) notes',
    text: `5
Authorized functions
Here is the full list of authorized functions.
from the C library
3 malloc
3 free
3 stat
3 memset
3 rand
3 srand
3 time (only with srand)
3 (f)open
3 (f)read
3 (f)write
3 (f)close
3 getline
6
from the CSFML library
3 sfRenderWindow_create
3 sfRenderWindow_destroy
3 sfRenderWindow_isOpen
3 sfRenderWindow_close
3 sfRenderWindow_pollEvent
3 sfRenderWindow_setFramerateLimit
3 sfRenderWindow_clear
3 sfRenderWindow_drawSprite
3 sfRenderWindow_draw*Shape
3 sfRenderWindow_drawText
3 sfRenderWindow_display
3 sfMusic_*
3 sfSprite_create
3 sfSprite_destroy
3 sfSprite_setTexture
3 sfSprite_setPosition
3 sfSprite_setRotation
3 sfSprite_move
3 sfSprite_rotate
3 sfTexture_create
3 sfTexture_createFromFile
3 sfTexture_destroy
3 sfTexture_updateFromPixels
3 sfText_*
3 sfView_*
3 sfShape_* (except _getLocalBounds and _getGlobalBounds)
3 sfConvexShape_* (except _getLocalBounds and _getGlobalBounds)
3 sfRectangleShape_* (except _getLocalBounds and _getGlobalBounds)
3 sfCircleShape_* (except _getLocalBounds and _getGlobalBounds)
3 sfTransform_*
3 sfClock_*
from the math library
All functions
Any unspecified functions are de facto banned.
7`,
    expect: ['malloc', 'stat', 'fopen', 'getline', 'sfRenderWindow_create', 'sfRenderWindow_draw*', 'sfMusic_*', 'sfTexture_updateFromPixels', 'sfShape_*', 'sfCircleShape_*', 'sfClock_*', 'sqrt', 'cosf'],
    mode: 'includes',
  },
  {
    name: 'FinalStumper: list before "are the only syscalls allowed"',
    text: `must display none.
Regardless of the response, you must terminate your line with \\n.
malloc, free, read and write are the only syscalls allowed.
You may use your lib, but it must be rebuilt when your project is.`,
    expect: ['malloc', 'free', 'read', 'write'],
  },
  {
    name: 'my_sudo bootstrap: checkmark bullet before "Allowed functions:"',
    text: `return 84;
}
3 Allowed functions: getline, crypt, exec*
3 link your program with -lcrypt
Expected output:`,
    expect: ['getline', 'crypt', 'exec*'],
  },
  {
    name: 'cpool_Rush2: "Allowed system function(s): write"',
    text: `All .c files from your delivery folder will be collected and compiled with your libmy, which must be
found in lib/my/. For those of you using .h files, they must be located in include/ (like the my.h file).
Allowed system function(s): write
Your library will be built using the lib/my/build.sh script you previously made (see Day07).`,
    expect: ['write'],
  },
  {
    name: 'cpool_CountIsland: "The only allowed system call for this project is write."',
    text: `- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c.
- If one of your files prevents you from compiling with *.c, the Autograder will not be able to correct
your work and you will receive a 0.
All .c files from your delivery folder will be collected and compiled with your libmy, which must be
found in lib/my/. For those of you using .h files, they must be located in include/ (like the my.h file).
The only allowed system call for this project is write.`,
    expect: ['write'],
    mode: 'includes',
  },
  {
    name: 'cpool_Star: "only allowed system call ... is write" plus my_putchar restriction',
    text: `- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.
The only allowed system call for this project is write.`,
    expect: ['write', 'my_putchar'],
    mode: 'includes',
  },
  {
    name: 'cpool_Day03: only my_putchar allowed (restriction phrasing, no list header)',
    text: `All of your source files, except for useless files (binary, temp files, obj files,...), must be included in
your delivery.
- Arrays and strings are forbidden for every task.
- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.`,
    expect: ['my_putchar'],
    mode: 'includes',
  },
  {
    name: 'cpool_Day04: only my_putchar allowed',
    text: `- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.
- If one of your files prevents you from compiling with *.c, the Autograder will not be able to correct
your work and you will receive a 0.`,
    expect: ['my_putchar'],
    mode: 'includes',
  },
  {
    name: 'cpool_Day05: only my_putchar allowed',
    text: `- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.
- If one of your files prevents you from compiling with *.c, the Autograder will not be able to correct
your work and you will receive a 0.`,
    expect: ['my_putchar'],
    mode: 'includes',
  },
  {
    name: 'cpool_Day06: only my_putchar allowed; "libC functions" comparison is not a list',
    text: `- Don't push your main function into your delivery directory, we will be adding our own. Your files
will be compiled adding our main.c and our my_putchar.c files.
- You are only allowed to use the my_putchar function to complete the following tasks, but don't push
it into your delivery directory, and don't copy it in any of your delivered files.
- If one of your files prevents you from compiling with *.c, the Autograder will not be able to correct
your work and you will receive a 0.
You can even compare the result with the libC functions like so:`,
    expect: ['my_putchar'],
    mode: 'includes',
  },
  {
    name: 'cpool_Day13: no allowed-function statement ("functions" word only)',
    text: `Task 01 - Open a window
The first step for displaying an image in a window is the opening of said window.
Have a look at sfRenderWindow and its associated functions.
Open a 800x600 window, and keep it open!
Task 02 - Display a pixel`,
    expect: null,
  },
  {
    name: 'mini_printf-project: "The whole libC is forbidden, except ..." list',
    text: `You must create a function named mini_printf that will use va_args.
The mini_printf is the first step on the road to writing a complete my_printf project. You will need to im-
plement a few flags and won't have to deal with text formating and buffering for now.
You should not push your main function. We are going to compile this project using clang *.c.
The whole libC is forbidden, except write, va_start, va_arg, va_end, malloc, free.
You could add your main function to your .gitignore`,
    expect: ['write', 'va_start', 'va_arg', 'va_end', 'malloc', 'free'],
  },
  {
    name: 'G-PSU-100_my_sudo: "All the libC minus forbidden functions" is not a list',
    text: `Compilation: via Makefile, including re, clean and fclean rules
Authorized functions: All the libC minus forbidden functions.
Forbidden functions: getpw*, *getsp*, getgr*, *fork*, *clone*, openat*, getpass, getlogin*, cuserid,
system
∇ Terminal - + x`,
    expect: null,
  },
  {
    name: 'G-MAT-100_101pong: no list',
    text: `The goal of this project is to work on a 3D version of this game (or of the Breakout game...). Only one paddle
will be considered, located in the (Oxy) plane (which is defined by the equation z = 0).
Bounces on the paddle and game over will not be taken into account; in other words, only the
motion of the ball will be considered, regardless of the context.`,
    expect: null,
  },
  {
    name: 'G-MAT-100_102architect: no list',
    text: `binary name: 102architect
language: everything working on ”the dump”
compilation: when necessary, via Makefile, including re, clean and fclean rules
3 The totality of your source files, except all useless files (binary, temp files, obj files,...), must`,
    expect: null,
  },
  {
    name: 'G-PRO-100_professional_email: no list',
    text: `Write the full, short and precise email to send this document to the client as an attachment.
You do not have to write the attached document (the report) — only the email transmitting it.
All the constituent elements of the email are expected (except the attachment):
3 header (sender, recipient, CC...);`,
    expect: null,
  },
  // Synthetic: layouts where pdf.js may split a header table into separate lines.
  {
    name: 'synthetic: label and value on separate lines, Forbidden section follows',
    text: `Authorized functions:
malloc, free, write,
open, read, close
Forbidden functions: printf`,
    expect: ['malloc', 'free', 'write', 'open', 'read', 'close'],
  },
  {
    name: 'synthetic: list wrapped over three lines',
    text: `Authorized functions: malloc, free,
write, open,
read, close
Bonus: colors`,
    expect: ['malloc', 'free', 'write', 'open', 'read', 'close'],
  },
  {
    name: 'synthetic: French label "Fonctions autorisées :"',
    text: `Fonctions autorisées : write, malloc, free`,
    expect: ['write', 'malloc', 'free'],
  },
  {
    name: 'synthetic: "Allowed system function(s):" label alone, value on next line',
    text: `Allowed system function(s):
write, malloc, free
We still encourage you to write unit tests for all your functions!`,
    expect: ['write', 'malloc', 'free'],
  },
  {
    name: 'synthetic: only a Forbidden list, no allowed list',
    text: `Forbidden functions: printf, scanf, strtok
Compilation: via Makefile`,
    expect: null,
  },
];

for (const c of CASES) {
  test(`subject corpus: ${c.name}`, () => {
    const got = parseAuthorizedFunctions(c.text);
    if (c.expect === null) {
      assert.equal(got, null);
    } else if (c.mode === 'includes') {
      assert.ok(got, 'expected a list, got null');
      for (const name of c.expect) assert.ok(got.includes(name), `missing ${name} in ${got.join(', ')}`);
    } else {
      assert.deepEqual(got, c.expect);
    }
  });
}
