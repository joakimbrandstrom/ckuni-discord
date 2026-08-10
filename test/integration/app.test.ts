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
process.env.STRAVA_VERIFY_TOKEN = 'verify-me';
process.env.PUBLIC_BASE_URL = 'https://bot.example.test';
process.env.STRAVA_CLIENT_ID = 'client';
process.env.STRAVA_CLIENT_SECRET = 'secret';
process.env.STRAVA_STATE_SECRET = 'state-secret';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');

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

test('Strava OAuth rejects missing state and webhook verification validates token', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/strava/oauth' })).statusCode, 400);
  const valid = await app.inject({
    method: 'GET',
    url: '/strava/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc',
  });
  assert.deepEqual(valid.json(), { 'hub.challenge': 'abc' });
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/strava/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=abc',
      })
    ).statusCode,
    403,
  );
});

test('Strava OAuth validates state and redirects to the configured authorization request', async () => {
  const { signState } = await import('../../src/strava/state.js');
  const state = signState(
    { discordId: 'discord-user', exp: Math.floor(Date.now() / 1000) + 60 },
    'state-secret',
  );
  const response = await app.inject({
    method: 'GET',
    url: `/strava/oauth?state=${encodeURIComponent(state)}`,
  });

  assert.equal(response.statusCode, 302);
  const location = new URL(String(response.headers.location));
  assert.equal(location.origin + location.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), 'client');
  assert.equal(
    location.searchParams.get('redirect_uri'),
    'https://bot.example.test/strava/oauth/callback',
  );
  assert.equal(location.searchParams.get('scope'), 'read,activity:read');
  assert.equal(location.searchParams.get('state'), state);

  const invalid = await app.inject({ method: 'GET', url: '/strava/oauth?state=invalid' });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: 'Invalid or expired state' });
});

test('Strava OAuth callback rejects provider errors and incomplete callbacks before network calls', async () => {
  const providerError = await app.inject({
    method: 'GET',
    url: '/strava/oauth/callback?error=access_denied',
  });
  assert.equal(providerError.statusCode, 400);
  assert.match(providerError.body, /access_denied/);

  const incomplete = await app.inject({
    method: 'GET',
    url: '/strava/oauth/callback?state=state-only',
  });
  assert.equal(incomplete.statusCode, 400);
  assert.match(incomplete.body, /Missing state or code/);
});

test('Strava OAuth endpoints fail closed when the integration becomes incomplete', async () => {
  const { config } = await import('../../src/config.js');
  const clientSecret = config.STRAVA_CLIENT_SECRET;
  config.STRAVA_CLIENT_SECRET = undefined;
  try {
    const oauth = await app.inject({ method: 'GET', url: '/strava/oauth?state=unused' });
    assert.equal(oauth.statusCode, 503);
    assert.deepEqual(oauth.json(), { error: 'Strava integration is not configured' });

    const callback = await app.inject({ method: 'GET', url: '/strava/oauth/callback' });
    assert.equal(callback.statusCode, 503);
    assert.match(callback.body, /Strava integration is not configured/);
  } finally {
    config.STRAVA_CLIENT_SECRET = clientSecret;
  }
});

test('Strava webhook acknowledges work immediately', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/strava/webhook',
    payload: { object_type: 'other' },
  });
  assert.equal(response.statusCode, 200);
});
