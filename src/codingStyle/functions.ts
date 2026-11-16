import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    findDisallowedCalls,
    isTestPath,
    projectNames,
} from '../domain/allowedFunctions';
import { BananaDiagnostic } from './types';

const SOURCE = /\.(?:c|h)$/i;
const SKIP_DIRS = new Set([
    '.git', 'node_modules', '.vscode', '.idea', 'build', 'obj',
]);
const MAX_FILES = 2000;

/**
 * Names each project defines (functions, macros, prototypes in its headers),
 * so calls to them are never flagged.
 * Read from disk once per project and forgotten when one of its C files
 * changes.
 */
export class ProjectNames {
    private readonly cache = new Map<string, Promise<Set<string>>>();

    invalidate(file?: string): void {
        if (!file) {
            this.cache.clear();
            return;
        }

        for (const root of this.cache.keys()) {
            if (file === root || file.startsWith(root + path.sep)) {
                this.cache.delete(root);
            }
        }
    }

    get(root: string): Promise<Set<string>> {
        let names = this.cache.get(root);
        if (!names) {
            names = collect(root).catch(() => new Set<string>());
            this.cache.set(root, names);
        }

        return names;
    }
}

async function collect(root: string): Promise<Set<string>> {
    const files: { file: string; text: string }[] = [];

    const walk = async (dir: string): Promise<void> => {
        if (files.length >= MAX_FILES) return;
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)
                    && !entry.name.startsWith('.')) {
                    await walk(full);
                }
            } else if (entry.isFile() && SOURCE.test(entry.name)
                && files.length < MAX_FILES) {
                files.push({
                    file: full,
                    text: await fs.promises.readFile(full, 'utf8')
                        .catch(() => ''),
                });
            }
        }
    };

    await walk(root);

    return projectNames(files);
}

/**
 * Calls in `text` to functions neither the allowed list nor the project
 * provides. Test files are not checked.
 */
export function unauthorizedCalls(
    file: string,
    text: string,
    root: string,
    allowed: readonly string[],
    known: ReadonlySet<string>,
): BananaDiagnostic[] {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (isTestPath(relative)) return [];

    const lines = text.split('\n');
    return findDisallowedCalls(
        [{ file, text }],
        new Set(allowed),
        new Set(),
        known,
    ).map(call => {
        const column = Buffer.byteLength(
            (lines[call.line - 1] ?? '').slice(0, call.column - 1),
        ) + 1;

        return {
            file,
            line: call.line,
            column,
            rangeStartColumn: column,
            rangeLength: call.message.length,
            severity: 'error',
            rawSeverity: 'error',
            level: 'Unauthorized',
            kind: 'function',
            clangOption: 'unauthorized-function',
            message: `${call.message}() is not in the subject's allowed functions.`,
            notes: [],
        } satisfies BananaDiagnostic;
    });
}
