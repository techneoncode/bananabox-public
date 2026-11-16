const patternCache = new Map<string, RegExp>();
const MAX_CACHED_PATTERNS = 256;

export function globToRegExp(glob: string): RegExp {
    const cached = patternCache.get(glob);
    if (cached) return cached;

    let expression = '';
    let inAlternatives = false;
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        switch (ch) {
            case '*':
                if (glob[i + 1] !== '*') {
                    expression += '[^/]*';
                    break;
                }
                i++;
                if (glob[i + 1] === '/') {
                    i++;
                    expression += '(?:.*/)?';
                } else {
                    expression += '.*';
                }
                break;
            case '?':
                expression += '[^/]';
                break;
            case '{':
                inAlternatives = true;
                expression += '(?:';
                break;
            case '}':
                inAlternatives = false;
                expression += ')';
                break;
            case ',':
                expression += inAlternatives ? '|' : ',';
                break;
            default:
                expression += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
        }
    }

    const pattern = new RegExp(`^${expression}$`);
    if (patternCache.size >= MAX_CACHED_PATTERNS) {
        patternCache.delete(patternCache.keys().next().value!);
    }
    patternCache.set(glob, pattern);
    return pattern;
}

export function matchesAny(
    globs: readonly string[],
    relativePath: string,
): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return globs.some(glob => globToRegExp(glob).test(normalized));
}
