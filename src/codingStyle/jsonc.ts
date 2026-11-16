export function parseJsonc<T = unknown>(text: string): T {
    let json = '';
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            json += ch;
            if (ch === '\\') {
                json += text[++i] ?? '';
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            json += ch;
        } else if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            json += '\n';
        } else if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length
                && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i++;
        } else {
            json += ch;
        }
    }

    return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1')) as T;
}
