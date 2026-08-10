import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decryptToken, encryptToken } from '../src/strava/crypto.js';

test('encrypts and decrypts tokens', () => {
  const key = randomBytes(32).toString('base64');
  const encrypted = encryptToken('secret-token', key);
  assert.notEqual(encrypted, 'secret-token');
  assert.equal(decryptToken(encrypted, key), 'secret-token');
});
