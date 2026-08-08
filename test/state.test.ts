import test from 'node:test';
import assert from 'node:assert/strict';
import { signState, verifyState } from '../src/strava/state.js';

test('signs and verifies Strava OAuth state', () => {
  const secret = 'test-secret';
  const token = signState({ discordId: '123', exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  assert.equal(verifyState(token, secret).discordId, '123');
});

test('rejects modified state', () => {
  const token = signState({ discordId: '123', exp: Math.floor(Date.now() / 1000) + 60 }, 'secret');
  assert.throws(() => verifyState(`${token}x`, 'secret'));
});
