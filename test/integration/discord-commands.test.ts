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

let app: FastifyInstance;
let db: typeof import('../../src/db/pool.js');
const originalFetch = globalThis.fetch;
const discordCalls: Array<{ url: string; method?: string; body?: string }> = [];
let messageSequence = 0;
let eventSequence = 0;
let loseNextEventResponse = false;
const scheduledEvents: Array<{ id: string; description?: string }> = [];

before(async () => {
  if (!databaseUrl) return;
  // Scheduled Discord events are the only external request in this flow. The
  // application database remains real while the remote Discord API is isolated.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    discordCalls.push({ url, method: init?.method, body: String(init?.body ?? '') });
    if (url.endsWith('/scheduled-events') && init?.method === 'GET') {
      return new Response(JSON.stringify(scheduledEvents), { status: 200 });
    }
    if (url.endsWith('/scheduled-events') && init?.method === 'POST') {
      const event = {
        id: `event-${++eventSequence}`,
        description: (JSON.parse(String(init.body)) as { description?: string }).description,
      };
      scheduledEvents.push(event);
      if (loseNextEventResponse) {
        loseNextEventResponse = false;
        throw new TypeError('connection closed after Discord accepted the event');
      }
      return new Response(JSON.stringify(event), { status: 200 });
    }
    const id =
      url.includes('/channels/') && init?.method === 'POST' ? `message-${++messageSequence}` : 'ok';
    return new Response(JSON.stringify({ id }), { status: 200 });
  };
  db = await import('../../src/db/pool.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  await db.pool.query(
    'TRUNCATE ride_participants, ride_drafts, rides, ride_templates, users RESTART IDENTITY CASCADE',
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
      type: 18,
      component:
        custom_id === 'ride_type'
          ? { type: 3, custom_id, values: [value] }
          : { type: 4, custom_id, value },
    })),
  };
  return payload;
}

function component(
  customId: string,
  userId: string,
  roles: string[] = [],
  values?: string[],
): DiscordInteraction {
  const payload = interaction('', userId, roles);
  payload.type = 3;
  payload.data = { custom_id: customId, component_type: values ? 3 : 2, values };
  return payload;
}

function draftIdFrom(payload: Record<string, unknown>): string {
  const data = payload.data as {
    custom_id?: string;
    components?: Array<{ components?: Array<{ custom_id?: string }> }>;
  };
  const customId =
    data.custom_id ??
    data.components
      ?.flatMap((row) => row.components ?? [])
      .find((item) => item.custom_id?.startsWith('ride_draft_'))?.custom_id;
  const draftId = customId?.split(':')[1];
  assert.ok(draftId);
  return draftId;
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
    assert.equal(opened.json().type, 4);
    assert.equal(opened.json().data.flags, 64);
    assert.match(JSON.stringify(opened.json().data.components), /Kopiera senaste/);
    assert.match(JSON.stringify(opened.json().data.components), /Skapa nytt pass/);

    const noPrevious = await send(component('ride_create_copy', 'new-leader', ['ride-leader']));
    assert.match(noPrevious.json().data.content, /inget tidigare officiellt pass/);

    const newModal = await send(component('ride_create_new', 'leader', ['ride-leader']));
    assert.equal(newModal.json().type, 9);
    assert.match(newModal.json().data.custom_id, /^ride_draft_basic:/);
    assert.ok(newModal.json().data.components.every((item: { type: number }) => item.type === 18));
    const draftId = draftIdFrom(newModal.json());

    const pastCreate = await send(
      modal(`ride_draft_basic:${draftId}`, 'leader', ['ride-leader'], {
        title: 'För sent pass',
        date: DateTime.utc().minus({ hours: 1 }).toFormat('yyyy-MM-dd'),
        time: DateTime.utc().minus({ hours: 1 }).toFormat('HH:mm'),
        duration: '60',
        ride_type: 'social',
      }),
    );
    assert.match(pastCreate.json().data.content, /framtiden/);

    const preview = await send(
      modal(`ride_draft_basic:${draftId}`, 'leader', ['ride-leader'], {
        title: 'Integrationspass',
        date: future.toFormat('yyyy-MM-dd'),
        time: future.toFormat('HH:mm'),
        duration: '60',
        ride_type: 'social',
      }),
    );
    assert.match(preview.json().data.content, /Förhandsvisning/);
    assert.match(preview.json().data.content, /<#channel>/);
    assert.match(JSON.stringify(preview.json().data.components), /Publicera/);
    assert.equal(
      (await db.pool.query('SELECT COUNT(*)::int AS count FROM rides')).rows[0].count,
      0,
    );

    const detailsModal = await send(
      component(`ride_draft_edit_details:${draftId}`, 'leader', ['ride-leader']),
    );
    assert.equal(detailsModal.json().type, 9);
    assert.ok(
      detailsModal.json().data.components.every((item: { type: number }) => item.type === 18),
    );
    const detailedPreview = await send(
      modal(`ride_draft_details:${draftId}`, 'leader', ['ride-leader'], {
        zwift_url: 'https://zwift.test/1',
        description: 'Lugnt pass',
        route_world: 'Watopia',
        pace_workout: '2,5 W/kg',
        notes: 'Samling i röstkanalen',
      }),
    );
    assert.match(detailedPreview.json().data.embeds[0].description, /Lugnt pass/);

    const editBasic = await send(
      component(`ride_draft_edit_basic:${draftId}`, 'leader', ['ride-leader']),
    );
    assert.equal(editBasic.json().type, 9);
    const editedPreview = await send(
      modal(`ride_draft_basic:${draftId}`, 'leader', ['ride-leader'], {
        title: 'Uppdaterat integrationspass',
        date: future.toFormat('yyyy-MM-dd'),
        time: future.toFormat('HH:mm'),
        duration: '75',
        ride_type: 'endurance',
      }),
    );
    assert.match(editedPreview.json().data.embeds[0].title, /Uppdaterat integrationspass/);

    const foreignPublish = await send(
      component(`ride_draft_publish:${draftId}`, 'other-leader', ['ride-leader']),
    );
    assert.match(foreignPublish.json().data.content, /annan användare/);

    const firstPublish = await send(
      component(`ride_draft_publish:${draftId}`, 'leader', ['ride-leader']),
    );
    const retryPublish = await send(
      component(`ride_draft_publish:${draftId}`, 'leader', ['ride-leader']),
    );
    assert.match(firstPublish.json().data.content, /Publicerar/);
    assert.match(retryPublish.json().data.content, /Publicerar/);
    await waitForDiscordBackgroundTasks();
    assert.ok(discordCalls.some((call) => call.url.endsWith('/messages/@original')));
    const stored = await db.pool.query('SELECT * FROM rides WHERE creation_draft_id=$1', [draftId]);
    assert.equal(stored.rowCount, 1);
    const rideId = String(stored.rows[0].id);
    assert.equal(
      discordCalls.filter(
        (call) => call.url.endsWith('/channels/channel/messages') && call.method === 'POST',
      ).length,
      1,
    );
    const publishedMessage = discordCalls.find(
      (call) => call.url.endsWith('/channels/channel/messages') && call.method === 'POST',
    );
    assert.equal(
      (JSON.parse(publishedMessage?.body ?? '{}') as { enforce_nonce?: boolean }).enforce_nonce,
      true,
    );
    assert.equal(
      discordCalls.filter(
        (call) => call.url.includes('/scheduled-events') && call.method === 'POST',
      ).length,
      1,
    );
    assert.ok(
      scheduledEvents.some((event) => event.description?.includes(`CK UNI Pass-ID: ${rideId}`)),
    );

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
        details:
          'Veckotid: tisdag 18:00\nSnabbval: 1\nBeskrivning: Fyra block\nRutt/värld: Watopia',
      }),
    );
    const templateId = /#(\d+)/.exec(savedTemplate.json().data.content)?.[1];
    assert.ok(templateId);
    await db.pool.query(
      `INSERT INTO ride_templates(name, title, ride_type, duration_minutes, creator_discord_id)
       SELECT 'ZZ Mall ' || LPAD(value::text, 2, '0'), 'Pass ' || value, 'social', 60, 'leader'
       FROM generate_series(0, 25) AS value`,
    );
    await db.pool.query(
      `INSERT INTO ride_templates(
         name, title, ride_type, duration_minutes, creator_discord_id, quick_create, sort_order
       ) VALUES
         ('Snabbmall A', 'Snabbpass A', 'social', 60, 'leader', TRUE, 10),
         ('Snabbmall B', 'Snabbpass B', 'social', 60, 'leader', TRUE, 11),
         ('Snabbmall C', 'Snabbpass C', 'social', 60, 'leader', TRUE, 12)`,
    );

    const builderWithTemplate = await send(
      interaction('ride', 'leader', ['ride-leader'], { options: subcommand('create') }),
    );
    const builderJson = JSON.stringify(builderWithTemplate.json().data.components);
    assert.match(builderJson, /Tisdagsmall/);
    assert.match(builderJson, /ride_create_quick/);
    assert.match(builderJson, /Andra mallar/);
    assert.equal(builderJson.match(/ride_create_quick/g)?.length, 3);
    assert.match(builderJson, /Snabbmall B/);
    assert.doesNotMatch(builderJson, /Snabbmall C.*ride_create_quick/);
    assert.match(builderJson, /Snabbpass C/);
    assert.match(builderJson, /Fler mallar/);
    assert.doesNotMatch(builderJson, /Mall-ID|#\d+/);
    const nextTemplatePage = await send(
      component('ride_create_templates:1', 'leader', ['ride-leader']),
    );
    assert.equal(nextTemplatePage.json().type, 7);
    assert.match(JSON.stringify(nextTemplatePage.json().data.components), /ZZ Mall 25/);

    const createFromTemplate = await send(
      component(`ride_create_quick:${templateId}`, 'leader', ['ride-leader']),
    );
    assert.equal(createFromTemplate.json().type, 9);
    const templateDraftId = draftIdFrom(createFromTemplate.json());
    const proposedTemplateDraft = await db.pool.query(
      'SELECT starts_at FROM ride_drafts WHERE id=$1',
      [templateDraftId],
    );
    const proposedTemplateStart = DateTime.fromJSDate(proposedTemplateDraft.rows[0].starts_at, {
      zone: 'utc',
    }).setZone('UTC');
    assert.equal(proposedTemplateStart.weekday, 2);
    assert.equal(proposedTemplateStart.toFormat('HH:mm'), '18:00');
    const templateStart = future.plus({ days: 1 });
    const generatedPreview = await send(
      modal(`ride_draft_schedule:${templateDraftId}`, 'leader', ['ride-leader'], {
        date: templateStart.toFormat('yyyy-MM-dd'),
        time: templateStart.toFormat('HH:mm'),
        zwift_url: 'https://zwift.test/template',
        extra_comment: 'Ta med vatten',
      }),
    );
    assert.match(generatedPreview.json().data.content, /Förhandsvisning/);
    assert.match(
      generatedPreview.json().data.embeds[0].description,
      /Extra kommentar: Ta med vatten/,
    );
    assert.equal(
      (
        await db.pool.query('SELECT COUNT(*)::int AS count FROM rides WHERE creation_draft_id=$1', [
          templateDraftId,
        ])
      ).rows[0].count,
      0,
    );
    await send(component(`ride_draft_publish:${templateDraftId}`, 'leader', ['ride-leader']));
    await waitForDiscordBackgroundTasks();
    const generatedRideId = String(
      (await db.pool.query('SELECT id FROM rides WHERE creation_draft_id=$1', [templateDraftId]))
        .rows[0].id,
    );

    const legacyTemplate = await send(
      interaction('ride', 'leader', ['ride-leader'], {
        options: subcommand('mall-skapa', Number(templateId)),
      }),
    );
    assert.equal(legacyTemplate.json().type, 9);
    assert.match(legacyTemplate.json().data.custom_id, /^ride_draft_schedule:/);

    const copied = await send(component('ride_create_copy', 'leader', ['ride-leader']));
    assert.equal(copied.json().type, 9);
    const copiedDraftId = draftIdFrom(copied.json());
    const copiedStored = await db.pool.query('SELECT * FROM ride_drafts WHERE id=$1', [
      copiedDraftId,
    ]);
    const copiedSource = await db.pool.query('SELECT starts_at FROM rides WHERE id=$1', [
      copiedStored.rows[0].source_ride_id,
    ]);
    const expectedCopyStart = DateTime.fromJSDate(copiedSource.rows[0].starts_at, {
      zone: 'utc',
    })
      .setZone('UTC')
      .plus({ weeks: 1 });
    assert.equal(new Date(copiedStored.rows[0].starts_at).toISOString(), expectedCopyStart.toISO());
    assert.equal(copiedStored.rows[0].zwift_url, null);
    assert.equal(copiedStored.rows[0].notes, null);
    assert.equal(copiedStored.rows[0].published_ride_id, null);
    const cancelledDraft = await send(
      component(`ride_draft_cancel:${copiedDraftId}`, 'leader', ['ride-leader']),
    );
    assert.match(cancelledDraft.json().data.content, /avbrutits/);
    const cancelledPublish = await send(
      component(`ride_draft_publish:${copiedDraftId}`, 'leader', ['ride-leader']),
    );
    assert.match(cancelledPublish.json().data.content, /avbrutits/);
    assert.equal(
      (
        await db.pool.query('SELECT COUNT(*)::int AS count FROM rides WHERE creation_draft_id=$1', [
          copiedDraftId,
        ])
      ).rows[0].count,
      0,
    );

    const expiredModal = await send(component('ride_create_new', 'leader', ['ride-leader']));
    const expiredDraftId = draftIdFrom(expiredModal.json());
    await db.pool.query(
      "UPDATE ride_drafts SET expires_at=NOW() - INTERVAL '1 minute' WHERE id=$1",
      [expiredDraftId],
    );
    const expired = await send(
      component(`ride_draft_edit_basic:${expiredDraftId}`, 'leader', ['ride-leader']),
    );
    assert.match(expired.json().data.content, /gått ut/);
    const expiredPublish = await send(
      component(`ride_draft_publish:${expiredDraftId}`, 'leader', ['ride-leader']),
    );
    assert.match(expiredPublish.json().data.content, /gått ut/);

    const partialModal = await send(component('ride_create_new', 'leader', ['ride-leader']));
    const partialDraftId = draftIdFrom(partialModal.json());
    await send(
      modal(`ride_draft_basic:${partialDraftId}`, 'leader', ['ride-leader'], {
        title: 'Partiell publicering',
        date: future.plus({ days: 2 }).toFormat('yyyy-MM-dd'),
        time: future.toFormat('HH:mm'),
        duration: '60',
        ride_type: 'social',
      }),
    );
    const callsBeforePartial = discordCalls.length;
    loseNextEventResponse = true;
    await send(component(`ride_draft_publish:${partialDraftId}`, 'leader', ['ride-leader']));
    await waitForDiscordBackgroundTasks();
    const partialAfterFailure = await db.pool.query(
      `SELECT d.status, r.discord_message_id, r.discord_event_id
       FROM ride_drafts d JOIN rides r ON r.id=d.published_ride_id WHERE d.id=$1`,
      [partialDraftId],
    );
    assert.deepEqual(partialAfterFailure.rows[0], {
      status: 'publishing',
      discord_message_id: 'message-3',
      discord_event_id: null,
    });
    await send(component(`ride_draft_publish:${partialDraftId}`, 'leader', ['ride-leader']));
    await waitForDiscordBackgroundTasks();
    const partialCalls = discordCalls.slice(callsBeforePartial);
    assert.equal(
      partialCalls.filter((call) => call.url.includes('/channels/') && call.method === 'POST')
        .length,
      1,
    );
    assert.equal(
      partialCalls.filter(
        (call) => call.url.includes('/scheduled-events') && call.method === 'POST',
      ).length,
      1,
    );
    assert.equal(
      (await db.pool.query('SELECT status FROM ride_drafts WHERE id=$1', [partialDraftId])).rows[0]
        .status,
      'published',
    );

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
        details: 'Veckotid: torsdag 18:30\nSnabbval: 2',
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

integration(
  'optional Zwift validation falls back to manual preview and idempotent publication',
  async () => {
    const { config } = await import('../../src/config.js');
    const enabled = config.ZWIFT_ENABLED;
    config.ZWIFT_ENABLED = true;
    try {
      const opened = await send(component('ride_create_new', 'zwift-leader', ['ride-leader']));
      const draftId = draftIdFrom(opened.json());
      // A draft saved before the optional integration was enabled may contain a legacy link.
      await db.pool.query('UPDATE ride_drafts SET zwift_url=$2 WHERE id=$1', [
        draftId,
        'https://legacy.test/event',
      ]);
      await send(
        modal(`ride_draft_basic:${draftId}`, 'zwift-leader', ['ride-leader'], {
          title: 'Manual fallback',
          date: '2099-10-27',
          time: '18:00',
          duration: '60',
          ride_type: 'race',
        }),
      );
      const invalid = await send(
        modal(`ride_draft_details:${draftId}`, 'zwift-leader', ['ride-leader'], {
          zwift_url: 'https://evil.test/events/123',
        }),
      );
      assert.match(invalid.json().data.content, /giltig Zwift-länk/);
      const legacyPreview = await send(
        modal(`ride_draft_details:${draftId}`, 'zwift-leader', ['ride-leader'], {
          zwift_url: 'https://legacy.test/event',
          description: 'Changed description',
        }),
      );
      assert.match(JSON.stringify(legacyPreview.json().data.embeds), /manuella uppgifter/);
      const preview = await send(
        modal(`ride_draft_details:${draftId}`, 'zwift-leader', ['ride-leader'], {
          zwift_url: 'https://www.zwift.com/events/view/123?utm_source=private',
        }),
      );
      assert.match(JSON.stringify(preview.json().data.embeds), /publicera manuellt/);
      assert.match(JSON.stringify(preview.json().data.components), /Publicera/);
      assert.equal(
        (await db.pool.query('SELECT zwift_url FROM ride_drafts WHERE id=$1', [draftId])).rows[0]
          .zwift_url,
        'https://www.zwift.com/events/view/123',
      );
      const before = discordCalls.filter(
        (call) => call.method === 'POST' && call.url.includes('/channels/'),
      ).length;
      await send(component(`ride_draft_publish:${draftId}`, 'zwift-leader', ['ride-leader']));
      await waitForDiscordBackgroundTasks();
      await send(component(`ride_draft_publish:${draftId}`, 'zwift-leader', ['ride-leader']));
      await waitForDiscordBackgroundTasks();
      assert.equal(
        discordCalls.filter((call) => call.method === 'POST' && call.url.includes('/channels/'))
          .length,
        before + 1,
      );
      const ride = (
        await db.pool.query('SELECT id, zwift_url FROM rides WHERE creation_draft_id=$1', [draftId])
      ).rows[0];
      assert.equal(ride.zwift_url, 'https://www.zwift.com/events/view/123');
      await db.pool.query('UPDATE rides SET zwift_url=$2 WHERE id=$1', [
        ride.id,
        'https://legacy.test/event',
      ]);
      const editFields = {
        title: 'Legacy edit',
        date_time: '2099-10-27 18:00',
        duration: '60',
        ride_type: 'race',
        details: 'Zwift: https://legacy.test/event',
      };
      const edited = await send(
        modal(`ride_edit:${ride.id}`, 'zwift-leader', ['ride-leader'], editFields),
      );
      assert.match(edited.json().data.content, /har sparats/);
      await waitForDiscordBackgroundTasks();
      const savedLegacy = (
        await db.pool.query('SELECT title, zwift_url FROM rides WHERE id=$1', [ride.id])
      ).rows[0];
      assert.equal(savedLegacy.title, 'Legacy edit');
      assert.equal(savedLegacy.zwift_url, 'https://legacy.test/event');
      await send(
        modal(`ride_edit:${ride.id}`, 'zwift-leader', ['ride-leader'], {
          ...editFields,
          details: 'Zwift: https://zwift.com/events/123?utm_source=private',
        }),
      );
      await waitForDiscordBackgroundTasks();
      assert.equal(
        (await db.pool.query('SELECT zwift_url FROM rides WHERE id=$1', [ride.id])).rows[0]
          .zwift_url,
        'https://www.zwift.com/events/view/123',
      );
    } finally {
      config.ZWIFT_ENABLED = enabled;
    }
  },
);
