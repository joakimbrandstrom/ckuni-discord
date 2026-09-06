import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
process.env.DISCORD_APPLICATION_ID ??= 'application';
process.env.DISCORD_PUBLIC_KEY ??= '00'.repeat(32);
process.env.DISCORD_BOT_TOKEN ??= 'token';
process.env.DISCORD_GUILD_ID ??= 'guild';

let db: typeof import('../../src/db/pool.js');
let rides: typeof import('../../src/rides/repository.js');
let drafts: typeof import('../../src/rides/drafts.js');

before(async () => {
  if (!databaseUrl) return;
  db = await import('../../src/db/pool.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  rides = await import('../../src/rides/repository.js');
  drafts = await import('../../src/rides/drafts.js');
});

after(async () => {
  if (db) await db.closePool();
});

integration('migrations are repeatable', async () => {
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  const result = await db.pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.deepEqual(
    result.rows.map((row) => row.filename),
    [
      '001_init.sql',
      '002_ride_metadata_and_templates.sql',
      '003_ride_creation_drafts.sql',
      '004_remove_strava.sql',
    ],
  );
});

integration(
  'seeded upgrade removes Strava tables and preserves attendance on repeat migration',
  async () => {
    const { migrate } = await import('../../src/db/migrate.js');
    const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    const database = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    try {
      await database.query(`CREATE TABLE schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
      for (const filename of [
        '001_init.sql',
        '002_ride_metadata_and_templates.sql',
        '003_ride_creation_drafts.sql',
      ]) {
        await database.query(
          await readFile(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8'),
        );
        await database.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
      }
      await database.query(`
      INSERT INTO users(discord_id, display_name) VALUES ('member', 'Member');
      INSERT INTO rides(id, title, ride_type, starts_at, duration_minutes, creator_discord_id, discord_channel_id)
        VALUES (1, 'Historical ride', 'social', '2026-01-01T10:00:00Z', 60, 'member', 'channel');
      INSERT INTO ride_participants(ride_id, discord_id, status, attended_at)
        VALUES (1, 'member', 'going', '2026-01-01T11:00:00Z');
      INSERT INTO strava_connections(discord_id, athlete_id, access_token_enc, refresh_token_enc, expires_at)
        VALUES ('member', 42, 'dummy-access', 'dummy-refresh', 0);
      INSERT INTO activities(strava_activity_id, discord_id, ride_id, sport_type, start_date)
        VALUES (99, 'member', 1, 'VirtualRide', '2026-01-01T10:00:00Z');
    `);
      const participants = (await database.query('SELECT * FROM ride_participants')).rows;
      const users = (await database.query('SELECT * FROM users')).rows;
      const storedRides = (await database.query('SELECT * FROM rides')).rows;
      for (let run = 0; run < 2; run++) {
        await migrate(database);
        assert.deepEqual(
          (await database.query('SELECT * FROM ride_participants')).rows,
          participants,
        );
        assert.deepEqual((await database.query('SELECT * FROM users')).rows, users);
        assert.deepEqual((await database.query('SELECT * FROM rides')).rows, storedRides);
        assert.deepEqual(
          (
            await database.query(
              "SELECT to_regclass('activities') AS activities, to_regclass('strava_connections') AS connections",
            )
          ).rows,
          [{ activities: null, connections: null }],
        );
        assert.equal(
          (
            await database.query(
              "SELECT 1 FROM schema_migrations WHERE filename='004_remove_strava.sql'",
            )
          ).rowCount,
          1,
        );
      }
    } finally {
      await database.end();
      await db.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  },
);

integration(
  'ride lifecycle, participants, attendance and leaderboard use real PostgreSQL',
  async () => {
    const member = `member-${randomUUID()}`;
    await rides.upsertUser('leader', 'Leader');
    await rides.upsertUser(member, member);
    const ride = await rides.createRide({
      title: 'Morning ride',
      rideType: 'social',
      startsAt: new Date(Date.now() + 3_600_000),
      durationMinutes: 60,
      creatorDiscordId: 'leader',
      channelId: 'channel',
    });
    assert.equal((await rides.getRide(ride.id))?.title, 'Morning ride');

    const started = await rides.createRide({
      title: 'Already started',
      rideType: 'social',
      startsAt: new Date(Date.now() - 60_000),
      durationMinutes: 60,
      creatorDiscordId: 'leader',
      channelId: 'channel',
    });
    assert.equal(
      (await rides.listUpcomingRides()).some((item) => item.id === started.id),
      false,
    );

    await rides.setParticipant(ride.id, member, 'going');
    assert.equal(
      (await rides.getLeaderboard()).some((row) => row.display_name === member),
      false,
    );
    await rides.setParticipant(ride.id, member, 'maybe');
    assert.equal(
      (await rides.getLeaderboard()).some((row) => row.display_name === member),
      false,
    );
    assert.deepEqual(await rides.participantCounts(ride.id), {
      going: 0,
      maybe: 1,
    });
    await rides.markAttendance(ride.id, member);
    assert.deepEqual(await rides.participantCounts(ride.id), {
      going: 1,
      maybe: 0,
    });
    assert.equal(
      (await rides.getLeaderboard()).find((row) => row.display_name === member)?.points,
      '10',
    );
    assert.equal((await rides.cancelRide(ride.id))?.status, 'cancelled');
    assert.equal(
      (await rides.listUpcomingRides()).some((item) => item.id === ride.id),
      false,
    );
  },
);

integration(
  'ride templates are editable, disableable and prevent duplicate generated rides',
  async () => {
    const suffix = String(Date.now());
    await rides.upsertUser(`template-leader-${suffix}`, 'Mallansvarig');
    const template = await rides.createRideTemplate({
      name: `Tisdagsintervaller ${suffix}`,
      title: 'Tisdagsintervaller',
      description: 'Fyra block',
      rideType: 'intervals',
      durationMinutes: 60,
      creatorDiscordId: `template-leader-${suffix}`,
    });
    assert.equal((await rides.getRideTemplate(template.id))?.active, true);

    const updated = await rides.updateRideTemplate(template.id, {
      name: `Tisdagsintervaller ${suffix}`,
      title: 'Nya intervaller',
      rideType: 'intervals',
      durationMinutes: 75,
    });
    assert.equal(updated?.duration_minutes, 75);

    const start = new Date(Date.now() + 86_400_000);
    await rides.createRide({
      title: updated?.title ?? 'Nya intervaller',
      rideType: 'intervals',
      startsAt: start,
      durationMinutes: 75,
      creatorDiscordId: `template-leader-${suffix}`,
      channelId: 'channel',
      templateId: template.id,
    });
    await assert.rejects(
      () =>
        rides.createRide({
          title: 'Dubblett',
          rideType: 'intervals',
          startsAt: start,
          durationMinutes: 75,
          creatorDiscordId: `template-leader-${suffix}`,
          channelId: 'channel',
          templateId: template.id,
        }),
      (error: unknown) => (error as { code?: string }).code === '23505',
    );
    assert.equal((await rides.disableRideTemplate(template.id))?.active, false);
  },
);

integration(
  'ride drafts persist, enforce ownership and create one ride on publication',
  async () => {
    const suffix = String(Date.now());
    const owner = `draft-owner-${suffix}`;
    const other = `draft-other-${suffix}`;
    await rides.upsertUser(owner, 'Draft owner');
    await rides.upsertUser(other, 'Other leader');
    const template = await rides.createRideTemplate({
      name: `Draft template ${suffix}`,
      title: 'Tisdagsintervaller',
      description: 'Fyra block',
      rideType: 'intervals',
      durationMinutes: 60,
      routeWorld: 'Watopia',
      paceWorkout: '2,5 W/kg',
      notes: 'Samling i röstkanalen',
      creatorDiscordId: owner,
    });

    const draft = await drafts.createRideDraftFromTemplate(owner, template.id, 'ride-channel');
    assert.ok(draft);
    assert.equal(draft.title, 'Tisdagsintervaller');
    assert.equal(await drafts.getRideDraft(draft.id, other), null);
    assert.equal(
      (
        await db.pool.query('SELECT COUNT(*)::int AS count FROM rides WHERE creation_draft_id=$1', [
          draft.id,
        ])
      ).rows[0].count,
      0,
    );

    const startsAt = new Date(Date.now() + 86_400_000);
    await drafts.updateRideDraftSchedule(draft.id, owner, {
      startsAt,
      zwiftUrl: 'https://zwift.test/draft',
      extraComment: 'Ta med vatten.',
    });
    await assert.rejects(
      () => drafts.prepareRideDraftPublication(draft.id, other),
      (error: unknown) => (error as { code?: string }).code === 'not_found',
    );

    const first = await drafts.prepareRideDraftPublication(draft.id, owner);
    const second = await drafts.prepareRideDraftPublication(draft.id, owner);
    assert.equal(first.ride.id, second.ride.id);
    assert.equal(first.ride.notes, 'Samling i röstkanalen\nTa med vatten.');
    assert.deepEqual(await rides.participantCounts(first.ride.id), { going: 1, maybe: 0 });
    assert.equal(
      (
        await db.pool.query('SELECT COUNT(*)::int AS count FROM rides WHERE creation_draft_id=$1', [
          draft.id,
        ])
      ).rows[0].count,
      1,
    );

    const copied = await drafts.createRideDraftFromLatestRide(owner, 'other-channel');
    assert.ok(copied);
    assert.equal(copied.title, first.ride.title);
    assert.equal(copied.starts_at, null);
    assert.equal(copied.zwift_url, null);
    assert.equal(copied.published_ride_id, null);
    assert.equal(copied.status, 'active');

    await db.pool.query("UPDATE rides SET starts_at=NOW() - INTERVAL '1 minute' WHERE id=$1", [
      first.ride.id,
    ]);
    await assert.rejects(
      () => drafts.prepareRideDraftPublication(draft.id, owner),
      (error: unknown) => (error as { code?: string }).code === 'expired',
    );
    assert.equal(
      (await db.pool.query('SELECT status FROM ride_drafts WHERE id=$1', [draft.id])).rows[0]
        .status,
      'expired',
    );

    await db.pool.query(
      "UPDATE ride_drafts SET expires_at=NOW() - INTERVAL '1 minute' WHERE id=$1",
      [copied.id],
    );
    await assert.rejects(
      () => drafts.prepareRideDraftPublication(copied.id, owner),
      (error: unknown) => (error as { code?: string }).code === 'expired',
    );
    assert.equal(
      (await db.pool.query('SELECT status FROM ride_drafts WHERE id=$1', [copied.id])).rows[0]
        .status,
      'expired',
    );

    const inactiveTemplate = await rides.createRideTemplate({
      name: `Inactive draft template ${suffix}`,
      title: 'Distanspass',
      rideType: 'endurance',
      durationMinutes: 90,
      creatorDiscordId: owner,
    });
    const inactiveDraft = await drafts.createRideDraftFromTemplate(
      owner,
      inactiveTemplate.id,
      'ride-channel',
    );
    assert.ok(inactiveDraft);
    await drafts.updateRideDraftSchedule(inactiveDraft.id, owner, {
      startsAt: new Date(Date.now() + 172_800_000),
    });
    await rides.disableRideTemplate(inactiveTemplate.id);
    await assert.rejects(
      () => drafts.prepareRideDraftPublication(inactiveDraft.id, owner),
      (error: unknown) => (error as { code?: string }).code === 'template_inactive',
    );
  },
);
