import * as path from 'node:path';
import * as vscode from 'vscode';
import { readSettings } from './config';
import { hasMakefileHeader, makefileHeader } from './makefile';

const TRAILING_WHITESPACE = /[ \t]+$/;

export class BananaCodeActions implements vscode.CodeActionProvider {
    static readonly metadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    };

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        if (!readSettings(document.uri).enabled) return [];

        const diagnostics = context.diagnostics
            .filter(isTrailingWhitespaceDiagnostic);
        const actions: vscode.CodeAction[] = [];

        const header = document.languageId === 'makefile'
            && context.diagnostics.find(d => d.source === 'Banana'
                && codeOf(d) === 'C-G1');
        if (header && !hasMakefileHeader(document.getText())) {
            const action = new vscode.CodeAction(
                'Insert the Epitech Makefile header',
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [header];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();

            const project = path.basename(path.dirname(document.uri.fsPath));
            const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
            action.edit.insert(
                document.uri,
                new vscode.Position(0, 0),
                makefileHeader(project, 'Makefile').replace(/\n/g, eol),
            );
            actions.push(action);
        }

        for (const diagnostic of diagnostics) {
            const range = trailingWhitespaceRange(
                document.lineAt(diagnostic.range.start.line),
            );
            if (!range) continue;

            const action = new vscode.CodeAction(
                'Remove trailing whitespace',
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();
            action.edit.delete(document.uri, range);
            actions.push(action);
        }

        if (diagnostics.length > 0) {
            const action = new vscode.CodeAction(
                'Remove all trailing whitespace in this file',
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = diagnostics;
            action.edit = trailingWhitespaceEdit(document);
            actions.push(action);
        }

        return actions;
    }
}

export function trailingWhitespaceEdit(
    document: vscode.TextDocument,
): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    for (let line = 0; line < document.lineCount; line++) {
        const range = trailingWhitespaceRange(document.lineAt(line));
        if (range) edit.delete(document.uri, range);
    }

    return edit;
}

function trailingWhitespaceRange(line: vscode.TextLine) {
    const match = TRAILING_WHITESPACE.exec(line.text);
    if (!match) return undefined;

    return new vscode.Range(
        line.lineNumber,
        match.index,
        line.lineNumber,
        line.text.length,
    );
}

function codeOf(diagnostic: vscode.Diagnostic) {
    return String(
        typeof diagnostic.code === 'object'
            ? diagnostic.code.value
            : diagnostic.code,
    );
}

function isTrailingWhitespaceDiagnostic(diagnostic: vscode.Diagnostic) {
    if (diagnostic.source !== 'Banana') return false;

    const code = typeof diagnostic.code === 'object'
        ? diagnostic.code.value
        : diagnostic.code;

    return String(code) === 'C-G7'
        || /trailing (space|whitespace)/i.test(diagnostic.message);
}
