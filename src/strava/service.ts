import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { decryptToken, encryptToken } from './crypto.js';
import { markAttendance } from '../rides/repository.js';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  athlete: { id: number; firstname?: string; lastname?: string };
};

type StravaConnection = {
  discord_id: string;
  athlete_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scope: string | null;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.STRAVA_CLIENT_ID!,
    client_secret: config.STRAVA_CLIENT_SECRET!,
    code,
    grant_type: 'authorization_code'
  });
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`Strava token exchange failed: ${response.status}`);
  return (await response.json()) as TokenResponse;
}

async function refreshConnection(connection: StravaConnection): Promise<{ token: string; expiresAt: number }> {
  const refreshToken = decryptToken(connection.refresh_token_enc, config.TOKEN_ENCRYPTION_KEY!);
  const body = new URLSearchParams({
    client_id: config.STRAVA_CLIENT_ID!,
    client_secret: config.STRAVA_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`Strava token refresh failed: ${response.status}`);
  const token = (await response.json()) as Omit<TokenResponse, 'athlete'>;
  await pool.query(
    `UPDATE strava_connections
     SET access_token_enc=$2, refresh_token_enc=$3, expires_at=$4, updated_at=NOW()
     WHERE discord_id=$1`,
    [
      connection.discord_id,
      encryptToken(token.access_token, config.TOKEN_ENCRYPTION_KEY!),
      encryptToken(token.refresh_token, config.TOKEN_ENCRYPTION_KEY!),
      token.expires_at
    ]
  );
  return { token: token.access_token, expiresAt: token.expires_at };
}

export async function saveConnection(discordId: string, token: TokenResponse): Promise<void> {
  await pool.query(
    `INSERT INTO strava_connections(
       discord_id, athlete_id, access_token_enc, refresh_token_enc, expires_at, scope
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (discord_id) DO UPDATE SET
       athlete_id=EXCLUDED.athlete_id,
       access_token_enc=EXCLUDED.access_token_enc,
       refresh_token_enc=EXCLUDED.refresh_token_enc,
       expires_at=EXCLUDED.expires_at,
       scope=EXCLUDED.scope,
       updated_at=NOW()`,
    [
      discordId,
      token.athlete.id,
      encryptToken(token.access_token, config.TOKEN_ENCRYPTION_KEY!),
      encryptToken(token.refresh_token, config.TOKEN_ENCRYPTION_KEY!),
      token.expires_at,
      token.scope ?? null
    ]
  );
}

async function connectionByAthlete(athleteId: number): Promise<StravaConnection | null> {
  const result = await pool.query<StravaConnection>(
    'SELECT * FROM strava_connections WHERE athlete_id=$1',
    [athleteId]
  );
  return result.rows[0] ?? null;
}

async function validAccessToken(connection: StravaConnection): Promise<string> {
  if (Number(connection.expires_at) > Math.floor(Date.now() / 1000) + 120) {
    return decryptToken(connection.access_token_enc, config.TOKEN_ENCRYPTION_KEY!);
  }
  return (await refreshConnection(connection)).token;
}

export async function handleActivityWebhook(ownerId: number, activityId: number): Promise<void> {
  const connection = await connectionByAthlete(ownerId);
  if (!connection) return;
  const accessToken = await validAccessToken(connection);

  const response = await fetch(`${config.STRAVA_API_BASE_URL}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Strava activity fetch failed: ${response.status}`);
  const activity = (await response.json()) as {
    id: number;
    name?: string;
    sport_type: string;
    start_date: string;
    distance?: number;
    moving_time?: number;
    total_elevation_gain?: number;
    average_watts?: number;
  };

  const start = new Date(activity.start_date);
  let rideId: string | null = null;
  if (activity.sport_type === 'VirtualRide') {
    const match = await pool.query<{ id: string }>(
      `SELECT r.id
       FROM rides r
       JOIN ride_participants rp ON rp.ride_id = r.id
       WHERE rp.discord_id = $1
         AND rp.status IN ('going','maybe')
         AND r.status = 'scheduled'
         AND ABS(EXTRACT(EPOCH FROM (r.starts_at - $2::timestamptz))) <= 1800
       ORDER BY ABS(EXTRACT(EPOCH FROM (r.starts_at - $2::timestamptz))) ASC
       LIMIT 1`,
      [connection.discord_id, start]
    );
    rideId = match.rows[0]?.id ?? null;
  }

  await pool.query(
    `INSERT INTO activities(
       strava_activity_id, discord_id, ride_id, sport_type, name, start_date,
       distance_m, moving_time_s, elevation_m, average_watts
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (strava_activity_id) DO UPDATE SET
       ride_id=EXCLUDED.ride_id,
       sport_type=EXCLUDED.sport_type,
       name=EXCLUDED.name,
       distance_m=EXCLUDED.distance_m,
       moving_time_s=EXCLUDED.moving_time_s,
       elevation_m=EXCLUDED.elevation_m,
       average_watts=EXCLUDED.average_watts`,
    [
      activity.id,
      connection.discord_id,
      rideId,
      activity.sport_type,
      activity.name ?? null,
      start,
      activity.distance ?? null,
      activity.moving_time ?? null,
      activity.total_elevation_gain ?? null,
      activity.average_watts ?? null
    ]
  );

  if (rideId) await markAttendance(rideId, connection.discord_id);
}

export async function disconnectAthlete(ownerId: number): Promise<void> {
  await pool.query('DELETE FROM strava_connections WHERE athlete_id=$1', [ownerId]);
}
