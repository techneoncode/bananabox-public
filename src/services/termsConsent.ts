import type * as vscode from 'vscode';

const TERMS_KEY = 'bananabox.termsAccepted.v1';

export const termsAccepted = (state: vscode.Memento): boolean => state.get<boolean>(TERMS_KEY) === true;

export const acceptTerms = (state: vscode.Memento): Thenable<void> => state.update(TERMS_KEY, true);
