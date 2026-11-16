export class EventEmitter<T> {
  private listeners = new Set<(event: T) => void>();
  event = (fn: (event: T) => void) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
  fire(value: T) { for (const fn of this.listeners) fn(value); }
  dispose() { this.listeners.clear(); }
}
export const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
};
export const commands = { executeCommand: async () => undefined };
export const env = { language: 'en' };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
export const ProgressLocation = { Notification: 15 };
export const window = { createOutputChannel: () => ({ appendLine() {}, dispose() {}, trace() {}, debug() {}, info() {}, warn() {}, error() {} }) };
export const Uri = {
  file: (path: string) => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` }),
  parse: (url: string) => ({ scheme: new URL(url).protocol.slice(0, -1), fsPath: new URL(url).pathname, toString: () => url }),
};

export const authentication = { getSession: async (..._args: any[]): Promise<any> => undefined };
export class TreeItem { constructor(public label: string, public collapsibleState?: number) {} }
export class ThemeIcon { constructor(public id: string) {} }
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const FileSystemError = { FileNotFound: () => new Error('File not found') };

export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

export const ViewColumn = { Active: -1, One: 1 };
