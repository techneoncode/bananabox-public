/**
 * Reads quoted command arguments without expanding variables or executing
 * shell code.
 */
export function shellSplit(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inToken = false;
    let quote: '"' | "'" | undefined;
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (quote) {
            if (char === quote) {
                quote = undefined;
            } else if (char === '\\' && quote === '"'
                && i + 1 < input.length
                && '"\\$`'.includes(input[i + 1])) {
                current += input[++i];
            } else {
                current += char;
            }
        } else if (char === '"' || char === "'") {
            quote = char;
            inToken = true;
        } else if (char === '\\' && i + 1 < input.length) {
            current += input[++i];
            inToken = true;
        } else if (/\s/.test(char)) {
            if (inToken) {
                tokens.push(current);
                current = '';
                inToken = false;
            }
        } else {
            current += char;
            inToken = true;
        }
    }
    if (inToken) tokens.push(current);

    return tokens;
}

export function splitCommandChain(line: string): string[] {
    const parts: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (quote) {
            current += char;
            if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === ';' || char === '|'
            || (char === '&' && line[i + 1] === '&')) {
            if (char !== ';' && line[i + 1] === char) i++;
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim()) parts.push(current.trim());

    return parts;
}
