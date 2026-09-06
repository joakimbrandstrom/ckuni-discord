import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.DISCORD_APPLICATION_ID ??= 'application';
process.env.DISCORD_PUBLIC_KEY = publicKey;
process.env.DISCORD_BOT_TOKEN ??= 'token';
process.env.DISCORD_GUILD_ID ??= 'guild';
process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp({ readinessCheck: async () => undefined });
});

after(async () => app.close());

function discordHeaders(body: string): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    'content-type': 'application/json',
    'x-signature-timestamp': timestamp,
    'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), keys.privateKey).toString(
      'hex',
    ),
  };
}

test('health and readiness report successful status', async () => {
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: 'ready' });
});

test('readiness reports 503 when its dependency fails', async () => {
  const { buildApp } = await import('../../src/app.js');
  const unavailable = await buildApp({
    readinessCheck: async () => {
      throw new Error('offline');
    },
  });
  const response = await unavailable.inject({ method: 'GET', url: '/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'not-ready' });
  await unavailable.close();
});

test('Discord interactions require a valid signature and answer PING', async () => {
  const body = JSON.stringify({ type: 1 });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/discord/interactions',
        headers: { 'content-type': 'application/json' },
        payload: body,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/discord/interactions',
        headers: {
          'content-type': 'application/json',
          'x-signature-timestamp': '1',
          'x-signature-ed25519': '00',
        },
        payload: body,
      })
    ).statusCode,
    401,
  );

  const response = await app.inject({
    method: 'POST',
    url: '/discord/interactions',
    headers: discordHeaders(body),
    payload: body,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { type: 1 });
});

test('removed Strava OAuth and webhook routes return 404', async () => {
  for (const url of ['/strava/oauth', '/strava/oauth/callback', '/strava/webhook']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/strava/webhook', payload: {} })).statusCode,
    404,
  );
});
