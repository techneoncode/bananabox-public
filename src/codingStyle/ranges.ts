import { BananaDiagnostic } from './types';

/** Converts a 1-based UTF-8 byte column (clang) to a UTF-16 index (VS Code). */
export function utf8ColumnToIndex(text: string, column: number): number {
    if (column <= 1) return 0;
    if (/^[\x00-\x7f]*$/.test(text)) return Math.min(column - 1, text.length);

    const target = column - 1;
    let bytes = 0;
    let index = 0;
    while (index < text.length && bytes < target) {
        const codePoint = text.codePointAt(index)!;
        if (codePoint < 0x80) {
            bytes += 1;
        } else if (codePoint < 0x800) {
            bytes += 2;
        } else if (codePoint < 0x10000) {
            bytes += 3;
        } else {
            bytes += 4;
        }
        index += codePoint > 0xffff ? 2 : 1;
    }

    return index;
}

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_]/;

export function computeRange(
    text: string,
    diagnostic: Pick<
        BananaDiagnostic,
        'column' | 'message' | 'rangeStartColumn' | 'rangeLength'
    >,
): { start: number; end: number } {
    if (text.length === 0) return { start: 0, end: 0 };

    if (/trailing/i.test(diagnostic.message)) {
        const trailingWhitespace = /[ \t]+$/.exec(text);
        if (trailingWhitespace) {
            return { start: trailingWhitespace.index, end: text.length };
        }
    }

    if (diagnostic.rangeLength && diagnostic.rangeLength > 1) {
        const start = Math.min(
            text.length - 1,
            utf8ColumnToIndex(
                text,
                diagnostic.rangeStartColumn ?? diagnostic.column,
            ),
        );
        const end = Math.min(text.length, start + diagnostic.rangeLength);
        if (end > start) return { start, end };
    }

    const trimmedStart = text.length - text.trimStart().length;
    const trimmedEnd = text.trimEnd().length;
    if (trimmedEnd === 0) return { start: 0, end: text.length };

    const caretIndex = Math.min(
        utf8ColumnToIndex(text, diagnostic.column),
        text.length - 1,
    );

    if (/too long|exceed|columns?\b|characters?\b/i.test(diagnostic.message)
        && caretIndex > trimmedStart) {
        return { start: caretIndex, end: trimmedEnd };
    }
    if (caretIndex < trimmedStart) {
        return { start: trimmedStart, end: trimmedEnd };
    }

    if (IDENTIFIER_CHARACTER.test(text[caretIndex])) {
        let start = caretIndex;
        let end = caretIndex;
        while (start > 0 && IDENTIFIER_CHARACTER.test(text[start - 1])) start--;
        while (end < text.length && IDENTIFIER_CHARACTER.test(text[end])) end++;
        return { start, end };
    }
    if (/\s/.test(text[caretIndex])) {
        return { start: trimmedStart, end: trimmedEnd };
    }

    return { start: caretIndex, end: caretIndex + 1 };
}
