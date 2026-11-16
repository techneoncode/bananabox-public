import type { ValgrindVM } from '../shared/types';
import type { Bucket, Summary } from './types';

/**
 * One coding style finding returned by a project scan (clang diagnostics are
 * excluded).
 */
export interface StyleScanIssue {
    /** Absolute path. */
    file: string;
    line: number;
    column: number;
    bucket: Bucket;
    ruleId?: string;
    message: string;
}

export interface StyleScanResult {
    root: string;
    /** Number of C sources and headers that were checked. */
    files: number;
    summary: Summary;
    issues: StyleScanIssue[];
    durationMs: number;
    cancelled: boolean;
    error?: { message: string; notFound: boolean };
}

export interface StyleScanOptions {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    /**
     * Show the compiler-not-found / failure messages (a user-triggered run).
     */
    manual?: boolean;
}

/**
 * Programmatic surface of the coding style engine, used by the grader
 * pre-flight.
 */
export interface StyleApi {
    isEnabled(): boolean;
    scanProject(
        root: string,
        options?: StyleScanOptions,
    ): Promise<StyleScanResult>;
    /**
     * Lets the lens know each project's allowed functions and Makefile
     * requirements.
     */
    useProjectRules?(provider: ProjectRulesProvider): void;
    /**
     * The rules of some project changed (subject read, allowed functions
     * edited): check open files again.
     */
    refreshProjectRules?(): void;
    /**
     * Runs the project's program under valgrind; its leaks then show in the
     * lens, on the allocating lines.
     */
    runValgrind?(root: string): Promise<ValgrindVM>;
    /** Stops the project's check in flight. */
    cancelValgrind?(root: string): void;
    /** Whether the Makefile builds with `-g` (null without a Makefile). */
    valgrindDebug?(root: string): boolean | null;
    /** Adds `-g` to the Makefile and runs `make re`. */
    addDebugFlag?(
        root: string,
    ): Promise<{ ok: boolean; detail: string | null }>;
    /**
     * What valgrind runs for a project: the setting, or `./NAME` from its
     * Makefile.
     */
    valgrindCommand?(root: string): string;
    /**
     * Bytes lost by the project's past checks, oldest first (kept across
     * sessions).
     */
    valgrindHistory?(root: string): ValgrindVM['history'];
    /** The project's last finished check, kept across sessions. */
    valgrindLast?(root: string): ValgrindVM | undefined;
    /**
     * Asks for the command (program and arguments) and saves it; undefined
     * when dismissed.
     */
    editValgrindCommand?(root: string): Promise<string | undefined>;
    /** Saves the command for this project; empty goes back to the default. */
    setValgrindCommand?(root: string, command: string): Promise<void>;
    /**
     * Every valgrind run, whoever started it (project page or editor command):
     * running, then its result.
     */
    onDidValgrind?(
        listener: (event: { root: string; run: ValgrindVM }) => void,
    ): { dispose(): void };
}

/**
 * What the project a file belongs to requires, as read from its subject (via
 * the Bananabox account).
 */
export interface ProjectRules {
    /** Root of the project's local copy. */
    root: string;
    /**
     * Functions the project may call (subject list plus the student's own
     * additions); absent when the subject has no list.
     */
    allowedFunctions?: string[];
    /** The subject's Makefile requirements, once read. */
    makefile?: { rules: string[]; binary?: string };
    /** Subject PDF name, for messages. */
    source?: string;
}

/**
 * Looks up the rules for a file; undefined when the file is not in a known
 * project. May start reading the subject.
 */
export type ProjectRulesProvider = (file: string) => ProjectRules | undefined;
