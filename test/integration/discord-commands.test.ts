import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { waitForDiscordBackgroundTasks } from '../../src/discord/background.js';
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
process.env.DISCORD_ADMIN_ROLE_ID = 'admin';
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
const discordCalls: Array<{ url: string; method?: string; body?: string }> = [];

before(async () => {
  if (!databaseUrl) return;
  // Scheduled Discord events are the only external request in this flow. The
  // application database remains real while the remote Discord API is isolated.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    discordCalls.push({ url, method: init?.method, body: String(init?.body ?? '') });
    const id = url.includes('/channels/') && init?.method === 'POST' ? 'message-1' : 'event-1';
    return new Response(JSON.stringify({ id }), { status: 200 });
  };
  db = await import('../../src/db/pool.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  await db.pool.query(
    'TRUNCATE activities, strava_connections, ride_participants, rides, ride_templates, users RESTART IDENTITY CASCADE',
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

function subcommand(name: string, id?: number) {
  return [{ name, type: 1, options: id ? [{ name: 'id', type: 4, value: id }] : undefined }];
}

function modal(
  customId: string,
  userId: string,
  roles: string[],
  values: Record<string, string>,
): DiscordInteraction {
  const payload = interaction('', userId, roles);
  payload.type = 5;
  payload.data = {
    custom_id: customId,
    components: Object.entries(values).map(([custom_id, value]) => ({
      type: 1,
      components: [{ type: 4, custom_id, value }],
    })),
  };
  return payload;
}

integration(
  'Discord command and button flows pass through HTTP, signatures, and PostgreSQL',
  async () => {
    const future = DateTime.utc().plus({ hours: 2 }).startOf('minute');
    const normalCreate = await send(
      interaction('ride', 'member', [], { options: subcommand('create') }),
    );
    assert.match(normalCreate.json().data.content, /Endast ledare/);

    const opened = await send(
      interaction('ride', 'leader', ['ride-leader'], { options: subcommand('create') }),
    );
    assert.equal(opened.json().type, 9);
    assert.equal(opened.json().data.custom_id, 'ride_create');

    const pastCreate = await send(
      modal('ride_create', 'leader', ['ride-leader'], {
        title: 'För sent pass',
        date_time: DateTime.utc().minus({ hours: 1 }).toFormat('yyyy-MM-dd HH:mm'),
        duration: '60',
        ride_type: 'socialt',
      }),
    );
    assert.match(pastCreate.json().data.content, /framtiden/);

    const created = await send(
      modal('ride_create', 'leader', ['ride-leader'], {
        title: 'Integrationspass',
        date_time: future.toFormat('yyyy-MM-dd HH:mm'),
        duration: '60',
        ride_type: 'socialt',
        details: 'Beskrivning: Lugnt pass\nRutt/värld: Watopia\nZwift: https://zwift.test/1',
      }),
    );
    assert.equal(created.statusCode, 200);
    const rideId = /#(\d+)/.exec(created.json().data.content)?.[1];
    assert.ok(rideId);
    await waitForDiscordBackgroundTasks();
    assert.ok(discordCalls.some((call) => call.url.endsWith('/messages/@original')));

    const editOpened = await send(
      interaction('ride', 'other-leader', ['ride-leader'], {
        options: subcommand('edit', Number(rideId)),
      }),
    );
    assert.equal(editOpened.json().type, 9);
    assert.equal(editOpened.json().data.custom_id, `ride_edit:${rideId}`);

    const edited = await send(
      modal(`ride_edit:${rideId}`, 'other-leader', ['ride-leader'], {
        title: 'Uppdaterat integrationspass',
        date_time: future.plus({ hours: 1 }).toFormat('yyyy-MM-dd HH:mm'),
        duration: '75',
        ride_type: 'distans',
        details: 'Beskrivning: Ny beskrivning\nTempo/träning: 2,5 W/kg',
      }),
    );
    assert.match(edited.json().data.content, /har sparats och publiceras/);
    await waitForDiscordBackgroundTasks();
    const storedRide = await db.pool.query(
      'SELECT title, duration_minutes, pace_workout, discord_message_id FROM rides WHERE id=$1',
      [rideId],
    );
    assert.deepEqual(storedRide.rows[0], {
      title: 'Uppdaterat integrationspass',
      duration_minutes: 75,
      pace_workout: '2,5 W/kg',
      discord_message_id: 'message-1',
    });

    const listed = await send(
      interaction('ride', 'member', [], {
        options: [{ name: 'list', type: 1 }],
      }),
    );
    assert.match(listed.json().data.content, new RegExp(`#${rideId}`));

    for (const [customId, expected] of [
      [`ride_join:${rideId}`, /Kommer: \*\*2\*\*/],
      [`ride_maybe:${rideId}`, /Kanske: \*\*1\*\*/],
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
    assert.match(leaderboard.json().data.content, /member.*10 poäng/i);

    const strava = await send(interaction('strava', 'member'));
    assert.match(strava.json().data.components[0].components[0].url, /\/strava\/oauth\?state=/);

    const memberCancel = await send(
      interaction('ride', 'member', [], {
        options: subcommand('cancel', Number(rideId)),
      }),
    );
    assert.match(memberCancel.json().data.content, /Endast ledare/);

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
    assert.match(otherCancel.json().data.content, /har ställts in/);
    await waitForDiscordBackgroundTasks();
    const cancelledCardCall = [...discordCalls]
      .reverse()
      .find(
        (call) =>
          call.url.endsWith('/channels/channel/messages/message-1') && call.method === 'PATCH',
      );
    assert.ok(cancelledCardCall);
    assert.match(cancelledCardCall.body ?? '', /INSTÄLLT/);
    assert.match(cancelledCardCall.body ?? '', /"disabled":true/);

    const emptyList = await send(
      interaction('ride', 'member', [], {
        options: [{ name: 'list', type: 1 }],
      }),
    );
    assert.match(emptyList.json().data.content, /inga kommande/);

    const saveTemplate = await send(
      interaction('ride', 'leader', ['ride-leader'], { options: subcommand('mall-spara') }),
    );
    assert.equal(saveTemplate.json().type, 9);
    const savedTemplate = await send(
      modal('template_save', 'leader', ['ride-leader'], {
        name: 'Tisdagsmall',
        title: 'Tisdagsintervaller',
        duration: '60',
        ride_type: 'intervaller',
        details: 'Beskrivning: Fyra block\nRutt/värld: Watopia',
      }),
    );
    const templateId = /#(\d+)/.exec(savedTemplate.json().data.content)?.[1];
    assert.ok(templateId);

    const createFromTemplate = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: subcommand('mall-skapa', Number(templateId)),
      }),
    );
    assert.equal(createFromTemplate.json().type, 9);
    const templateStart = future.plus({ days: 1 }).toFormat('yyyy-MM-dd HH:mm');
    const generated = await send(
      modal(`template_create_ride:${templateId}`, 'leader', ['ride-leader'], {
        date_time: templateStart,
        zwift_url: 'https://zwift.test/template',
      }),
    );
    assert.match(generated.json().data.content, /har sparats och publiceras från mallen/);
    const duplicate = await send(
      modal(`template_create_ride:${templateId}`, 'leader', ['ride-leader'], {
        date_time: templateStart,
        zwift_url: 'https://zwift.test/template',
      }),
    );
    assert.match(duplicate.json().data.content, /finns redan/);
    await waitForDiscordBackgroundTasks();
    const generatedRideId = /#(\d+)/.exec(generated.json().data.content)?.[1];
    assert.ok(generatedRideId);
    const adminCancel = await send(
      interaction('ride', 'admin-user', ['admin'], {
        options: subcommand('cancel', Number(generatedRideId)),
      }),
    );
    assert.match(adminCancel.json().data.content, /har ställts in/);
    await waitForDiscordBackgroundTasks();

    const editTemplate = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: subcommand('mall-redigera', Number(templateId)),
      }),
    );
    assert.equal(editTemplate.json().type, 9);
    const editedTemplate = await send(
      modal(`template_edit:${templateId}`, 'leader', ['ride-leader'], {
        name: 'Tisdagsmall',
        title: 'Nya tisdagsintervaller',
        duration: '75',
        ride_type: 'intervaller',
      }),
    );
    assert.match(editedTemplate.json().data.content, /har uppdaterats/);
    const disabled = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: subcommand('mall-inaktivera', Number(templateId)),
      }),
    );
    assert.match(disabled.json().data.content, /har inaktiverats/);
  },
);
