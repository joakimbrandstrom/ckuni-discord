import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import type { DiscordInteraction } from '../../src/discord/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const keys = generateKeyPairSync('ed25519');

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
process.env.DISCORD_APPLICATION_ID = 'application';
process.env.DISCORD_PUBLIC_KEY = keys.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');
process.env.DISCORD_BOT_TOKEN = 'token';
process.env.DISCORD_GUILD_ID = 'guild';
process.env.DISCORD_RIDE_LEADER_ROLE_ID = 'ride-leader';
process.env.LOG_LEVEL = 'silent';
process.env.TIMEZONE = 'UTC';
process.env.PUBLIC_BASE_URL = 'https://bot.example.test';
process.env.STRAVA_CLIENT_ID = 'client';
process.env.STRAVA_CLIENT_SECRET = 'secret';
process.env.STRAVA_VERIFY_TOKEN = 'verify';
process.env.STRAVA_STATE_SECRET = 'state-secret';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

let app: FastifyInstance;
let db: typeof import('../../src/db/pool.js');
const originalFetch = globalThis.fetch;

before(async () => {
  if (!databaseUrl) return;
  // Scheduled Discord events are the only external request in this flow. The
  // application database remains real while the remote Discord API is isolated.
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'event-1' }), { status: 200 });
  db = await import('../../src/db/pool.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  await db.pool.query(
    'TRUNCATE activities, strava_connections, ride_participants, rides, users RESTART IDENTITY CASCADE',
  );
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (app) await app.close();
  if (db) await db.closePool();
});

function interaction(
  name: string,
  userId: string,
  roles: string[] = [],
  data: Partial<NonNullable<DiscordInteraction['data']>> = {},
): DiscordInteraction {
  return {
    id: `interaction-${userId}`,
    application_id: 'application',
    token: 'interaction-token',
    type: 2,
    guild_id: 'guild',
    channel_id: 'channel',
    member: { user: { id: userId, username: userId }, roles },
    data: { name, ...data },
  };
}

async function send(payload: DiscordInteraction) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  return app.inject({
    method: 'POST',
    url: '/discord/interactions',
    headers: {
      'content-type': 'application/json',
      'x-signature-timestamp': timestamp,
      'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), keys.privateKey).toString(
        'hex',
      ),
    },
    payload: body,
  });
}

function createOptions(dateTime: DateTime) {
  return [
    {
      name: 'create',
      type: 1,
      options: [
        { name: 'title', type: 3, value: 'Integration Ride' },
        { name: 'date', type: 3, value: dateTime.toFormat('yyyy-MM-dd') },
        { name: 'time', type: 3, value: dateTime.toFormat('HH:mm') },
        { name: 'duration', type: 4, value: 60 },
        { name: 'type', type: 3, value: 'social' },
      ],
    },
  ];
}

integration(
  'Discord command and button flows pass through HTTP, signatures, and PostgreSQL',
  async () => {
    const future = DateTime.utc().plus({ hours: 2 }).startOf('minute');
    const normalCreate = await send(
      interaction('ride', 'member', [], { options: createOptions(future) }),
    );
    assert.match(normalCreate.json().data.content, /Only Ride Leaders/);

    const pastCreate = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: createOptions(DateTime.utc().minus({ hours: 1 })),
      }),
    );
    assert.match(pastCreate.json().data.content, /must be in the future/);

    const created = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: createOptions(future),
      }),
    );
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().data.embeds[0].title, '🚴 Integration Ride');
    const rideId = /Ride ID: `([^`]+)`/.exec(created.json().data.embeds[0].description)?.[1];
    assert.ok(rideId);

    const listed = await send(
      interaction('ride', 'member', [], {
        options: [{ name: 'list', type: 1 }],
      }),
    );
    assert.match(listed.json().data.content, new RegExp(`#${rideId}`));

    for (const [customId, expected] of [
      [`ride_join:${rideId}`, /Going: \*\*2\*\*/],
      [`ride_maybe:${rideId}`, /Maybe: \*\*1\*\*/],
    ] as const) {
      const button = interaction('', 'member');
      button.type = 3;
      button.data = { custom_id: customId };
      const response = await send(button);
      assert.equal(response.json().type, 7);
      assert.match(response.json().data.embeds[0].description, expected);
    }

    await db.pool.query(
      'UPDATE ride_participants SET attended_at=NOW() WHERE ride_id=$1 AND discord_id=$2',
      [rideId, 'member'],
    );
    const leaderboard = await send(interaction('leaderboard', 'member'));
    assert.match(leaderboard.json().data.content, /member.*10 pts/i);

    const strava = await send(interaction('strava', 'member'));
    assert.match(strava.json().data.components[0].components[0].url, /\/strava\/oauth\?state=/);

    const otherCancel = await send(
      interaction('ride', 'other-leader', ['ride-leader'], {
        options: [
          {
            name: 'cancel',
            type: 1,
            options: [{ name: 'id', type: 4, value: Number(rideId) }],
          },
        ],
      }),
    );
    assert.match(otherCancel.json().data.content, /not the creator/);
    const cancelled = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: [
          {
            name: 'cancel',
            type: 1,
            options: [{ name: 'id', type: 4, value: Number(rideId) }],
          },
        ],
      }),
    );
    assert.match(cancelled.json().data.content, /Cancelled/);

    const emptyList = await send(
      interaction('ride', 'member', [], {
        options: [{ name: 'list', type: 1 }],
      }),
    );
    assert.match(emptyList.json().data.content, /No upcoming/);
  },
);
