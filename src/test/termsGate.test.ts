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

test('a signed-in installation that never accepted the terms can only accept them', async () => {
  let accepted = 0, pushed = 0;
  const controller = { auth: { isSignedIn: true }, termsAccepted: false, acceptTerms: async () => { accepted++; }, pushState: () => { pushed++; } } as unknown as Controller;
  await handleMessage(controller, {} as Surface, { type: 'runGrader', projectId: 1 } as never);
  assert.equal(pushed, 0);
  await handleMessage(controller, {} as Surface, { type: 'acceptTerms' });
  assert.equal(accepted, 1);
});
