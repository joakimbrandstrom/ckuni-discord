import assert from 'node:assert/strict';
import test from 'node:test';
import { zwiftEventPreview } from '../src/integrations/zwift/event-preview.js';
import { localTimestamp } from '../src/integrations/zwift/presentation.js';
import { ZwiftService } from '../src/integrations/zwift/service.js';
import { zwiftSettingsSchema } from '../src/integrations/zwift/settings.js';
import { event, mockProvider } from './fixtures/zwift.js';

const settings = zwiftSettingsSchema.parse({ ZWIFT_ENABLED: 'true', ZWIFT_TIMEOUT_MS: 10 });
const proposed = {
  title: event.name,
  starts_at: new Date(event.startsAt as string),
  duration_minutes: 60,
};
const url = 'https://www.zwift.com/events/view/123';
const timezone = 'Europe/Stockholm';

test('event preview displays provenance, suggestions and missing fields without changing the draft', async () => {
  const service = new ZwiftService(
    settings,
    mockProvider({ event: async () => ({ status: 'available', data: event }) }),
    undefined,
    undefined,
    true,
  );
  const before = structuredClone(proposed);
  const preview = await zwiftEventPreview(url, proposed, service, timezone);
  assert.match(preview?.description ?? '', /Synthetic test fixture/);
  assert.match(preview?.description ?? '', /2026-10-27 18:00 \+01:00/);
  assert.match(preview?.description ?? '', /okänt \/ Watopia/);
  assert.match(preview?.description ?? '', /inte oberoende verifierad/);
  assert.match(preview?.description ?? '', /Inga avvikelser/);
  assert.deepEqual(proposed, before);
});
test('event preview warns on title, time and duration discrepancies', async () => {
  const service = new ZwiftService(
    settings,
    mockProvider({ event: async () => ({ status: 'available', data: event }) }),
    undefined,
    undefined,
    true,
  );
  const preview = await zwiftEventPreview(
    url,
    { title: 'Social ride', starts_at: new Date('2026-10-27T18:00:00Z'), duration_minutes: 90 },
    service,
    timezone,
  );
  for (const label of ['Titeln', 'Starttiden', 'Längden'])
    assert.match(preview?.description ?? '', new RegExp(`${label} skiljer sig`));
});
test('Stockholm timestamps include DST offsets and distinguish repeated autumn hour', () => {
  assert.equal(localTimestamp('2026-03-29T00:30:00Z', timezone), '2026-03-29 01:30 +01:00');
  assert.equal(localTimestamp('2026-03-29T01:30:00Z', timezone), '2026-03-29 03:30 +02:00');
  assert.equal(localTimestamp('2026-10-25T00:30:00Z', timezone), '2026-10-25 02:30 +02:00');
  assert.equal(localTimestamp('2026-10-25T01:30:00Z', timezone), '2026-10-25 02:30 +01:00');
});
test('disabled integration preserves preview and never calls provider', async () => {
  const service = new ZwiftService(
    { ...settings, ZWIFT_ENABLED: false },
    mockProvider({
      event: async () => {
        throw new Error('must not execute');
      },
    }),
    undefined,
    undefined,
    true,
  );
  assert.equal(await zwiftEventPreview(url, proposed, service, timezone), null);
});
test('unsupported data, invalid legacy links, missing fields, timeouts and outages allow manual publication', async () => {
  const cases = [
    mockProvider({}),
    mockProvider({ event: async () => ({ status: 'unavailable', reason: 'unsupported' }) }),
    mockProvider({
      event: async () => {
        throw new Error('upstream unavailable');
      },
    }),
    mockProvider({ event: async () => new Promise(() => {}) }),
  ];
  for (const provider of cases) {
    const service = new ZwiftService(settings, provider, undefined, undefined, true);
    const preview = await zwiftEventPreview(url, proposed, service, timezone);
    assert.match(preview?.description ?? '', /publicera manuellt/);
  }
  const service = new ZwiftService(settings);
  assert.match(
    (await zwiftEventPreview('https://evil.test/123', proposed, service, timezone))?.description ??
      '',
    /manuella uppgifter/,
  );
  const empty = new ZwiftService(
    settings,
    mockProvider({
      event: async () => ({
        status: 'available',
        data: { ...event, name: null, startsAt: null, durationMinutes: null },
      }),
    }),
    undefined,
    undefined,
    true,
  );
  assert.match(
    (await zwiftEventPreview(url, proposed, empty, timezone))?.description ?? '',
    /Okända fält är inte verifierade/,
  );
});
