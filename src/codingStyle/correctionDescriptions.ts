import { ui } from './messages';

export function describeCorrections(before: string, after: string): string[] {
    const descriptions: string[] = [];
    const removed = countBlankLines(before) - countBlankLines(after);
    if (removed > 0) {
        descriptions.push(removed === 1
            ? ui('Removing the blank line')
            : ui('Removing {n} blank lines', { n: removed }));
    }
    if (countTrailingWhitespace(before) > countTrailingWhitespace(after)) {
        descriptions.push(ui('Removing trailing whitespace'));
    }
    if (/\r\n/.test(before) && !/\r\n/.test(after)) {
        descriptions.push(ui('Using Unix line endings'));
    }
    if (!before.endsWith('\n') && after.endsWith('\n')) {
        descriptions.push(ui('Adding the final newline'));
    }

    const originalLines = nonEmptyLines(before);
    const candidateLines = nonEmptyLines(after);
    if (originalLines.length === candidateLines.length
        && originalLines.every((line, i) =>
            line.trim() === candidateLines[i].trim())) {
        const indentationChanged = originalLines.some((line, index) =>
            line.match(/^[ \t]*/)?.[0]
                !== candidateLines[index].match(/^[ \t]*/)?.[0]);
        if (indentationChanged) descriptions.push(ui('Correcting indentation'));
    } else if (before.replace(/\s/g, '') === after.replace(/\s/g, '')) {
        descriptions.push(originalLines.length === candidateLines.length
            ? ui('Correcting spacing')
            : ui('Adjusting braces and line breaks'));
    }
    if (removed < 0
        && originalLines.length === candidateLines.length) {
        descriptions.push(ui('Adding a separating blank line'));
    }

    return descriptions.length ? descriptions : [ui('Correcting code layout')];
}

function countBlankLines(source: string) {
    return source
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
        .filter(line => /^[ \t]*$/.test(line))
        .length;
}

function countTrailingWhitespace(source: string) {
    return (source.match(/[ \t]+(?=\r?$)/gm) ?? []).length;
}

function nonEmptyLines(source: string) {
    return source.split(/\r?\n/).filter(line => line.trim());
}
