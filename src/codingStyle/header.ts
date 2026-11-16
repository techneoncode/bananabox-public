import * as path from 'node:path';
import { isCorrectionSource } from './formatter';

export function hasEpitechHeader(source: string): boolean {
    const leading = /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*/
        .exec(source)?.[0] ?? '';
    return /EPITECH\s+PROJECT/i.test(leading);
}

function sanitizeHeaderText(value: string): string {
    return value
        .replace(/\/\*|\*\//g, ' ')
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 75);
}

export function addEpitechHeader(
    source: string,
    file: string,
    projectRoot: string,
    year = new Date().getFullYear(),
): string {
    if (!isCorrectionSource(source) || hasEpitechHeader(source)) return source;

    const base = path.basename(file, path.extname(file));
    const stem = sanitizeHeaderText(base.replace(/[_-]+/g, ' '))
        || 'Source file';
    const description = stem.charAt(0).toUpperCase() + stem.slice(1);
    const project = sanitizeHeaderText(path.basename(projectRoot))
        || sanitizeHeaderText(base)
        || 'Project';
    const eol = source.includes('\r\n') ? '\r\n' : '\n';

    const header = [
        '/*',
        `** EPITECH PROJECT, ${year}`,
        `** ${project}`,
        '** File description:',
        `** ${description}`,
        '*/',
        '',
        '',
    ].join(eol);
    const bom = source.charCodeAt(0) === 0xfeff ? source[0] : '';

    return bom + header + source.slice(bom.length);
}
