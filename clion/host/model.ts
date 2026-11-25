import { pathToFileURL, fileURLToPath } from 'node:url';
import * as path from 'node:path';

export class Disposable {
  constructor(private readonly callback: () => unknown = () => {}) {}
  dispose(): void { this.callback(); }
  static from(...items: { dispose(): void }[]): Disposable { return new Disposable(() => items.forEach(item => item.dispose())); }
}
export class EventEmitter<T = void> {
  private listeners = new Set<(value: T) => unknown>();
  event = (callback: (value: T) => unknown, thisArg?: unknown, disposables?: Disposable[]): Disposable => {
    const fn = thisArg ? callback.bind(thisArg) : callback;
    this.listeners.add(fn);
    const disposable = new Disposable(() => this.listeners.delete(fn));
    disposables?.push(disposable);
    return disposable;
  };
  fire(value: T): void {
    for (const fn of this.listeners) {
      try { Promise.resolve(fn(value)).catch(error => process.stderr.write(`${error}\n`)); }
      catch (error) { process.stderr.write(`${error}\n`); }
    }
  }
  dispose(): void { this.listeners.clear(); }
}
export class Uri {
  constructor(readonly scheme: string, readonly authority = '', readonly path = '', readonly query = '', readonly fragment = '') {}
  static file(file: string): Uri { return Uri.parse(pathToFileURL(path.resolve(file)).href); }
  static parse(value: string): Uri {
    const url = new URL(value);
    return new Uri(url.protocol.slice(0, -1), url.host, decodeURIComponent(url.pathname), url.search.slice(1), url.hash.slice(1));
  }
  static from(parts: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(parts.scheme, parts.authority, parts.path, parts.query, parts.fragment);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri { return base.with({ path: path.posix.join(base.path, ...parts) }); }
  get fsPath(): string { return this.scheme === 'file' ? fileURLToPath(this.toString()) : this.path; }
  with(parts: Partial<Uri>): Uri { return new Uri(parts.scheme ?? this.scheme, parts.authority ?? this.authority, parts.path ?? this.path, parts.query ?? this.query, parts.fragment ?? this.fragment); }
  toString(): string {
    return `${this.scheme}:${this.authority || this.scheme === 'file' ? '//' + this.authority : ''}${this.path.split('/').map(encodeURIComponent).join('/')}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
  }
  toJSON(): string { return this.toString(); }
}
export class Position {
  constructor(readonly line: number, readonly character: number) {}
  compareTo(other: Position): number { return this.line - other.line || this.character - other.character; }
  isBefore(other: Position): boolean { return this.compareTo(other) < 0; }
  isAfter(other: Position): boolean { return this.compareTo(other) > 0; }
  isEqual(other: Position): boolean { return this.compareTo(other) === 0; }
  translate(lineDelta = 0, characterDelta = 0): Position { return new Position(this.line + lineDelta, this.character + characterDelta); }
}
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    this.start = typeof a === 'number' ? new Position(a, b as number) : a;
    this.end = typeof a === 'number' ? new Position(c!, d!) : b as Position;
  }
  get isEmpty(): boolean { return this.start.isEqual(this.end); }
  contains(position: Position): boolean { return !position.isBefore(this.start) && !position.isAfter(this.end); }
}
export class Selection extends Range {
  get active(): Position { return this.end; }
  get anchor(): Position { return this.start; }
}
export class TextEdit {
  newEol?: number;
  constructor(readonly range: Range, readonly newText: string) {}
  static replace(range: Range, text: string): TextEdit { return new TextEdit(range, text); }
  static setEndOfLine(eol: number): TextEdit { const edit = new TextEdit(new Range(0, 0, 0, 0), ''); edit.newEol = eol; return edit; }
}
export class WorkspaceEdit {
  readonly edits = new Map<string, TextEdit[]>();
  set(uri: Uri, edits: TextEdit[]): void { this.edits.set(uri.toString(), edits); }
  replace(uri: Uri, range: Range, text: string): void { const key = uri.toString(); this.edits.set(key, [...this.edits.get(key) ?? [], new TextEdit(range, text)]); }
  delete(uri: Uri, range: Range): void { this.replace(uri, range, ''); }
}
export class Document {
  version = 1;
  isDirty = false;
  isClosed = false;
  constructor(readonly uri: Uri, private text: string, readonly languageId = /\.(c|h)$/i.test(uri.path) ? 'c' : /\.(cpp|hpp|cc|hh|cxx|hxx)$/i.test(uri.path) ? 'cpp' : 'plaintext') {}
  get fileName(): string { return this.uri.fsPath; }
  get isUntitled(): boolean { return this.uri.scheme === 'untitled'; }
  get eol(): number { return this.text.includes('\r\n') ? 2 : 1; }
  get lineCount(): number { return this.text.split('\n').length; }
  getText(range?: Range): string { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; }
  update(text: string, version: number, dirty: boolean): void { this.text = text; this.version = version; this.isDirty = dirty; }
  lineAt(value: number | Position): any {
    const lineNumber = typeof value === 'number' ? value : value.line;
    const text = this.text.split('\n')[lineNumber]?.replace(/\r$/, '') ?? '';
    return { lineNumber, text, range: new Range(lineNumber, 0, lineNumber, text.length),
      rangeIncludingLineBreak: lineNumber + 1 < this.lineCount ? new Range(lineNumber, 0, lineNumber + 1, 0) : new Range(lineNumber, 0, lineNumber, text.length),
      firstNonWhitespaceCharacterIndex: text.search(/\S/) < 0 ? text.length : text.search(/\S/), isEmptyOrWhitespace: !text.trim() };
  }
  offsetAt(position: Position): number {
    const lines = this.text.split('\n'); const line = Math.max(0, Math.min(position.line, lines.length - 1));
    return lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + Math.min(Math.max(0, position.character), lines[line].replace(/\r$/, '').length);
  }
  positionAt(offset: number): Position {
    const prefix = this.text.slice(0, Math.max(0, Math.min(offset, this.text.length))).split('\n');
    return new Position(prefix.length - 1, prefix[prefix.length - 1].replace(/\r$/, '').length);
  }
  validateRange(range: Range): Range { return new Range(this.positionAt(this.offsetAt(range.start)), this.positionAt(this.offsetAt(range.end))); }
}
export function editedText(document: Document, edits: TextEdit[]): string {
  let text = document.getText();
  const changes = edits.filter(edit => edit.newEol === undefined).map(edit => ({ start: document.offsetAt(edit.range.start), end: document.offsetAt(edit.range.end), text: edit.newText })).sort((a, b) => b.start - a.start);
  let boundary = text.length;
  for (const change of changes) {
    if (change.end > boundary || change.start > change.end) throw new Error('Overlapping text edits');
    text = text.slice(0, change.start) + change.text + text.slice(change.end); boundary = change.start;
  }
  const eol = edits.find(edit => edit.newEol !== undefined)?.newEol;
  return eol === undefined ? text : text.replace(/\r?\n/g, eol === 2 ? '\r\n' : '\n');
}
