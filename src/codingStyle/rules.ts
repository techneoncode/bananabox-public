const FAMILIES: Record<string, string> = {
    O: 'File organisation',
    G: 'Global scope',
    F: 'Functions',
    L: 'Layout',
    V: 'Variables and types',
    C: 'Control structures',
    H: 'Headers',
    A: 'Advanced',
};

export function ruleFamily(ruleId?: string): string | undefined {
    if (/^M-[A-Z]\d+$/.test(ruleId ?? '')) return 'Makefile';
    const match = /^[A-Za-z]-([A-Za-z])\d+$/.exec(ruleId ?? '');
    return match ? FAMILIES[match[1].toUpperCase()] : undefined;
}
