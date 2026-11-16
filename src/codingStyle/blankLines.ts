const INSTRUCTION_START =
    /^(?:if|for|while|switch|return|do|goto|break|continue)\b|^[A-Za-z_]\w*\s*\(|^(?:\*+\s*)?[A-Za-z_]\w*(?:\s*(?:->|\.)\s*\w+|\s*\[[^\]]*\])*\s*(?:=(?!=)|\+=|-=|\+\+|--)/;

/**
 * C-L6: removes blank lines between instructions inside a function body.
 * Works on clang-format output; declarations, preprocessor lines and protected
 * macro calls are left alone, and strings or comments are masked without
 * losing lines.
 */
export function removeStatementBlankLines(
    source: string,
    protectedMacros: ReadonlySet<string>,
): string {
    const { masked, protectedLines } = maskLiteralsAndComments(source);
    const original = source.split('\n');
    const code = masked.split('\n');

    const linesToRemove = new Set<number>();
    let depth = 0;
    let functionStart = -1;
    let hasInstructions = false;
    let hasAmbiguousCode = false;
    let parentheses = 0;
    let pendingBlankLines: number[] = [];
    let previousLine = '';
    let statementStart = true;

    for (let line = 0; line < code.length; line++) {
        const text = code[line].trim();

        if (depth === 0 && text === '{' && previousLine.endsWith(')')) {
            functionStart = line;
            hasInstructions = false;
            hasAmbiguousCode = previousLine.includes('=')
                || callsProtectedMacro(previousLine, protectedMacros);
            pendingBlankLines = [];
            parentheses = 0;
            statementStart = true;
        }

        if (functionStart >= 0 && line > functionStart) {
            if (/^#/.test(text)) hasAmbiguousCode = true;
            if (callsProtectedMacro(text, protectedMacros)) {
                hasAmbiguousCode = true;
            }
            if (!hasInstructions && depth === 1 && statementStart
                && parentheses === 0 && INSTRUCTION_START.test(text)) {
                hasInstructions = true;
            }
            if (hasInstructions && depth === 1 && parentheses === 0
                && !protectedLines.has(line) && original[line].trim() === '') {
                pendingBlankLines.push(line);
            }
            if (text && depth === 1) statementStart = false;
        }

        if (/^#/.test(text)) continue;

        for (const char of text) {
            if (char === '(') parentheses++;
            if (char === ')') parentheses--;
            if (char === '{') depth++;
            if (char === '}') depth--;
            if (depth === 1 && parentheses === 0
                && (char === ';' || char === '}')) {
                statementStart = true;
            }
        }

        if (depth === 0 && functionStart >= 0) {
            if (!hasAmbiguousCode) {
                for (const blank of pendingBlankLines) {
                    linesToRemove.add(blank);
                }
            }
            functionStart = -1;
        }
        if (text) previousLine = text;
    }

    return original
        .filter((_, line) => !linesToRemove.has(line))
        .join('\n');
}

function callsProtectedMacro(
    source: string,
    protectedMacros: ReadonlySet<string>,
): boolean {
    for (const call of source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        if (protectedMacros.has(call[1])) return true;
    }

    return false;
}

function maskLiteralsAndComments(source: string) {
    const protectedLines = new Set<number>();
    let offset = 0;
    let currentLine = 0;

    const masked = source.replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
        (text: string, matchOffset: number) => {
            const before = source.slice(offset, matchOffset);
            currentLine += (before.match(/\n/g) ?? []).length;
            const count = (text.match(/\n/g) ?? []).length;
            for (let i = 0; i <= count; i++) {
                protectedLines.add(currentLine + i);
            }
            currentLine += count;
            offset = matchOffset + text.length;

            return text.replace(/[^\n]/g, ' ');
        },
    );

    return { masked, protectedLines };
}
