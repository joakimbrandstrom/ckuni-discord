import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const requiredEnvironment = {
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
  DISCORD_APPLICATION_ID: 'test-application',
  DISCORD_PUBLIC_KEY: '00'.repeat(32),
  DISCORD_BOT_TOKEN: 'test-bot-token',
  DISCORD_GUILD_ID: 'test-guild',
} as const;

const stravaEnvironment = {
  PUBLIC_BASE_URL: 'https://strava-config.example.test',
  STRAVA_CLIENT_ID: 'test-strava-client-id',
  STRAVA_CLIENT_SECRET: 'test-strava-client-secret',
  STRAVA_VERIFY_TOKEN: 'test-strava-verify-token',
  STRAVA_STATE_SECRET: 'test-strava-state-secret',
  TOKEN_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
} as const;

Object.assign(process.env, requiredEnvironment, stravaEnvironment);

const { config, getStravaConfig, requireStravaConfig, stravaConfigured } = await import(
  '../src/config.js'
);

beforeEach(() => Object.assign(config, stravaEnvironment));

test('getStravaConfig returns the complete typed Strava configuration', () => {
  assert.deepEqual(getStravaConfig(), {
    clientId: stravaEnvironment.STRAVA_CLIENT_ID,
    clientSecret: stravaEnvironment.STRAVA_CLIENT_SECRET,
    verifyToken: stravaEnvironment.STRAVA_VERIFY_TOKEN,
    stateSecret: stravaEnvironment.STRAVA_STATE_SECRET,
    tokenEncryptionKey: stravaEnvironment.TOKEN_ENCRYPTION_KEY,
    publicBaseUrl: stravaEnvironment.PUBLIC_BASE_URL,
  });
});

test('getStravaConfig returns null when each required Strava value is missing', async (t) => {
  for (const key of Object.keys(stravaEnvironment) as Array<keyof typeof stravaEnvironment>) {
    await t.test(key, () => {
      Reflect.deleteProperty(config, key);
      assert.equal(getStravaConfig(), null);
      Object.assign(config, stravaEnvironment);
    });
  }
});

test('requireStravaConfig returns the complete configuration when configured', () => {
  assert.deepEqual(requireStravaConfig(), getStravaConfig());
});

test('requireStravaConfig throws when Strava is not fully configured', () => {
  Reflect.deleteProperty(config, 'STRAVA_CLIENT_SECRET');
  assert.throws(requireStravaConfig, /Strava integration is not configured/);
});

test('stravaConfigured reflects complete and incomplete configuration', () => {
  assert.equal(stravaConfigured(), true);
  Reflect.deleteProperty(config, 'STRAVA_VERIFY_TOKEN');
  assert.equal(stravaConfigured(), false);
});
