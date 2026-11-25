/**
 * What VS Code reads from package.json when it loads an extension. A new version can replace the
 * running code in place only when these are unchanged: otherwise VS Code would keep showing the old
 * commands, views, menus or settings until a window reload.
 */
const RUNTIME_FIELDS = ['main', 'browser', 'contributes', 'activationEvents', 'engines', 'extensionKind', 'enabledApiProposals', 'capabilities'];

export function sameRuntimeContract(running: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return RUNTIME_FIELDS.every(key => JSON.stringify(running[key] ?? null) === JSON.stringify(next[key] ?? null));
}
