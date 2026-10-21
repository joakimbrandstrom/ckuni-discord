import assert from 'node:assert/strict';
import test from 'node:test';
import { commands, commandsWithZwift } from '../src/discord/commands.js';
import type { DiscordInteraction } from '../src/discord/types.js';
import { type ZwiftCommandContext, zwiftCommandContent } from '../src/discord/zwift.js';
import type { Lookup, ZwiftResults } from '../src/integrations/zwift/provider.js';
import { formatZwiftResults } from '../src/integrations/zwift/results.js';
import { ZwiftService } from '../src/integrations/zwift/service.js';
import { zwiftSettingsSchema } from '../src/integrations/zwift/settings.js';
import { mockProvider, provenance } from './fixtures/zwift.js';

const results: ZwiftResults = {
  eventId: '123',
  eventName: 'CK UNI race',
  startsAt: '2026-10-27T17:00:00Z',
  publishedAt: null,
  coverage: 'partial',
  provenance,
  entries: [
    { riderId: '2', displayName: 'Second', rank: 2, category: 'A' },
    { riderId: '1', displayName: 'First', rank: 1, category: 'A' },
    { riderId: '3', displayName: 'Unranked', rank: null, category: 'B' },
  ],
};
const settings = zwiftSettingsSchema.parse({
  ZWIFT_ENABLED: 'true',
  ZWIFT_RESULTS_ENABLED: 'true',
  ZWIFT_TIMEOUT_MS: 10,
});
function context(
  result: Lookup<unknown> = { status: 'available', data: results },
): ZwiftCommandContext {
  return {
    guildId: 'guild',
    timezone: 'Europe/Stockholm',
    getRide: async () => ({ zwift_url: 'https://www.zwift.com/events/123' }),
    service: new ZwiftService(
      { ...settings },
      mockProvider({
        results: async (id) => {
          assert.equal(id, '123');
          return result;
        },
      }),
      undefined,
      undefined,
      true,
    ),
  };
}
function command(
  options = [
    { name: 'url', type: 3, value: 'https://www.zwift.com/events/view/123' },
  ] as NonNullable<DiscordInteraction['data']>['options'],
): DiscordInteraction {
  return {
    id: 'interaction',
    type: 2,
    application_id: 'app',
    token: 'token',
    guild_id: 'guild',
    member: { user: { id: 'member', username: 'Member' } },
    data: { name: 'zwift', options: [{ name: 'results', type: 1, options }] },
  };
}
test('results registration is opt-in and retains existing commands when disabled', () => {
  assert.deepEqual(commandsWithZwift({ results: false }), commands);
  const enabled = commandsWithZwift({ results: true }) as Array<{
    name: string;
    options?: unknown[];
  }>;
  assert.equal(enabled.at(-1)?.name, 'zwift');
  assert.match(JSON.stringify(enabled.at(-1)), /"ride"/);
});
test('formats source ranks, categories, unknowns and coverage without asserting absence', () => {
  const text = formatZwiftResults(results, 'Europe/Stockholm');
  assert.ok(text.indexOf('First') < text.indexOf('Second'));
  assert.match(text, /Placering okänd · B · Unranked/);
  assert.match(text, /Synthetic test fixture/);
  assert.match(text, /Täckning: delvis/);
  assert.match(text, /Publicerad: okänd/);
  assert.match(text, /som saknas kan ha deltagit/);
});
test('handles empty, duplicate and inconsistent data without invented standings', () => {
  assert.match(
    formatZwiftResults({ ...results, entries: [] }, 'UTC'),
    /Inga publicerade deltagarresultat/,
  );
  const duplicate = formatZwiftResults(
    { ...results, entries: [...results.entries, results.entries[0]] },
    'UTC',
  );
  assert.match(duplicate, /3 unika/);
  assert.equal(duplicate.split('Second').length, 2);
  assert.match(
    formatZwiftResults(
      { ...results, entries: [...results.entries, { ...results.entries[0], rank: 1 }] },
      'UTC',
    ),
    /motstridiga/,
  );
});
test('bounds long results and neutralizes mentions and provider markup', () => {
  const text = formatZwiftResults(
    {
      ...results,
      eventName: '@everyone **race**',
      entries: Array.from({ length: 100 }, (_, i) => ({
        riderId: String(i + 1),
        displayName: '<@123> @everyone [click](https://evil.test)'.repeat(4),
        rank: i + 1,
        category: 'Category'.repeat(20),
      })),
    },
    'Europe/Stockholm',
  );
  assert.ok(text.length <= 2000);
  assert.ok(!text.includes('@'));
  assert.match(text, /10 av 100/);
});
test('command resolves URLs and CK UNI ride references to stable IDs only', async () => {
  assert.match(await zwiftCommandContent(command(), context()), /First/);
  assert.match(
    await zwiftCommandContent(command([{ name: 'ride', type: 4, value: 4 }]), context()),
    /First/,
  );
  assert.match(await zwiftCommandContent(command([]), context()), /antingen/);
  assert.match(
    await zwiftCommandContent(
      command([{ name: 'url', type: 3, value: 'https://evil.test/events/123' }]),
      context(),
    ),
    /giltig Zwift-eventlänk/,
  );
  const missing = context();
  missing.getRide = async () => null;
  assert.match(
    await zwiftCommandContent(command([{ name: 'ride', type: 4, value: 4 }]), missing),
    /saknar/,
  );
});
test('guild, feature and provider gates prevent lookup; failures stay readable', async () => {
  assert.match(
    await zwiftCommandContent({ ...command(), guild_id: 'other' }, context()),
    /CK UNI-servern/,
  );
  assert.match(
    await zwiftCommandContent({ ...command(), member: undefined }, context()),
    /CK UNI-servern/,
  );
  const disabled = context();
  disabled.service.settings.ZWIFT_ENABLED = false;
  assert.match(await zwiftCommandContent(command(), disabled), /avstängd/);
  const resultsDisabled = context();
  resultsDisabled.service.settings.ZWIFT_RESULTS_ENABLED = false;
  assert.match(await zwiftCommandContent(command(), resultsDisabled), /avstängda/);
  const noProvider = context();
  noProvider.service = new ZwiftService(settings);
  assert.match(await zwiftCommandContent(command(), noProvider), /Ingen godkänd/);
  for (const reason of ['unpublished', 'unavailable', 'rate-limited', 'timeout'] as const) {
    const text = await zwiftCommandContent(command(), context({ status: 'unavailable', reason }));
    assert.ok(text.length > 0);
    assert.ok(!text.includes('First'));
  }
});
