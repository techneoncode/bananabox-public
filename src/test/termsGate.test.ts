import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage } from '../handlers/messages';
import type { Controller, Surface } from '../controller';

test('the terms page works before sign-in: accepting is not dropped', async () => {
  let accepted = 0;
  const controller = { auth: { isSignedIn: false }, acceptTerms: async () => { accepted++; }, pushState: () => undefined } as unknown as Controller;
  await handleMessage(controller, {} as Surface, { type: 'acceptTerms' });
  assert.equal(accepted, 1);
});

test('other actions stay closed before sign-in', async () => {
  let accepted = 0;
  const controller = { auth: { isSignedIn: false }, acceptTerms: async () => { accepted++; }, pushState: () => undefined } as unknown as Controller;
  await handleMessage(controller, {} as Surface, { type: 'runGrader', projectId: 1 } as never);
  assert.equal(accepted, 0);
});
