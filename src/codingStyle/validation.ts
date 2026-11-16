import { createHash } from 'node:crypto';
import { lintFile, LintRequest, LintResult } from './engine';
import { tokens } from './formatter';
import { Limiter } from './limiter';
import { utf8ColumnToIndex } from './ranges';
import { BananaDiagnostic } from './types';

function isCompleteScan(result: LintResult): boolean {
    return !result.aborted
        && !result.timedOut
        && !result.truncated
        && !result.skipped
        && !result.configError
        && !result.unparsed
        && result.exitCode >= 0
        && (result.exitCode === 0 || result.items.length > 0)
        && !result.items.some(item => !item.bucket
            && item.severity === 'error');
}

/**
 * Compares occurrences, not totals, so fixing one rule cannot hide a new
 * violation.
 * Line numbers are ignored because formatting and header insertion move
 * source.
 * Ambiguous line wrapping may conservatively reject an otherwise safe
 * proposal.
 */
export function introducesDiagnostics(
    before: readonly BananaDiagnostic[],
    after: readonly BananaDiagnostic[],
    original: string,
    candidate: string,
    file: string,
): boolean {
    if (!after.length) return false;
    if (!before.length) return true;

    const originalAnchor = tokenAnchor(original);
    const candidateAnchor = tokenAnchor(candidate);
    const counts = new Map<string, number>();
    for (const item of before) {
        const key = fingerprint(item, originalAnchor, file);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return after.some(item => {
        const key = fingerprint(item, candidateAnchor, file);
        const count = counts.get(key) ?? 0;
        if (!count) return true;
        counts.set(key, count - 1);
        return false;
    });
}

function tokenAnchor(source: string): (item: BananaDiagnostic) => number {
    const lines = source.split('\n');
    const offsets = [0];
    for (let i = 0; i < lines.length - 1; i++) {
        offsets.push(offsets[i] + lines[i].length + 1);
    }

    const tokenEnds: number[] = [];
    let cursor = 0;
    for (const token of tokens(source) ?? []) {
        const offset = source.indexOf(token, cursor);
        cursor = offset + token.length;
        if (!token.startsWith('/*') && !token.startsWith('//')) {
            tokenEnds.push(cursor);
        }
    }

    return item => {
        const line = Math.max(0, Math.min(item.line - 1, lines.length - 1));
        const position = offsets[line]
            + utf8ColumnToIndex(lines[line], item.column);
        let low = 0;
        let high = tokenEnds.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (tokenEnds[middle] <= position) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    };
}

function fingerprint(
    item: BananaDiagnostic,
    position: (item: BananaDiagnostic) => number,
    file: string,
): string {
    return JSON.stringify([
        item.file,
        item.ruleId,
        item.bucket,
        item.severity,
        item.message,
        item.file === file ? position(item) : [item.line, item.column],
    ]);
}

export class CorrectionValidator {
    private readonly snapshots = new Map<
        string,
        { key: string; result: LintResult }
    >();

    constructor(
        private readonly limiter: Limiter,
        private readonly scan: typeof lintFile = lintFile,
    ) {}

    private key(request: LintRequest, content: string): string {
        const { settings } = request;

        return createHash('sha256')
            .update(content)
            .update(JSON.stringify([
                request.workspaceRoot,
                settings.compiler,
                settings.extraArgs,
                settings.includePaths,
                settings.autoIncludes,
                settings.useCompileCommands,
                settings.useMakefile,
                settings.makeDryRun,
                settings.makefileTarget,
                settings.configFile,
            ]))
            .digest('hex');
    }

    remember(request: LintRequest, content: string, result: LintResult): void {
        this.snapshots.delete(request.file);
        if (!result.allItems
            || result.allItems.length > 2000
            || Buffer.byteLength(content) > 256 * 1024) {
            return;
        }

        const unfiltered = { ...result, items: result.allItems };
        if (!isCompleteScan(unfiltered)) return;

        if (this.snapshots.size >= 16) {
            this.snapshots.delete(this.snapshots.keys().next().value!);
        }
        this.snapshots.set(request.file, {
            key: this.key(request, content),
            result: unfiltered,
        });
    }

    forget(file: string): void {
        this.snapshots.delete(file);
    }

    clear(): void {
        this.snapshots.clear();
    }

    async validate(
        request: LintRequest,
        before: string,
        after: string,
        signal: AbortSignal,
    ): Promise<boolean> {
        const run = (content: string) => this.limiter.run(
            () => this.scan({
                ...request,
                content,
                signal,
                verification: true,
            }),
            signal,
        );

        const cached = this.snapshots.get(request.file);
        const original = cached?.key === this.key(request, before)
            ? cached.result
            : await run(before);
        if (!original || !isCompleteScan(original) || signal.aborted) {
            return false;
        }
        this.remember(request, before, original);

        const candidate = await run(after);

        return !!candidate
            && isCompleteScan(candidate)
            && !signal.aborted
            && !introducesDiagnostics(
                original.items,
                candidate.items,
                before,
                after,
                request.file,
            );
    }
}
