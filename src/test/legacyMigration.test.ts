import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { migrateLegacyPrefix } from '../services/legacyMigration';

const memento = (entries: Record<string, unknown>) => {
  const map = new Map(Object.entries(entries));
  return { map, keys: () => [...map.keys()], get: (k: string) => map.get(k), update: async (k: string, v: unknown) => { if (v === undefined) map.delete(k); else map.set(k, v); } };
};

test('settings, state, secrets and the browser profile move from epibox to bananabox once', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bb-migrate-'));
  await mkdir(join(home, 'snap', 'firefox', 'common', 'epibox-firefox-profile'), { recursive: true });
  const settings: Record<string, Record<string, unknown>> = {
    epibox: { language: 'fr', cloneProtocol: 'https' },
    bananabox: { cloneProtocol: 'ssh' },
  };
  const writes: string[] = [];
  Object.assign(vscode.workspace, {
    workspaceFolders: [],
    getConfiguration: (section: string) => ({
      get: (key: string, fallback: unknown) => settings[section][key] ?? fallback,
      inspect: (key: string) => ({ globalValue: settings[section][key] }),
      update: async (key: string, value: unknown) => { writes.push(`${section}.${key}`); settings[section][key] = value; },
    }),
  });
  const secrets = memento({ 'epibox.accessToken': 'AT', 'epibox.refreshToken': 'RT', 'bananabox.msRefreshToken': 'MS' });
  const globalState = memento({ 'epibox.palette.v1': { accent: '#fff' }, 'epibox.defenseReminders.v1:me': ['1'], 'bananabox.adminSession.v1': 'kept', 'terms': true });
  const context: any = {
    globalState, workspaceState: memento({}),
    secrets: { get: async (k: string) => secrets.get(k), store: secrets.update, delete: (k: string) => secrets.update(k, undefined) },
    extension: { packageJSON: { contributes: { configuration: { properties: { 'bananabox.language': {}, 'bananabox.cloneProtocol': {} } } } } },
  };
  try {
    await migrateLegacyPrefix(context, home);
    assert.deepEqual([...secrets.map].sort(), [['bananabox.accessToken', 'AT'], ['bananabox.msRefreshToken', 'MS'], ['bananabox.refreshToken', 'RT']]);
    assert.deepEqual(globalState.get('bananabox.palette.v1'), { accent: '#fff' });
    assert.deepEqual(globalState.get('bananabox.defenseReminders.v1:me'), ['1']);
    assert.equal(globalState.keys().some(k => k.startsWith('epibox')), false);
    assert.equal(globalState.get('terms'), true);
    assert.equal(settings.bananabox.language, 'fr');
    assert.equal(settings.bananabox.cloneProtocol, 'ssh', 'a value already set under the new name wins');
    assert.equal(existsSync(join(home, 'snap', 'firefox', 'common', 'bananabox-firefox-profile')), process.platform === 'linux');

    settings.bananabox.language = undefined as unknown as string;
    writes.length = 0;
    await migrateLegacyPrefix(context, home);
    assert.deepEqual(writes, [], 'runs once: a setting reset later is not brought back');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
