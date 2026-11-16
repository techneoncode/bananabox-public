import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';
import { projectFiles, safeProjectPath } from './git';
import { loadDeliveryConfig } from './config';
import { shellSplit, splitCommandChain } from '../codingStyle/shell';
import type {
  DeliveryConfig,
  LocalCommand,
  ReproductionRecipe,
} from '../shared/deliveryTypes';
import type { TestResultDetail, TestTask } from '../shared/types';
import { analyzeGraderTrace } from '../domain/graderTrace';
import { resultTrace } from '../domain/graderEvidence';
import { parseGraderCommand } from '../services/graderCommand';

export interface MakeProject {
  directory: string;
  makefile: string;
  targets: string[];
  name: string | null;
  sources: string[];
}

export interface DetectedRecipe {
  recipe: ReproductionRecipe;
  mode: 'recipe' | 'tests' | 'build';
  detected: boolean;
}

export interface DeliveryPlan {
  config: DeliveryConfig;
  builds: LocalCommand[];
  tests: LocalCommand[];
  makefiles: MakeProject[];
  manual: boolean;
  detected: boolean;
  generated: string[];
  commandSource?: 'manual' | 'grader' | 'repository';
  unreproducedCommands?: string[];
}

const TEST_TARGETS = ['tests_run', 'test_run', 'test', 'tests', 'check'];

const makeCommand = (project: MakeProject, target?: string): LocalCommand => ({
  command: [
    'make',
    ...(project.directory === '.' ? [] : ['-C', project.directory]),
    ...(target ? [target] : []),
  ],
  timeoutSeconds: 120,
});

const sourceFile = (file: string) => /\.(?:c|h|cpp|cc|hpp)$/i.test(file);

/** Read Make variables and target names statically: never evaluate shell(), includes or recipes. */
export function parseMakefile(text: string): {
  targets: string[];
  name: string | null;
  sources: string[];
} {
  const plain = text.replace(/\\\r?\n/g, ' ');

  const variables = new Map<string, string>();
  for (const line of plain.split('\n')) {
    if (/^\t/.test(line)) continue;
    const assignment = /^\s*(\w+)\s*(?::=|\?=|=)\s*([^#]*)/.exec(line);
    if (assignment) variables.set(assignment[1], assignment[2].trim());
  }

  const expand = (s: string, depth = 0): string =>
    depth > 8
      ? s
      : s.replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_, a, b) =>
          expand(variables.get(a ?? b) ?? '', depth + 1),
        );

  const targets = new Set<string>();
  for (const line of plain.split('\n')) {
    if (/^\t/.test(line) || /^\s*#/.test(line)) continue;
    const match = /^([^:=]+):(?!=)/.exec(line);
    if (match) {
      expand(match[1])
        .trim()
        .split(/\s+/)
        .filter((t) => /^[A-Za-z0-9_.\/-]+$/.test(t))
        .forEach((t) => targets.add(t));
    }
  }

  const name = expand(
    variables.get('NAME') ?? variables.get('TARGET') ?? '',
  ).trim();
  const sources = [
    ...new Set(
      ['SRC', 'SRCS', 'SOURCES', 'CSRC']
        .flatMap((key) => expand(variables.get(key) ?? '').split(/\s+/))
        .filter((f) => /^[\w./-]+\.(?:c|h|cpp|cc)$/.test(f)),
    ),
  ];
  return {
    targets: [...targets],
    sources,
    name: name
      && !name.includes('$')
      && !name.includes('..')
      && /^[\w./-]+$/.test(name)
      && !name.startsWith('/')
      ? name
      : null,
  };
}

export async function discoverMakefiles(
  root: string,
  files?: readonly string[],
): Promise<MakeProject[]> {
  const makefiles: MakeProject[] = [];
  const names = ['Makefile', 'makefile', 'GNUmakefile'];
  const candidates = files ?? (await projectFiles(root));
  for (const file of candidates.filter((f) => names.includes(basename(f)))) {
    const parsed = parseMakefile(
      await readFile(await safeProjectPath(root, file), 'utf8'),
    );
    makefiles.push({
      ...parsed,
      directory: dirname(file).split('\\').join('/'),
      makefile: file,
    });
  }
  return makefiles;
}

export async function discoverPlan(
  root: string,
  report?: TestResultDetail,
  graderCommand = '',
): Promise<DeliveryPlan> {
  const explicit = await loadDeliveryConfig(root);
  const files = await projectFiles(root);
  const makefiles = await discoverMakefiles(root, files);
  const rootMake = makefiles.find((m) => m.directory === '.');
  const independent = rootMake
    ? [rootMake]
    : makefiles.filter(
        (m) =>
          !makefiles.some(
            (parent) =>
              parent !== m
              && m.directory.startsWith(`${parent.directory}/`),
          ),
      );

  let builds: LocalCommand[] = explicit?.build
    ? [explicit.build]
    : independent.map((m) => {
        const task = report?.tasks.find((t) =>
          matchTask(t.name, makefiles)?.directory === m.directory,
        );
        return task ? tracedMake(task, m) ?? makeCommand(m) : makeCommand(m);
      });
  const tests: LocalCommand[] = explicit?.tests ? [explicit.tests] : [];
  let commandSource: DeliveryPlan['commandSource'] = explicit?.build
    ? 'manual'
    : 'repository';
  const unreproducedCommands: string[] = [];

  if (graderCommand.trim()) {
    const chain = parseGraderCommand(graderCommand);
    if (!chain?.length) throw new Error('Invalid grader command');
    builds = chain.map((command) => ({ command, timeoutSeconds: 120 }));
    commandSource = 'manual';
  } else if (!explicit?.build && report) {
    const detected = graderMakeCommands(resultTrace(report), makefiles);
    if (detected.length) {
      builds = detected;
      commandSource = 'grader';
    }
    for (const task of analyzeGraderTrace(resultTrace(report)).tasks) {
      for (const observed of task.commands) {
        if (
          !observed.chain
          || observed.chain.some((argv) =>
            !localMakeCommand(argv, observed.cwd, makefiles),
          )
        ) {
          unreproducedCommands.push(`${observed.cwd}> ${observed.text}`);
        }
      }
    }
  }

  if (!explicit?.tests) {
    const rootTest = rootMake
      && TEST_TARGETS.find((t) => rootMake.targets.includes(t));
    if (rootMake && rootTest) {
      tests.push(makeCommand(rootMake, rootTest));
    } else {
      for (const m of makefiles) {
        const target = TEST_TARGETS.find((t) => m.targets.includes(t));
        if (target) tests.push(makeCommand(m, target));
      }
    }
  }

  if (!makefiles.length && files.includes('package.json')) {
    const pkg = JSON.parse(
      await readFile(await safeProjectPath(root, 'package.json'), 'utf8'),
    );
    if (!builds.length && typeof pkg.scripts?.build === 'string') {
      builds.push({ command: ['npm', 'run', 'build'], timeoutSeconds: 120 });
    }
    if (
      !tests.length
      && typeof pkg.scripts?.test === 'string'
      && !/no test specified/.test(pkg.scripts.test)
    ) {
      tests.push({ command: ['npm', 'test'], timeoutSeconds: 120 });
    }
  }

  if (!tests.length) {
    const scripts = [
      'tests/run_tests.sh',
      'tests/test.sh',
      'test.sh',
      'run_tests.sh',
    ];
    for (const file of scripts) {
      if (files.includes(file)) {
        tests.push({ command: ['sh', file], timeoutSeconds: 120 });
        break;
      }
    }
  }

  const required = explicit?.requiredFiles.length
    ? explicit.requiredFiles
    : [
        ...new Set(
          makefiles.flatMap((m) => [
            m.makefile,
            ...m.sources
              .map((s) => posix.normalize(posix.join(m.directory, s)))
              .filter((s) => !s.startsWith('../') && !s.startsWith('/')),
          ]),
        ),
      ];
  const config: DeliveryConfig = {
    version: 1,
    build: builds[0],
    tests: tests[0],
    requiredFiles: required,
    forbiddenFunctions: explicit?.forbiddenFunctions.length
      ? explicit.forbiddenFunctions
      : report?.bannedFunctions ?? [],
    recipes: explicit?.recipes ?? Object.create(null),
  };
  if (!required.length && files.some(sourceFile)) {
    config.requiredFiles = files.filter(sourceFile);
  }

  const generated = makefiles
    .flatMap((m) => [
      ...(m.name ? [posix.normalize(posix.join(m.directory, m.name))] : []),
      ...m.sources.flatMap((s) =>
        ['o', 'gcda', 'gcno'].map((ext) =>
          posix.normalize(
            posix.join(m.directory, s.replace(/\.[^.]+$/, `.${ext}`)),
          ),
        ),
      ),
    ])
    .filter((f) => !explicit?.requiredFiles.includes(f));
  return {
    config,
    builds,
    tests,
    makefiles,
    generated,
    commandSource,
    unreproducedCommands,
    manual: explicit !== null || !!graderCommand.trim(),
    detected: commandSource !== 'manual' && builds.length > 0
      || (!explicit?.tests && tests.length > 0),
  };
}

function localMakeCommand(
  argv: string[],
  cwd: string,
  makefiles: MakeProject[],
): LocalCommand | null {
  if (argv[0] !== 'make') return null;

  const args = argv.slice(1);
  const directory = args.indexOf('-C');
  if (directory >= 0) {
    const relative = args[directory + 1];
    if (
      !relative
      || relative.startsWith('/')
      || !/^[\w./-]+$/.test(relative)
    ) {
      return null;
    }
    cwd = posix.normalize(posix.join(cwd, relative));
    args.splice(directory, 2);
  }

  const project = makefiles.find((m) => m.directory === cwd);
  const allowed = (a: string) =>
    ['-s', '--silent', '-B', '--always-make', '-j', '--no-print-directory']
      .includes(a)
    || /^-j\d+$/.test(a)
    || (/^[\w.-]+$/.test(a)
      && !['install', 'uninstall'].includes(a)
      && (project?.targets.includes(a)
        || ['all', 're', 'clean', 'fclean', ...TEST_TARGETS].includes(a)));
  if (!project || !args.every(allowed)) return null;
  return { command: ['make', ...args], cwd, timeoutSeconds: 120 };
}

/** Reproduce literal make chains in the directory printed by the grader. */
export function graderMakeCommands(
  trace: string,
  makefiles: MakeProject[],
): LocalCommand[] {
  const commands: LocalCommand[] = [];
  for (const task of analyzeGraderTrace(trace).tasks) {
    for (const observed of task.commands) {
      if (!observed.chain?.length) continue;
      for (const argv of observed.chain) {
        const command = localMakeCommand(argv, observed.cwd, makefiles);
        if (!command) break;
        commands.push(command);
      }
    }
  }
  return commands;
}

function taskNumber(name: string): number | null {
  const m = /(?:^|[^a-z0-9])task[_ -]?0*(\d+)(?:$|[^0-9])/i.exec(name);
  return m ? Number(m[1]) : null;
}

export function matchTask(
  name: string,
  makefiles: MakeProject[],
): MakeProject | null {
  const lower = name.toLowerCase();
  const number = taskNumber(lower);
  const candidates = makefiles.filter((m) => {
    const folder = basename(m.directory).toLowerCase();
    return m.directory !== '.'
      && (lower === folder
        || lower.endsWith(` ${folder}`)
        || lower.endsWith(`- ${folder}`)
        || (number !== null && taskNumber(folder) === number));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/** Only extract simple, literal command lines. Anything involving shell operators is left to local recipes. */
export function traceCommands(trace: string): string[][] {
  const out: string[][] = [];
  for (let line of trace.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    line = line
      .trim()
      .replace(/^(?:~\/\.>|\$|>)\s*/, '')
      .replace(/^#\s*(?:Executing|Running|Building|Compiling)(?:\s+with)?\s*:?\s*/i, '');
    if (!line || /[|<>`]|\$\(/.test(line)) continue;

    for (const segment of splitCommandChain(line)) {
      const parts = shellSplit(segment);
      if (
        parts.length
        && parts.every((p) => !p.includes('\0') && !p.includes('&'))
      ) {
        out.push(parts);
      }
    }
  }
  return out;
}

function tracedMake(task: TestTask, project: MakeProject): LocalCommand | null {
  for (const argv of traceCommands(task.trace)) {
    if (basename(argv[0]) !== 'make') continue;

    const targets = argv.slice(1).filter((a) => !a.startsWith('-'));
    const target = targets.find((t) =>
      project.targets.includes(t)
      && ![
        'clean',
        'fclean',
        'install',
        'uninstall',
        ...TEST_TARGETS,
      ].includes(t),
    );
    if (target) return makeCommand(project, target);
  }
  return null;
}

export async function inferRecipe(
  root: string,
  task: TestTask,
  plan: DeliveryPlan,
): Promise<DetectedRecipe | null> {
  const manual = plan.config.recipes[task.name];
  if (manual) return { recipe: manual, mode: 'recipe', detected: false };

  const project = matchTask(task.name, plan.makefiles)
    ?? (plan.makefiles.length === 1 ? plan.makefiles[0] : null);
  if (!project) return null;

  const build = tracedMake(task, project) ?? makeCommand(project);
  const evidence = analyzeGraderTrace(task.trace).tasks.flatMap((t) =>
    t.commands,
  );
  const executable = project.name
    ?? (project.targets.includes(basename(project.directory))
      ? basename(project.directory)
      : null);
  if (executable && !/\.(?:a|so|o)$/i.test(executable)) {
    for (const argv of [
      ...evidence
        .filter((c) => c.cwd === project.directory || c.cwd === '.')
        .flatMap((c) => c.chain ?? []),
      ...traceCommands(task.trace),
    ]) {
      const exe = argv[0].replace(/^\.\//, '');
      if (
        exe === executable
        || exe === posix.join(project.directory, executable)
      ) {
        const invocations = evidence
          .flatMap((c) => c.chain ?? [])
          .filter((a) => {
            const invoked = a[0].replace(/^\.\//, '');
            return invoked === executable
              || invoked === posix.join(project.directory, executable);
          });
        const failures = analyzeGraderTrace(task.trace).tasks.flatMap((t) =>
          t.run.failures,
        );
        const mismatch = invocations.length === 1 && failures.length === 1
          ? failures[0]
          : undefined;
        return {
          recipe: {
            command: [`./${executable}`, ...argv.slice(1)],
            cwd: project.directory,
            build,
            timeoutSeconds: 30,
            ...(mismatch?.expected !== undefined
              ? { expectedStdout: mismatch.expected, expectedFromLog: true }
              : {}),
          },
          mode: 'tests',
          detected: true,
        };
      }
    }
  }

  const target = TEST_TARGETS.find((t) => project.targets.includes(t));
  if (target) {
    return {
      recipe: { ...makeCommand(project, target) },
      mode: 'tests',
      detected: true,
    };
  }
  for (const name of ['test.sh', 'run_tests.sh']) {
    const file = posix.join(project.directory, name);
    try {
      if ((await stat(await safeProjectPath(root, file))).isFile()) {
        return {
          recipe: { command: ['sh', name], cwd: project.directory, build },
          mode: 'tests',
          detected: true,
        };
      }
    } catch {}
  }
  return { recipe: { ...build }, mode: 'build', detected: true };
}
