import assert from 'node:assert/strict';
import test from 'node:test';
import { ZwiftRateLimitError } from '../src/integrations/zwift/provider.js';
import { ZwiftService } from '../src/integrations/zwift/service.js';
import { zwiftSettingsSchema } from '../src/integrations/zwift/settings.js';
import { parseZwiftEventUrl } from '../src/integrations/zwift/url.js';
import { event, mockProvider, provenance } from './fixtures/zwift.js';

const settings = zwiftSettingsSchema.parse({ ZWIFT_ENABLED: 'true', ZWIFT_TIMEOUT_MS: 10 });
test('validates settings without truthy false or configurable private endpoints', () => {
  assert.equal(zwiftSettingsSchema.parse({}).ZWIFT_ENABLED, false);
  assert.equal(zwiftSettingsSchema.parse({ ZWIFT_ENABLED: 'false' }).ZWIFT_ENABLED, false);
  for (const input of [
    { ZWIFT_ENABLED: 'yes' },
    { ZWIFT_PROVIDER: 'private' },
    { ZWIFT_TIMEOUT_MS: 3000 },
    { ZWIFT_CACHE_TTL_MS: -1 },
  ]) {
    assert.equal(zwiftSettingsSchema.safeParse(input).success, false);
  }
});
test('parses allowed Zwift URLs locally with stable string IDs', () => {
  for (const url of [
    'https://www.zwift.com/events/view/123?utm_source=companion',
    'https://zwift.com/events/123/',
    'https://companion.zwift.com/events/123',
  ]) {
    assert.deepEqual(parseZwiftEventUrl(url), {
      eventId: '123',
      url: 'https://www.zwift.com/events/view/123',
    });
  }
  for (const url of [
    'http://www.zwift.com/events/123',
    'https://zwift.com.evil.test/events/123',
    'https://zwift.com@localhost/events/123',
    'https://127.0.0.1/events/123',
    'https://zwift.com:8080/events/123',
    'https://zwift.com/events/0',
    'https://zwift.com/events/%31',
    'https://zwift.com/events/123#x',
    'https://zwift.com/events/123/other',
    'https://zwift.com/activities/123',
    'file:///events/123',
    'bad',
  ])
    assert.throws(() => parseZwiftEventUrl(url));
});
test('disabled, unreviewed and test-only providers never execute in production', async () => {
  let calls = 0;
  const provider = mockProvider({
    event: async () => {
      calls++;
      return { status: 'available', data: event };
    },
  });
  for (const service of [
    new ZwiftService({ ...settings, ZWIFT_ENABLED: false }, provider),
    new ZwiftService(settings, provider),
    new ZwiftService(settings, { ...provider, access: 'unreviewed' }),
  ]) {
    assert.equal((await service.lookup('event', '123')).status, 'unavailable');
  }
  assert.equal(calls, 0);
});
test('capabilities, normalized data, bounded cache and rate limits', async () => {
  let now = Date.parse('2026-01-01T10:00:00Z');
  let calls = 0;
  const service = new ZwiftService(
    settings,
    mockProvider({
      event: async () => {
        calls++;
        return { status: 'available', data: event };
      },
    }),
    undefined,
    () => now,
    true,
  );
  assert.equal(service.supports('results'), false);
  assert.equal((await service.lookup('results', '123')).status, 'unavailable');
  assert.equal((await service.lookup('event', '123')).status, 'available');
  assert.equal((await service.lookup('event', '123')).status, 'available');
  assert.equal(calls, 1);
  assert.deepEqual(await service.lookup('event', '456'), {
    status: 'unavailable',
    reason: 'rate-limited',
  });
  now += 60001;
  assert.equal((await service.lookup('event', '123')).status, 'available');
  assert.equal(calls, 2);
});
test('timeouts abort, return promptly and back off without retrying', async () => {
  let signal: AbortSignal | undefined;
  const outcomes: string[] = [];
  const service = new ZwiftService(
    settings,
    mockProvider({
      event: async (_, input) => {
        signal = input;
        return new Promise(() => {});
      },
    }),
    (value) => outcomes.push(value.outcome),
    undefined,
    true,
  );
  assert.deepEqual(await service.lookup('event', '123'), {
    status: 'unavailable',
    reason: 'timeout',
  });
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await service.lookup('event', '123'), {
    status: 'unavailable',
    reason: 'rate-limited',
  });
  assert.deepEqual(outcomes, ['timeout']);
});
test('rejects invalid/mismatched data and handles outage and Retry-After safely', async () => {
  for (const data of [{}, { ...event, eventId: '456' }]) {
    const service = new ZwiftService(
      settings,
      mockProvider({ event: async () => ({ status: 'available', data }) }),
      undefined,
      undefined,
      true,
    );
    assert.deepEqual(await service.lookup('event', '123'), {
      status: 'unavailable',
      reason: 'invalid-data',
    });
  }
  for (const error of [new Error('secret upstream body'), new ZwiftRateLimitError(120000)]) {
    let now = Date.now();
    const service = new ZwiftService(
      settings,
      mockProvider({
        event: async () => {
          throw error;
        },
      }),
      undefined,
      () => now,
      true,
    );
    assert.deepEqual(await service.lookup('event', '123'), {
      status: 'unavailable',
      reason: error instanceof ZwiftRateLimitError ? 'rate-limited' : 'unavailable',
    });
    now += 6000;
    assert.deepEqual(await service.lookup('event', '123'), {
      status: 'unavailable',
      reason: 'rate-limited',
    });
  }
});

test('cache evicts by total byte budget and does not retain oversized results', async () => {
  for (const count of [400, 1000]) {
    let now = Date.now();
    const calls: string[] = [];
    const service = new ZwiftService(
      { ...settings, ZWIFT_CACHE_TTL_MS: 300000 },
      mockProvider({
        results: async (id) => {
          calls.push(id);
          return {
            status: 'available',
            data: {
              eventId: id,
              eventName: 'Test',
              startsAt: null,
              publishedAt: null,
              coverage: 'unknown',
              provenance,
              entries: Array.from({ length: count }, (_, i) => ({
                riderId: String(i + 1),
                displayName: 'N'.repeat(200),
                category: 'C'.repeat(200),
                rank: i + 1,
              })),
            },
          };
        },
      }),
      undefined,
      () => now,
      true,
    );
    const fetch = async (id: string) => {
      now += settings.ZWIFT_MIN_INTERVAL_MS;
      assert.equal((await service.lookup('results', id)).status, 'available');
    };
    if (count === 400) {
      for (let i = 1; i <= 9; i++) await fetch(String(i));
      await fetch('9');
      assert.equal(calls.length, 9); // Recent entry is still cached.
      await fetch('1');
      assert.equal(calls.length, 10); // Old entry was evicted before TTL.
    } else {
      await fetch('1');
      await fetch('1');
      assert.equal(calls.length, 2); // Oversized valid results never enter the cache.
    }
  }
});
