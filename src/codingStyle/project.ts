import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseJsonc } from './jsonc';
import { shellSplit } from './shell';
import { BananaLensProjectConfig } from './types';

const CONFIG_NAMES = ['.bananalens.json', 'bananalens.json'];
const BUILD_MARKERS = [
    'Makefile', 'makefile', 'GNUmakefile', 'compile_commands.json',
    'CMakeLists.txt', 'meson.build',
];
const SKIP_DIRS = new Set([
    '.git', 'node_modules', '.vscode', 'out', 'build', 'dist', 'target',
    '.cache', '.idea', 'venv', '__pycache__',
]);
const PREFERRED_INCLUDE_NAMES = new Set([
    'include', 'includes', 'inc', 'headers',
]);

const rootCache = new Map<string, { root: string; until: number }>();

function exists(file: string): boolean {
    try {
        fs.accessSync(file);
        return true;
    } catch {
        return false;
    }
}

function isDir(directory: string): boolean {
    try {
        return fs.statSync(directory).isDirectory();
    } catch {
        return false;
    }
}

function mtime(file: string): number {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
}

export function detectProjectRoot(
    file: string,
    workspaceRoot?: string,
): string {
    const start = path.dirname(file);
    const key = `${start}\0${workspaceRoot ?? ''}`;
    const cached = rootCache.get(key);
    if (cached && cached.until > Date.now()) return cached.root;

    const remember = (root: string): string => {
        if (rootCache.size >= 512) {
            rootCache.delete(rootCache.keys().next().value!);
        }
        rootCache.set(key, { root, until: Date.now() + 5000 });

        return root;
    };

    const boundary = workspaceRoot && isInside(start, workspaceRoot)
        ? path.resolve(workspaceRoot)
        : undefined;
    const chain: string[] = [];
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
        chain.push(dir);
        if (dir === boundary || path.dirname(dir) === dir) break;
        if (!boundary && chain.length > 8) break;
    }

    for (const dir of chain) {
        if (CONFIG_NAMES.some(name => exists(path.join(dir, name)))) {
            return remember(dir);
        }
    }
    for (const dir of chain) {
        if (exists(path.join(dir, '.git'))) return remember(dir);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
        const dir = chain[i];
        if (BUILD_MARKERS.some(name => exists(path.join(dir, name)))) {
            return remember(dir);
        }
    }

    return remember(boundary ?? path.resolve(start));
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);

    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface LoadedProjectConfig {
    config: BananaLensProjectConfig;
    path?: string;
    error?: string;
}

const configCache = new Map<
    string,
    { stamp: string; value: LoadedProjectConfig }
>();

export function loadProjectConfigFile(
    root: string,
    configured = '.bananalens.json',
): LoadedProjectConfig {
    const candidates = [...new Set(
        [configured, ...CONFIG_NAMES].map(n => path.resolve(root, n)),
    )];
    for (const candidate of candidates) {
        const stamp = String(mtime(candidate));
        if (stamp === '0') continue;

        const cached = configCache.get(candidate);
        if (cached?.stamp === stamp) return cached.value;

        let value: LoadedProjectConfig;
        try {
            value = {
                config: parseJsonc<BananaLensProjectConfig>(
                    fs.readFileSync(candidate, 'utf8'),
                ),
                path: candidate,
            };
        } catch (error) {
            value = {
                config: {},
                path: candidate,
                error: `Invalid Bananabox Coding Style configuration at ${candidate}: ${String(error)}`,
            };
        }
        configCache.set(candidate, { stamp, value });

        return value;
    }

    return { config: {} };
}

const includeCache = new Map<string, Promise<string[]>>();
let cacheGeneration = 0;

export function clearProjectCaches(): void {
    cacheGeneration++;
    rootCache.clear();
    configCache.clear();
    includeCache.clear();
    harvestCache.clear();
    makefileListCache.clear();
    compileDbCache.clear();
}

export function discoverIncludeDirs(
    root: string,
    limit = 20,
): Promise<string[]> {
    const key = `${root}\0${limit}`;
    const cached = includeCache.get(key);
    if (cached) return cached;

    const pending = discover(root, limit, cacheGeneration);
    if (includeCache.size >= 128) {
        includeCache.delete(includeCache.keys().next().value!);
    }
    includeCache.set(key, pending);

    return pending;
}

async function discover(
    root: string,
    limit: number,
    generation: number,
): Promise<string[]> {
    const found: { dir: string; depth: number }[] = [];
    const queue = [{ dir: root, depth: 0 }];
    let cursor = 0;

    while (cursor < queue.length && generation === cacheGeneration) {
        const batch = queue.slice(cursor, cursor + 16);
        cursor += batch.length;
        const results = await Promise.all(batch.map(async item => ({
            ...item,
            entries: await readDirectory(item.dir),
        })));
        for (const { dir, depth, entries } of results) {
            if (entries.some(entry => entry.isFile()
                && /\.(h|hpp|hh)$/i.test(entry.name))) {
                found.push({ dir, depth });
            }
            if (depth >= 5) continue;

            for (const entry of entries) {
                if (queue.length >= 4000) break;
                if (entry.isDirectory()
                    && !SKIP_DIRS.has(entry.name)
                    && !entry.name.startsWith('cmake-build')) {
                    queue.push({
                        dir: path.join(dir, entry.name),
                        depth: depth + 1,
                    });
                }
            }
        }
    }

    const score = (
        { dir, depth }: { dir: string; depth: number },
    ): number => {
        const preferred = PREFERRED_INCLUDE_NAMES.has(path.basename(dir));

        return (preferred ? 0 : 1000) + depth;
    };

    return found
        .sort((a, b) => score(a) - score(b))
        .slice(0, limit)
        .map(entry => entry.dir);
}

async function readDirectory(directory: string): Promise<fs.Dirent[]> {
    try {
        return await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}

export interface HarvestedFlags {
    includeDirs: string[];
    defines: string[];
    std?: string;
}

const makefileListCache = new Map<
    string,
    { rootStamp: number; files: string[] }
>();
const harvestCache = new Map<
    string,
    { stamp: string; value: HarvestedFlags }
>();

export function harvestMakefileFlags(root: string): HarvestedFlags {
    const oldFiles = makefileListCache.get(root);
    const files = oldFiles && oldFiles.rootStamp === mtime(root)
        ? oldFiles.files
        : collectMakefiles(root);
    const stamp = files.map(f => `${f}:${mtime(f)}`).join('|');
    const cached = harvestCache.get(root);
    if (cached?.stamp === stamp) return cached.value;

    const freshFiles = collectMakefiles(root);
    makefileListCache.set(root, { rootStamp: mtime(root), files: freshFiles });
    const freshStamp = freshFiles.map(f => `${f}:${mtime(f)}`).join('|');
    const includeDirs: string[] = [];
    const defines: string[] = [];
    let std: string | undefined;
    const token = /(?:^|\s)(-I\s*[^\s"'$]+|-isystem\s+[^\s"'$]+|-D\s*[A-Za-z_][^\s"'$]*|-std=[^\s"'$]+)/g;

    for (const file of freshFiles) {
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }

        const logical = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
        for (const raw of logical) {
            if (/^\s*#/.test(raw)) continue;
            const line = raw
                .replace(/\s#.*$/, '')
                .replace(
                    /\$[({](?:CURDIR|PWD|shell pwd|abspath \.|realpath \.)[)}]/g,
                    '.',
                );
            for (const match of line.matchAll(token)) {
                const flag = match[1].trim();
                if (flag.startsWith('-std=')) {
                    std = flag;
                } else if (flag.startsWith('-D')) {
                    defines.push(flag.replace(/^-D\s+/, '-D'));
                } else {
                    const dir = path.resolve(
                        root,
                        flag
                            .replace(/^-(?:I|isystem)\s*/, '')
                            .replace(/\/+$/, ''),
                    );
                    if (isDir(dir) && !includeDirs.includes(dir)) {
                        includeDirs.push(dir);
                    }
                }
            }
        }
    }

    const value = { includeDirs, defines: [...new Set(defines)], std };
    harvestCache.set(root, { stamp: freshStamp, value });

    return value;
}

function collectMakefiles(root: string): string[] {
    const result: string[] = [];
    const visit = (file: string): void => {
        if (result.length >= 8 || result.includes(file)
            || !exists(file)) {
            return;
        }
        result.push(file);

        let text = '';
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            return;
        }
        for (const match of text.matchAll(/^-?include\s+([^\s$#]+)/gm)) {
            visit(path.resolve(path.dirname(file), match[1]));
        }
    };

    for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
        visit(path.join(root, name));
    }
    try {
        for (const name of fs.readdirSync(root)) {
            if (name.endsWith('.mk')) visit(path.join(root, name));
        }
    } catch {}

    return result;
}

interface CompileEntry {
    file: string;
    directory?: string;
    command?: string;
    arguments?: string[];
}

const compileDbCache = new Map<
    string,
    { stamp: number; byFile: Map<string, CompileEntry> }
>();

export function findCompileCommandsEntry(
    root: string,
    sourceFile: string,
): { tokens: string[]; directory: string } | undefined {
    const candidates = [
        path.join(root, 'compile_commands.json'),
        path.join(root, 'build', 'compile_commands.json'),
    ];
    try {
        const profiles = fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory()
                && entry.name.startsWith('cmake-build-'))
            .map(entry => entry.name)
            .sort();
        for (const profile of profiles) {
            candidates.push(path.join(root, profile, 'compile_commands.json'));
        }
    } catch {}

    const resolved = path.resolve(sourceFile);
    for (const dbPath of candidates) {
        const stamp = mtime(dbPath);
        if (!stamp) continue;

        let db = compileDbCache.get(dbPath);
        if (db?.stamp !== stamp) {
            db = { stamp, byFile: readCompileDatabase(dbPath, root) };
            compileDbCache.set(dbPath, db);
        }

        const entry = db.byFile.get(resolved);
        if (!entry) continue;

        const directory = path.resolve(entry.directory ?? root);
        if (entry.arguments) {
            return { tokens: entry.arguments.slice(1), directory };
        }
        if (entry.command) {
            return { tokens: shellSplit(entry.command).slice(1), directory };
        }
    }

    return undefined;
}

function readCompileDatabase(
    file: string,
    root: string,
): Map<string, CompileEntry> {
    try {
        const entries = JSON.parse(
            fs.readFileSync(file, 'utf8'),
        ) as CompileEntry[];
        const byFile = new Map<string, CompileEntry>();
        for (const entry of entries) {
            byFile.set(
                path.resolve(entry.directory ?? root, entry.file),
                entry,
            );
        }

        return byFile;
    } catch {
        return new Map();
    }
}
