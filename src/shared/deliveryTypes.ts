export interface LocalCommand {
  command: string[];
  timeoutSeconds?: number;
  cwd?: string;
}

export interface ReproductionRecipe extends LocalCommand {
  expectedFromLog?: boolean;
  stdin?: string;
  expectedStdout?: string;
  expectedExitCode?: number;
  build?: LocalCommand;
}

export interface DeliveryConfig {
  version: 1;
  build?: LocalCommand;
  tests?: LocalCommand;
  requiredFiles: string[];
  forbiddenFunctions: string[];
  recipes: Record<string, ReproductionRecipe>;
}

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'running';

export interface DeliveryCheck {
  id:
    | 'build'
    | 'tests'
    | 'files'
    | 'functions'
    | 'valgrind'
    | 'style'
    | 'git'
    | 'deadline'
    | 'grader';
  status: CheckStatus;
  detail: string;
  output?: string;
  files?: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
  }>;
}

export interface ReadinessVM {
  projectId: number;
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  configured: boolean;
  stale: boolean;
  checkedAt: number | null;
  checks: DeliveryCheck[];
  error: string | null;
  commit: string | null;
  detected?: boolean;
  commands?: string[];
  taskCount?: number;
  generatedOutputs?: string[];
  inheritedForbiddenFunctions?: string[];
  /**
   * Functions called that neither the project provides nor the allowed list
   * names, once each.
   */
  disallowed?: string[];
  /**
   * How many names the allowed list held when checked (custom and subject
   * together).
   */
  allowedCount?: number;
  commandSource?: 'manual' | 'grader' | 'repository';
  unreproducedCommands?: string[];
}

export interface ReproductionVM {
  expectedFromLog?: boolean;
  projectId: number;
  resultId: number;
  task: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'error';
  command: string;
  stdout: string;
  stderr: string;
  expectedStdout: string | null;
  expectedExitCode: number;
  exitCode: number | null;
  durationMs: number;
  error: string | null;
  mode?: 'recipe' | 'tests' | 'build';
  detected?: boolean;
}

export type DeliveryStep =
  | 'save'
  | 'check'
  | 'review'
  | 'commit'
  | 'push'
  | 'grader';

export interface GuidedVM {
  projectId: number;
  status: 'running' | 'paused' | 'done';
  step: DeliveryStep;
  completed: DeliveryStep[];
  message: string | null;
}

/**
 * The allowed functions read from the project's subject ("Authorized functions"
 * section).
 */
export interface SubjectFunctionsVM {
  status: 'idle' | 'reading' | 'found' | 'none' | 'error';
  names: string[];
  /** The PDF the list was read from. */
  doc?: string;
  at?: number;
  error?: string;
  /** What the same subject asks of the Makefile (rules, binary name). */
  makefile?: { rules: string[]; binary?: string };
}
