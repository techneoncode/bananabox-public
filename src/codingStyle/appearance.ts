import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { validColor } from './config';

type Field = { key: string; label: string } & (
    | { type: 'checkbox' | 'color' }
    | { type: 'select'; values: string[] }
    | { type: 'number'; min: number; max: number }
);
type Scope = 'user' | 'workspace' | 'folder';

const CONFIGURATION_TARGETS: Record<Scope, vscode.ConfigurationTarget> = {
    user: vscode.ConfigurationTarget.Global,
    workspace: vscode.ConfigurationTarget.Workspace,
    folder: vscode.ConfigurationTarget.WorkspaceFolder,
};

export const APPEARANCE_FIELDS: Field[] = [
    {
        key: 'inline.mode',
        label: 'Display mode',
        type: 'select',
        values: ['off', 'compact', 'full'],
    },
    { key: 'inline.showLevel', label: 'Show severity', type: 'checkbox' },
    {
        key: 'inline.showRuleId',
        label: 'Rule ID',
        type: 'select',
        values: ['auto', 'always', 'never'],
    },
    {
        key: 'inline.showMessage',
        label: 'Message',
        type: 'select',
        values: ['auto', 'always', 'never'],
    },
    {
        key: 'inline.showMarker',
        label: 'Show severity square',
        type: 'checkbox',
    },
    {
        key: 'inline.showClangWarnings',
        label: 'Include compiler warnings',
        type: 'checkbox',
    },
    {
        key: 'inline.gap',
        label: 'Space after code (characters)',
        type: 'number',
        min: 0,
        max: 16,
    },
    {
        key: 'inline.maxPerLine',
        label: 'Messages per line (0 = all)',
        type: 'number',
        min: 0,
        max: 10,
    },
    {
        key: 'inline.maxMessageLength',
        label: 'Maximum message length',
        type: 'number',
        min: 20,
        max: 1000,
    },
    { key: 'inline.bold', label: 'Bold text', type: 'checkbox' },
    { key: 'inline.italic', label: 'Italic text', type: 'checkbox' },
    { key: 'inline.background', label: 'Message background', type: 'checkbox' },
    { key: 'inline.underline', label: 'Code underline', type: 'checkbox' },
    ...(['fatal', 'major', 'minor', 'info', 'function'] as const).flatMap(
        bucket => ['foreground', 'background', 'underline'].map(part => ({
            key: `inline.colors.${bucket}.${part}`,
            label: `${bucket === 'function' ? 'Unauthorized function' : `${bucket[0].toUpperCase()}${bucket.slice(1)}`} ${part}`,
            type: 'color' as const,
        }))),
];

export function validAppearanceValue(key: string, value: unknown): boolean {
    const field = APPEARANCE_FIELDS.find(field => field.key === key);
    if (!field) return false;
    if (value === null) return true;
    switch (field.type) {
        case 'color':
            return validColor(value);
        case 'checkbox':
            return typeof value === 'boolean';
        case 'select':
            return typeof value === 'string' && field.values.includes(value);
        case 'number':
            return typeof value === 'number' && Number.isInteger(value)
                && value >= field.min && value <= field.max;
    }
}

let panel: vscode.WebviewPanel | undefined;

export function showAppearance(context: vscode.ExtensionContext): void {
    if (panel) {
        panel.reveal();
        return;
    }

    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    const current = vscode.window.createWebviewPanel(
        'bananalens.appearance',
        'Bananabox Coding Style · Appearance',
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [] },
    );
    panel = current;
    const nonce = crypto.randomBytes(24).toString('base64');
    current.webview.html = html(nonce);

    const scopes: Scope[] = ['user'];
    if (vscode.workspace.workspaceFolders?.length) scopes.push('workspace');
    if (folder) scopes.push('folder');
    let scope: Scope = 'user';
    let saving = false;
    let disposed = false;
    const snapshot = () => {
        if (disposed) return;
        const config = vscode.workspace.getConfiguration('bananalens', uri);
        const values = appearanceValues(config, scope);
        void current.webview.postMessage({
            type: 'settings',
            values,
            scopes,
            scope,
        });
    };
    const listener = current.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object' || saving) return;
        if (message.type === 'ready') {
            if (scopes.includes(message.scope)) scope = message.scope;
            snapshot();
            return;
        }
        if (message.type === 'scope' && scopes.includes(message.scope)) {
            scope = message.scope;
            snapshot();
            return;
        }
        if (message.type !== 'apply' || !message.values
            || typeof message.values !== 'object'
            || Array.isArray(message.values)) {
            return;
        }

        const entries = Object.entries(message.values);
        if (entries.length > APPEARANCE_FIELDS.length
            || !entries.every(
                ([key, value]) => validAppearanceValue(key, value),
            )) {
            void current.webview.postMessage({
                type: 'error',
                text: 'Check the values. Colours accept #RRGGBB or #RRGGBBAA, or an empty value for the theme.',
            });
            return;
        }

        saving = true;
        try {
            const target = CONFIGURATION_TARGETS[scope];
            const config = vscode.workspace.getConfiguration('bananalens', uri);
            for (const [key, value] of entries) {
                await config.update(
                    key,
                    value === null ? undefined : value,
                    target,
                );
            }
            snapshot();
            void current.webview.postMessage({ type: 'saved' });
        } catch (error) {
            void current.webview.postMessage({
                type: 'error',
                text: `Settings could not be saved: ${String(error)}`,
            });
        } finally {
            saving = false;
        }
    });
    const settingsListener =
        vscode.workspace.onDidChangeConfiguration(event => {
            if (!saving && event.affectsConfiguration('bananalens.inline')) {
                snapshot();
            }
        });
    current.onDidDispose(() => {
        disposed = true;
        listener.dispose();
        settingsListener.dispose();
        if (panel === current) panel = undefined;
    });
    context.subscriptions.push(current);
}

function appearanceValues(
    config: vscode.WorkspaceConfiguration,
    scope: Scope,
) {
    const values: Record<string, unknown> = {};
    for (const field of APPEARANCE_FIELDS) {
        const setting = config.inspect(field.key);
        values[field.key] = (scope === 'folder'
            ? setting?.workspaceFolderValue
            : undefined)
            ?? (scope !== 'user' ? setting?.workspaceValue : undefined)
            ?? setting?.globalValue
            ?? setting?.defaultValue;
    }
    return values;
}

function fieldHtml(field: Field) {
    const id = field.key;
    if (field.type === 'color') {
        return `<div class="field colour">
    <label for="${id}">${field.label}</label>
    <div class="colour-inputs">
        <input type="color" data-picker="${id}" aria-label="Pick ${field.label}">
        <input id="${id}" data-key="${id}" type="text" placeholder="Theme default"
            maxlength="9" spellcheck="false" pattern="(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)?"
            aria-label="${field.label} hexadecimal value">
        <button type="button" data-theme="${id}">Theme</button>
    </div>
</div>`;
    }
    let input: string;
    if (field.type === 'select') {
        const options = field.values
            .map(value => `<option value="${value}">${value}</option>`)
            .join('');
        input = `<select id="${id}" data-key="${id}">${options}</select>`;
    } else {
        const bounds = field.type === 'number'
            ? `min="${field.min}" max="${field.max}" step="1" required`
            : '';
        input =
            `<input id="${id}" data-key="${id}" type="${field.type}" ${bounds}>`;
    }
    return `<div class="field"><label for="${id}">${field.label}</label>${input}</div>`;
}

function html(nonce: string) {
    const fields = APPEARANCE_FIELDS.map(fieldHtml);
    const split = APPEARANCE_FIELDS.findIndex(field => field.type === 'color');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
    line-height: 1.5;
}
h1 {
    font-size: 24px;
    margin-bottom: 4px;
}
p {
    color: var(--vscode-descriptionForeground);
}
section {
    margin: 24px 0;
}
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(270px,1fr));
    gap: 16px 28px;
}
.field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.colour {
    display: block;
}
.colour label {
    display: block;
    margin-bottom: 6px;
}
.colour-inputs {
    display: flex;
    gap: 8px;
}
input,select,button {
    font: inherit;
    border: 1px solid var(--vscode-input-border,transparent);
    border-radius: 3px;
    padding: 5px 8px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
}
input[type=number] {
    width: 70px;
}
input[type=checkbox] {
    accent-color: var(--vscode-focusBorder);
}
input[type=color] {
    width: 44px;
    height: 34px;
    padding: 2px;
    cursor: pointer;
}
input[type=text] {
    width: 112px;
}
button {
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
}
input:invalid {
    outline: 1px solid var(--vscode-errorForeground);
}
.preview {
    font-family: var(--vscode-editor-font-family,monospace);
    overflow: auto;
    padding: 16px;
    background: var(--vscode-textCodeBlock-background);
    white-space: pre;
}
.preview div {
    margin: 8px 0;
}
.toolbar {
    position: sticky;
    bottom: 0;
    background: var(--vscode-editor-background);
    padding: 16px 0;
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    border-top: 1px solid var(--vscode-widget-border);
}
#status {
    flex: 1;
}
button:disabled {
    opacity: .5;
    cursor: default;
}

</style>
</head>
<body>
<h1>Bananabox Coding Style appearance</h1><p>Choose what stays visible while you code. Preview changes here, then apply them to your editor.</p>
<label for="scope">Save settings for </label><select id="scope" aria-label="Settings scope"></select>
<form id="form"><section><h2>Content &amp; layout</h2><p>Auto follows Compact / Full mode. Hidden details remain available on hover.</p><div class="grid">${fields.slice(0, split).join('')}</div></section>
<section><h2>Colours by severity</h2><p>Pick a colour or enter a hex value. Add two hex digits for opacity (#RRGGBBAA). Theme keeps your theme’s adaptive colours. Colours also apply to the file summary.</p><div class="grid">${fields.slice(split).join('')}</div></section>
<section><h2>Preview</h2><div class="preview" id="preview" aria-label="Lens preview"></div></section>
<div class="toolbar"><button class="primary" id="apply" type="submit" disabled>Apply changes</button><button id="reset" type="button">Reset appearance</button><span id="status" role="status" aria-live="polite"></span></div></form>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const form = document.getElementById('form');
const status = document.getElementById('status');
const apply = document.getElementById('apply');
const scope = document.getElementById('scope');
const inputs = [...document.querySelectorAll('[data-key]')];
const restored = vscode.getState();
let baseline = {};
let pending = restored?.pending ?? {};
let busy = false;

function values() {
    return Object.fromEntries(inputs.map(input => {
        const value = input.type === 'checkbox' ? input.checked
            : input.type === 'number' ? Number(input.value) : input.value;
        return [input.dataset.key, value];
    }));
}

function changedValues() {
    return Object.fromEntries(Object.entries(values()).filter(([key, value]) => value !== baseline[key]));
}

function rememberDraft() {
    vscode.setState({ pending, scope: scope.value });
}

function previewRow(settings, bucket, level, rule, sample) {
    const row = document.createElement('div');
    const code = document.createElement('span');
    const lens = document.createElement('span');
    code.textContent = '    int pos = 24;';
    const colour = part => settings['inline.colors.' + bucket + '.' + part]
        || 'var(--vscode-bananalens-inline-' + bucket + part[0].toUpperCase() + part.slice(1) + ')';
    const show = key => settings[key] === 'always'
        || settings[key] === 'auto' && settings['inline.mode'] === 'full';
    const prefix = [
        settings['inline.showLevel'] ? '[' + level + ']' : '',
        show('inline.showRuleId') ? rule : '',
    ].filter(Boolean).join(' ');
    const message = show('inline.showMessage') ? sample || 'Example coding-style diagnostic' : '';
    let text = prefix && message ? prefix + ': ' + message : prefix || message;
    const maxLength = settings['inline.maxMessageLength'];
    if (text.length > maxLength) text = text.slice(0, maxLength - 1) + '…';

    code.style.borderBottom = settings['inline.underline'] ? '2px solid ' + colour('underline') : 'none';
    lens.textContent = (settings['inline.showMarker'] ? '▪ ' : '') + text + ' ';
    lens.style.color = colour('foreground');
    lens.style.backgroundColor = settings['inline.background'] ? colour('background') : 'transparent';
    lens.style.marginLeft = settings['inline.gap'] + 'ch';
    lens.style.fontWeight = settings['inline.bold'] ? '600' : 'normal';
    lens.style.fontStyle = settings['inline.italic'] ? 'italic' : 'normal';
    row.append(code);
    if (settings['inline.mode'] !== 'off') row.append(lens);
    return row;
}

function paint() {
    const settings = values();
    const preview = document.getElementById('preview');
    preview.replaceChildren();
    const examples = [
        ['fatal', 'Fatal', 'C-F1'],
        ['major', 'Major', 'C-L1'],
        ['minor', 'Minor', 'C-L3'],
        ['info', 'Info', 'C-G1'],
        ['function', 'Unauthorized', '', "printf() is not in the subject's allowed functions."],
    ];
    for (const [bucket, level, rule, sample] of examples) {
        preview.append(previewRow(settings, bucket, level, rule, sample));
    }
    apply.disabled = busy || !Object.keys(pending).length || !form.checkValidity();
}

function changed() {
    pending = changedValues();
    rememberDraft();
    status.textContent = Object.keys(pending).length ? 'Unsaved changes' : '';
    paint();
}

function save(values, message) {
    busy = true;
    apply.disabled = true;
    scope.disabled = true;
    status.textContent = message;
    vscode.postMessage({ type: 'apply', values });
}

form.addEventListener('input', event => {
    const target = event.target;
    const picker = target.dataset.picker;
    if (picker) {
        const input = document.getElementById(picker);
        input.value = target.value + (input.value.length === 9 ? input.value.slice(7) : '');
    }
    if (target.dataset.key && target.type === 'text' && /^#[0-9a-f]{6}/i.test(target.value)) {
        document.querySelector('[data-picker="' + target.dataset.key + '"]').value = target.value.slice(0, 7);
    }
    changed();
});
form.addEventListener('change', changed);
form.addEventListener('click', event => {
    if (!event.target.dataset.theme) return;
    document.getElementById(event.target.dataset.theme).value = '';
    changed();
});
form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity() || busy) return;
    save(pending, 'Saving…');
});
document.getElementById('reset').addEventListener('click', () => {
    if (busy) return;
    const resets = Object.fromEntries(inputs.map(input => [input.dataset.key, null]));
    save(resets, 'Restoring inherited settings…');
});
scope.addEventListener('change', () => {
    pending = {};
    rememberDraft();
    vscode.postMessage({ type: 'scope', scope: scope.value });
});

function loadSettings(message) {
    const draft = pending;
    baseline = message.values;
    for (const input of inputs) {
        const key = input.dataset.key;
        const value = !busy && key in draft ? draft[key] : baseline[key];
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value ?? '';
        if (input.type === 'text') {
            const picker = document.querySelector('[data-picker="' + key + '"]');
            picker.value = /^#[0-9a-f]{6}/i.test(input.value) ? input.value.slice(0, 7) : '#808080';
        }
    }
    const labels = { user: 'User', workspace: 'Workspace', folder: 'Workspace folder' };
    scope.replaceChildren(...message.scopes.map(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = labels[value];
        return option;
    }));
    scope.value = message.scope;
    pending = busy ? {} : changedValues();
    paint();
}

window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'settings') loadSettings(message);
    if (message.type === 'saved' || message.type === 'error') {
        busy = false;
        scope.disabled = false;
        rememberDraft();
        status.textContent = message.type === 'saved' ? 'Appearance saved' : message.text;
        paint();
    }
});
vscode.postMessage({ type: 'ready', scope: restored?.scope });
</script>
</body>
</html>`;
}
