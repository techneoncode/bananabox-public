import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DeliveryConfig,
  LocalCommand,
  ReproductionRecipe,
} from '../shared/deliveryTypes';
import { resolveInside } from '../domain/styleScan';
import { tr } from '../util/text';

export const CONFIG_FILE = '.bananabox.json';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v)
  && v.every((s) => typeof s === 'string' && !s.includes('\0'));

function command(raw: unknown, label: string): LocalCommand {
  if (
    !object(raw)
    || !strings(raw.command)
    || !raw.command.length
    || !raw.command[0].trim()
  ) {
    throw new Error(`${label}: command must be a non-empty array of arguments.`);
  }
  if (
    raw.timeoutSeconds !== undefined
    && (typeof raw.timeoutSeconds !== 'number'
      || !Number.isFinite(raw.timeoutSeconds)
      || raw.timeoutSeconds < 1
      || raw.timeoutSeconds > 300)
  ) {
    throw new Error(`${label}: timeoutSeconds must be between 1 and 300.`);
  }
  if (
    raw.cwd !== undefined
    && (typeof raw.cwd !== 'string'
      || (raw.cwd !== '.' && !resolveInside('/project', raw.cwd)))
  ) {
    throw new Error(`${label}: cwd must be inside the project.`);
  }
  return {
    command: raw.command,
    timeoutSeconds: raw.timeoutSeconds as number | undefined,
    cwd: raw.cwd as string | undefined,
  };
}

export function parseDeliveryConfig(raw: unknown): DeliveryConfig {
  if (!object(raw) || raw.version !== 1) {
    throw new Error(tr('Expected a Bananabox configuration with version: 1.'));
  }

  const files = raw.requiredFiles ?? [];
  if (!strings(files) || files.some((f) => !resolveInside('/project', f))) {
    throw new Error('requiredFiles must contain paths inside the project.');
  }
  const functions = raw.forbiddenFunctions ?? [];
  if (
    !strings(functions)
    || functions.some((f) => !/^[A-Za-z_]\w*$/.test(f))
  ) {
    throw new Error('forbiddenFunctions must contain C function names.');
  }
  if (raw.recipes !== undefined && !object(raw.recipes)) {
    throw new Error('recipes must be an object keyed by grader task name.');
  }

  const recipes: Record<string, ReproductionRecipe> = Object.create(null);
  for (const [name, r] of Object.entries(raw.recipes ?? {})) {
    const c = command(r, name);
    if (!object(r)) throw new Error(tr('Invalid recipe.'));
    if (r.stdin !== undefined && typeof r.stdin !== 'string') {
      throw new Error(`${name}: stdin must be a string.`);
    }
    if (
      r.expectedStdout !== undefined
      && typeof r.expectedStdout !== 'string'
    ) {
      throw new Error(`${name}: expectedStdout must be a string.`);
    }
    if (
      r.expectedExitCode !== undefined
      && (typeof r.expectedExitCode !== 'number'
        || !Number.isSafeInteger(r.expectedExitCode))
    ) {
      throw new Error(`${name}: expectedExitCode must be an integer.`);
    }
    recipes[name] = {
      ...c,
      build: r.build === undefined
        ? undefined
        : command(r.build, `${name}.build`),
      stdin: r.stdin as string | undefined,
      expectedStdout: r.expectedStdout as string | undefined,
      expectedExitCode: r.expectedExitCode as number | undefined,
    };
  }

  return {
    version: 1,
    build: raw.build === undefined ? undefined : command(raw.build, 'build'),
    tests: raw.tests === undefined ? undefined : command(raw.tests, 'tests'),
    requiredFiles: files,
    forbiddenFunctions: functions,
    recipes,
  };
}

export async function loadDeliveryConfig(
  root: string,
): Promise<DeliveryConfig | null> {
  try {
    return parseDeliveryConfig(
      JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function saveDeliveryConfig(
  root: string,
  config: DeliveryConfig,
): Promise<void> {
  const checked = parseDeliveryConfig(config);
  await writeFile(
    join(root, CONFIG_FILE),
    `${JSON.stringify(checked, null, 2)}\n`,
  );
}
