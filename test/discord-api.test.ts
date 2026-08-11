import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
  DISCORD_APPLICATION_ID: 'test-application',
  DISCORD_PUBLIC_KEY: '00'.repeat(32),
  DISCORD_BOT_TOKEN: 'test-bot-token',
  DISCORD_GUILD_ID: 'test-guild',
});

const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];

const {
  cancelScheduledEvent,
  createScheduledEvent,
  editChannelMessage,
  editOriginalInteractionResponse,
  registerGuildCommands,
  sendChannelMessage,
  updateScheduledEvent,
} = await import('../src/discord/api.js');

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: 'event-123' }), { status: 200 });
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

test('registerGuildCommands sends authenticated command definitions to the configured guild', async () => {
  const definitions = [{ name: 'ping', description: 'Ping' }];
  await registerGuildCommands(definitions);

  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/applications/test-application/guilds/test-guild/commands',
  );
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(calls[0].init?.body, JSON.stringify(definitions));
  assert.deepEqual(calls[0].init?.headers, {
    Authorization: 'Bot test-bot-token',
    'Content-Type': 'application/json',
  });
});

test('createScheduledEvent normalizes Discord field limits and returns the event ID', async () => {
  const eventId = await createScheduledEvent({
    name: 'n'.repeat(101),
    description: 'd'.repeat(1001),
    startsAt: new Date('2026-08-11T18:00:00.000Z'),
    endsAt: new Date('2026-08-11T19:00:00.000Z'),
    location: 'l'.repeat(101),
  });

  assert.equal(eventId, 'event-123');
  assert.equal(calls[0].init?.method, 'POST');
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.name.length, 100);
  assert.equal(body.description.length, 1000);
  assert.equal(body.entity_metadata.location.length, 100);
  assert.equal(body.scheduled_start_time, '2026-08-11T18:00:00.000Z');
  assert.equal(body.scheduled_end_time, '2026-08-11T19:00:00.000Z');
});

test('cancelScheduledEvent and sendChannelMessage use their expected Discord endpoints', async () => {
  await cancelScheduledEvent('event-123');
  assert.equal(await sendChannelMessage('channel-123', { content: 'Reminder' }), 'event-123');

  assert.deepEqual(
    calls.map(({ url, init }) => ({ url, method: init?.method, body: init?.body })),
    [
      {
        url: 'https://discord.com/api/v10/guilds/test-guild/scheduled-events/event-123',
        method: 'DELETE',
        body: undefined,
      },
      {
        url: 'https://discord.com/api/v10/channels/channel-123/messages',
        method: 'POST',
        body: JSON.stringify({ content: 'Reminder' }),
      },
    ],
  );
});

test('updates scheduled events and existing channel messages', async () => {
  await updateScheduledEvent('event-123', {
    name: 'Uppdaterat pass',
    description: 'Nya uppgifter',
    startsAt: new Date('2026-08-11T18:00:00.000Z'),
    endsAt: new Date('2026-08-11T19:00:00.000Z'),
    location: 'Zwift',
  });
  await editChannelMessage('channel-123', 'message-123', { content: 'Uppdaterat' });

  assert.deepEqual(
    calls.map(({ url, init }) => ({ url, method: init?.method })),
    [
      {
        url: 'https://discord.com/api/v10/guilds/test-guild/scheduled-events/event-123',
        method: 'PATCH',
      },
      {
        url: 'https://discord.com/api/v10/channels/channel-123/messages/message-123',
        method: 'PATCH',
      },
    ],
  );
});

test('updates the original interaction through an unauthenticated webhook request', async () => {
  await editOriginalInteractionResponse('application-123', 'interaction-token', {
    content: 'Passet har publicerats.',
  });

  assert.equal(
    calls[0].url,
    'https://discord.com/api/v10/webhooks/application-123/interaction-token/messages/@original',
  );
  assert.equal(calls[0].init?.method, 'PATCH');
  assert.deepEqual(calls[0].init?.headers, { 'Content-Type': 'application/json' });
});

test('Discord API failures surface the response status and body', async () => {
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  await assert.rejects(
    () => sendChannelMessage('channel-123', { content: 'Reminder' }),
    /Discord API 429: rate limited/,
  );
});
