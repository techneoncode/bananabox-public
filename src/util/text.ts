import * as vscode from 'vscode';
import { FR_TEXT } from './textFr';

/** The language of the extension host side (`bananabox.language`, else the editor's). */
function french(): boolean {
  try {
    const v = vscode.workspace.getConfiguration('bananabox').get<string>('language') ?? 'auto';
    return v === 'fr' || (v !== 'en' && (vscode.env?.language ?? '').toLowerCase().startsWith('fr'));
  } catch {
    return false;
  }
}

/**
 * Text shown to the user by the extension host. `text` is the English template
 * with `{name}` placeholders; `FR_TEXT` (keyed by that template) holds French.
 */
export function tr(text: string, params?: Record<string, string | number>): string {
  const template = french() ? FR_TEXT[text] ?? text : text;
  return params
    ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
    : template;
}
