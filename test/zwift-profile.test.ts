import assert from 'node:assert/strict';
import test from 'node:test';
import { commandsWithZwift } from '../src/discord/commands.js';
import type { DiscordInteraction } from '../src/discord/types.js';
import { zwiftCommandContent } from '../src/discord/zwift.js';
import { formatZwiftProfile } from '../src/integrations/zwift/profile.js';
import { profileSchema, type ZwiftProfile } from '../src/integrations/zwift/provider.js';
import { ZwiftService } from '../src/integrations/zwift/service.js';
import { zwiftSettingsSchema } from '../src/integrations/zwift/settings.js';
import { mockProvider, provenance } from './fixtures/zwift.js';

const settings = zwiftSettingsSchema.parse({
  ZWIFT_ENABLED: 'true',
  ZWIFT_PROFILES_ENABLED: 'true',
});
const profile: ZwiftProfile = {
  riderId: '123',
  visibility: 'permitted',
  displayName: 'Rider @everyone',
  country: null,
  category: 'B',
  level: null,
  provenance,
};
function interaction(sub = 'profile', user = 'member'): DiscordInteraction {
  return {
    id: 'interaction',
    type: 2,
    application_id: 'app',
    token: 'token',
    guild_id: 'guild',
    member: { user: { id: user, username: user } },
    data: {
      name: 'zwift',
      options: [{ name: sub, type: 1, options: [{ name: 'rider', type: 3, value: '123' }] }],
    },
  };
}
function context(data: ZwiftProfile = profile) {
  return {
    service: new ZwiftService(
      { ...settings },
      mockProvider({ profile: async () => ({ status: 'available', data }) }),
      undefined,
      undefined,
      true,
    ),
    guildId: 'guild',
    timezone: 'Europe/Stockholm',
    getRide: async () => {
      throw new Error('profile must not access rides');
    },
  };
}
test('profiles are registered independently with no unverified linking command', () => {
  const definition = JSON.stringify(commandsWithZwift({ results: false, profiles: true }));
  assert.match(definition, /"profile"/);
  assert.match(definition, /"unlink"/);
  assert.ok(!definition.includes('"link"'));
  assert.ok(!definition.includes('"results"'));
});
test('profile fields carry permission, source, freshness and unavailable-field labels', async () => {
  const content = await zwiftCommandContent(interaction(), context());
  assert.match(content, /Synthetic test fixture/);
  assert.match(content, /inte verifierad kontokoppling/);
  assert.match(content, /Land: okänt/);
  assert.match(content, /Nivå: okänd/);
  assert.match(content, /Observerad: okänd/);
  assert.ok(!content.includes('@'));
  assert.ok(content.length < 2000);
  assert.ok(!('ftp' in profileSchema.parse({ ...profile, ftp: 400, password: 'discard-me' })));
});
test('restricted data never reaches Discord, including formatter defense in depth', async () => {
  const restricted = {
    ...profile,
    visibility: 'restricted' as const,
    displayName: 'Private Rider',
  };
  const content = await zwiftCommandContent(interaction(), context(restricted));
  assert.match(content, /tillåter inte/);
  assert.ok(!content.includes('Private Rider'));
  assert.ok(!formatZwiftProfile(restricted, 'UTC').includes('Private Rider'));
});
test('guild, feature and provider permission boundaries deny requests', async () => {
  assert.match(
    await zwiftCommandContent({ ...interaction(), guild_id: 'other' }, context()),
    /CK UNI-servern/,
  );
  const disabled = context();
  disabled.service.settings.ZWIFT_PROFILES_ENABLED = false;
  assert.match(await zwiftCommandContent(interaction(), disabled), /avstängda/);
  const unreviewed = context();
  unreviewed.service = new ZwiftService(settings, {
    ...mockProvider({ profile: async () => ({ status: 'available', data: profile }) }),
    access: 'unreviewed',
  });
  assert.match(await zwiftCommandContent(interaction(), unreviewed), /Ingen godkänd/);
  const failed = context();
  failed.service = new ZwiftService(
    settings,
    mockProvider({
      profile: async () => {
        throw new Error('private upstream response');
      },
    }),
    undefined,
    undefined,
    true,
  );
  assert.match(await zwiftCommandContent(interaction(), failed), /otillgänglig/);
});
test('duplicate unverified claims cannot establish ownership and unlink has no persisted data', async () => {
  for (const user of ['one', 'two'])
    assert.match(
      await zwiftCommandContent(interaction('link', user), context()),
      /Inget ryttar-ID sparas/,
    );
  for (let i = 0; i < 2; i++)
    assert.match(
      await zwiftCommandContent(interaction('unlink'), context()),
      /ingen koppling att ta bort/,
    );
  assert.match(
    await zwiftCommandContent(interaction('privacy'), context()),
    /cachar inte profiler/,
  );
});
test('profile lookup does not retain a cache or leak raw payloads into logs', async () => {
  let now = Date.now();
  let calls = 0;
  const observations: unknown[] = [];
  const service = new ZwiftService(
    settings,
    mockProvider({
      profile: async () => {
        calls++;
        return { status: 'available', data: profile };
      },
    }),
    (event) => observations.push(event),
    () => now,
    true,
  );
  await service.lookup('profile', '123');
  now += settings.ZWIFT_MIN_INTERVAL_MS;
  await service.lookup('profile', '123');
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(observations).includes('123'));
  assert.ok(!JSON.stringify(observations).includes('Rider'));
});
