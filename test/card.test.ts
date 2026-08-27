import assert from 'node:assert/strict';
import test from 'node:test';
import { rideMessage } from '../src/rides/card.js';
import type { Ride } from '../src/rides/repository.js';

function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    id: '42',
    title: 'Tuesday intervals',
    description: 'Four hard efforts',
    ride_type: 'intervals',
    starts_at: new Date('2026-11-10T18:00:00.000Z'),
    duration_minutes: 60,
    zwift_url: 'https://example.test/zwift',
    creator_discord_id: 'creator',
    discord_channel_id: 'channel',
    discord_event_id: null,
    discord_message_id: null,
    route_world: null,
    pace_workout: null,
    notes: null,
    template_id: null,
    creation_draft_id: null,
    status: 'scheduled',
    ...overrides,
  };
}

test('builds a complete ride card with participant controls', () => {
  const message = rideMessage(ride(), { going: 3, maybe: 2 }, 'Europe/Stockholm') as {
    embeds: Array<{ title: string; description: string }>;
    components: Array<{ components: Array<{ custom_id: string }> }>;
  };

  assert.equal(message.embeds[0].title, '🚴 Tuesday intervals');
  assert.match(message.embeds[0].description, /Four hard efforts/);
  assert.match(message.embeds[0].description, /tis 10 nov\., 19:00/);
  assert.match(message.embeds[0].description, /⏱ 60 min/);
  assert.match(message.embeds[0].description, /⚡ Intervaller/);
  assert.match(message.embeds[0].description, /https:\/\/example\.test\/zwift/);
  assert.match(message.embeds[0].description, /Kommer: \*\*3\*\*/);
  assert.match(message.embeds[0].description, /Kanske: \*\*2\*\*/);
  assert.match(message.embeds[0].description, /Pass-ID: `42`/);
  assert.deepEqual(
    message.components[0].components.map((component) => component.custom_id),
    ['ride_join:42', 'ride_maybe:42'],
  );
});

test('omits optional card fields and falls back to the cycling icon', () => {
  const message = rideMessage(
    ride({ description: null, ride_type: 'recovery', zwift_url: null }),
    { going: 0, maybe: 0 },
    'UTC',
  ) as { embeds: Array<{ description: string }> };

  assert.doesNotMatch(message.embeds[0].description, /Four hard efforts|example\.test/);
  assert.match(message.embeds[0].description, /🚴 recovery/);
});

test('marks cancelled rides clearly and disables participation buttons', () => {
  const message = rideMessage(ride({ status: 'cancelled' }), { going: 3, maybe: 2 }, 'UTC') as {
    embeds: Array<{ title: string; description: string }>;
    components: Array<{ components: Array<{ disabled: boolean }> }>;
  };

  assert.match(message.embeds[0].title, /INSTÄLLT/);
  assert.match(message.embeds[0].description, /passet är inställt/);
  assert.ok(message.components[0].components.every((component) => component.disabled));
});

test('rejects ride details that exceed Discord embed limits', () => {
  assert.throws(
    () => rideMessage(ride({ description: 'x'.repeat(4096) }), { going: 1, maybe: 0 }, 'UTC'),
    /för långa/,
  );
});
