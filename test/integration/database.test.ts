import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
process.env.DISCORD_APPLICATION_ID ??= 'application';
process.env.DISCORD_PUBLIC_KEY ??= '00'.repeat(32);
process.env.DISCORD_BOT_TOKEN ??= 'token';
process.env.DISCORD_GUILD_ID ??= 'guild';
process.env.PUBLIC_BASE_URL = 'https://strava-integration.example.test';
process.env.STRAVA_CLIENT_ID = 'test-strava-client-id';
process.env.STRAVA_CLIENT_SECRET = 'test-strava-client-secret';
process.env.STRAVA_VERIFY_TOKEN = 'test-strava-verify-token';
process.env.STRAVA_STATE_SECRET = 'test-strava-state-secret';
process.env.TOKEN_ENCRYPTION_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

let db: typeof import('../../src/db/pool.js');
let rides: typeof import('../../src/rides/repository.js');
let strava: typeof import('../../src/strava/service.js');

before(async () => {
  if (!databaseUrl) return;
  db = await import('../../src/db/pool.js');
  const { migrate } = await import('../../src/db/migrate.js');
  await migrate(db.pool);
  rides = await import('../../src/rides/repository.js');
  strava = await import('../../src/strava/service.js');
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
    ['001_init.sql', '002_ride_metadata_and_templates.sql'],
  );
});

integration(
  'ride lifecycle, participants, attendance and leaderboard use real PostgreSQL',
  async () => {
    await rides.upsertUser('leader', 'Leader');
    await rides.upsertUser('member', 'Member');
    const ride = await rides.createRide({
      title: 'Morning ride',
      rideType: 'social',
      startsAt: new Date(Date.now() + 3_600_000),
      durationMinutes: 60,
      creatorDiscordId: 'leader',
      channelId: 'channel',
    });
    assert.equal((await rides.getRide(ride.id))?.title, 'Morning ride');

    await rides.setParticipant(ride.id, 'member', 'going');
    await rides.setParticipant(ride.id, 'member', 'maybe');
    assert.deepEqual(await rides.participantCounts(ride.id), {
      going: 0,
      maybe: 1,
    });
    await rides.markAttendance(ride.id, 'member');
    assert.deepEqual(await rides.participantCounts(ride.id), {
      going: 1,
      maybe: 0,
    });
    assert.equal((await rides.getLeaderboard())[0].display_name, 'Member');
    assert.equal((await rides.cancelRide(ride.id))?.status, 'cancelled');
    assert.equal(
      (await rides.listUpcomingRides()).some((item) => item.id === ride.id),
      false,
    );
  },
);

integration(
  'Strava activity matching is time-bounded and duplicate delivery is idempotent',
  async () => {
    await rides.upsertUser('athlete', 'Athlete');
    const start = new Date(Date.now() + 7_200_000);
    const ride = await rides.createRide({
      title: 'Zwift',
      rideType: 'social',
      startsAt: start,
      durationMinutes: 60,
      creatorDiscordId: 'athlete',
      channelId: 'channel',
    });
    await rides.setParticipant(ride.id, 'athlete', 'going');
    await strava.saveConnection('athlete', {
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete: { id: 42 },
    });

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 99,
          name: 'Virtual',
          sport_type: 'VirtualRide',
          start_date: start.toISOString(),
        }),
        { status: 200 },
      );
    await strava.handleActivityWebhook(42, 99, mockFetch);
    await strava.handleActivityWebhook(42, 99, mockFetch);
    const activity = await db.pool.query(
      'SELECT ride_id FROM activities WHERE strava_activity_id=99',
    );
    assert.equal(activity.rowCount, 1);
    assert.equal(activity.rows[0].ride_id, ride.id);

    const outside: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 100,
          sport_type: 'VirtualRide',
          start_date: new Date(start.getTime() + 31 * 60_000).toISOString(),
        }),
        { status: 200 },
      );
    await strava.handleActivityWebhook(42, 100, outside);
    assert.equal(
      (await db.pool.query('SELECT ride_id FROM activities WHERE strava_activity_id=100')).rows[0]
        .ride_id,
      null,
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

integration('expired Strava tokens refresh and API failures are surfaced', async () => {
  await db.pool.query('UPDATE strava_connections SET expires_at=0 WHERE athlete_id=42');
  const calls: string[] = [];
  const refreshingFetch: typeof fetch = async (input) => {
    calls.push(String(input));
    if (String(input).includes('/oauth/token'))
      return new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
        { status: 200 },
      );
    return new Response(
      JSON.stringify({
        id: 101,
        sport_type: 'Ride',
        start_date: new Date().toISOString(),
      }),
      { status: 200 },
    );
  };
  await strava.handleActivityWebhook(42, 101, refreshingFetch);
  assert.equal(calls.length, 2);

  await assert.rejects(
    () => strava.handleActivityWebhook(42, 102, async () => new Response('', { status: 500 })),
    /token refresh failed|activity fetch failed/,
  );
  await strava.handleActivityWebhook(999999, 1, async () => {
    throw new Error('must not fetch');
  });
  await strava.disconnectAthlete(42);
  assert.equal(
    (await db.pool.query('SELECT 1 FROM strava_connections WHERE athlete_id=42')).rowCount,
    0,
  );
});
