export function describeCorrections(before: string, after: string): string[] {
    const descriptions: string[] = [];
    const removed = countBlankLines(before) - countBlankLines(after);
    if (removed > 0) {
        descriptions.push(removed === 1
            ? 'Removing the blank line'
            : `Removing ${removed} blank lines`);
    }
    if (countTrailingWhitespace(before) > countTrailingWhitespace(after)) {
        descriptions.push('Removing trailing whitespace');
    }
    if (/\r\n/.test(before) && !/\r\n/.test(after)) {
        descriptions.push('Using Unix line endings');
    }
    if (!before.endsWith('\n') && after.endsWith('\n')) {
        descriptions.push('Adding the final newline');
    }

    const originalLines = nonEmptyLines(before);
    const candidateLines = nonEmptyLines(after);
    if (originalLines.length === candidateLines.length
        && originalLines.every((line, i) =>
            line.trim() === candidateLines[i].trim())) {
        const indentationChanged = originalLines.some((line, index) =>
            line.match(/^[ \t]*/)?.[0]
                !== candidateLines[index].match(/^[ \t]*/)?.[0]);
        if (indentationChanged) descriptions.push('Correcting indentation');
    } else if (before.replace(/\s/g, '') === after.replace(/\s/g, '')) {
        descriptions.push(originalLines.length === candidateLines.length
            ? 'Correcting spacing'
            : 'Adjusting braces and line breaks');
    }
    if (removed < 0
        && originalLines.length === candidateLines.length) {
        descriptions.push('Adding a separating blank line');
    }

    return descriptions.length ? descriptions : ['Correcting code layout'];
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
