import { pool } from '../db/pool.js';

export type Ride = {
  id: string;
  title: string;
  description: string | null;
  ride_type: string;
  starts_at: Date;
  duration_minutes: number;
  zwift_url: string | null;
  creator_discord_id: string;
  discord_channel_id: string;
  discord_event_id: string | null;
  status: string;
};

export async function upsertUser(discordId: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO users(discord_id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (discord_id)
     DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [discordId, displayName],
  );
}

export async function createRide(input: {
  title: string;
  description?: string;
  rideType: string;
  startsAt: Date;
  durationMinutes: number;
  zwiftUrl?: string;
  creatorDiscordId: string;
  channelId: string;
}): Promise<Ride> {
  const result = await pool.query<Ride>(
    `INSERT INTO rides(
       title, description, ride_type, starts_at, duration_minutes, zwift_url,
       creator_discord_id, discord_channel_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.title,
      input.description ?? null,
      input.rideType,
      input.startsAt,
      input.durationMinutes,
      input.zwiftUrl ?? null,
      input.creatorDiscordId,
      input.channelId,
    ],
  );
  return result.rows[0];
}

export async function setDiscordEventId(rideId: string, eventId: string): Promise<void> {
  await pool.query('UPDATE rides SET discord_event_id = $2 WHERE id = $1', [rideId, eventId]);
}

export async function getRide(rideId: string): Promise<Ride | null> {
  const result = await pool.query<Ride>('SELECT * FROM rides WHERE id = $1', [rideId]);
  return result.rows[0] ?? null;
}

export async function listUpcomingRides(limit = 10): Promise<Ride[]> {
  const result = await pool.query<Ride>(
    `SELECT * FROM rides
     WHERE status = 'scheduled' AND starts_at >= NOW() - INTERVAL '30 minutes'
     ORDER BY starts_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function cancelRide(rideId: string, creatorDiscordId: string): Promise<Ride | null> {
  const result = await pool.query<Ride>(
    `UPDATE rides SET status = 'cancelled'
     WHERE id = $1 AND creator_discord_id = $2 AND status = 'scheduled'
     RETURNING *`,
    [rideId, creatorDiscordId],
  );
  return result.rows[0] ?? null;
}

export async function setParticipant(
  rideId: string,
  discordId: string,
  status: 'going' | 'maybe' | 'declined',
): Promise<void> {
  await pool.query(
    `INSERT INTO ride_participants(ride_id, discord_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (ride_id, discord_id)
     DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
    [rideId, discordId, status],
  );
}

export async function participantCounts(rideId: string): Promise<{ going: number; maybe: number }> {
  const result = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM ride_participants
     WHERE ride_id = $1 AND status IN ('going', 'maybe')
     GROUP BY status`,
    [rideId],
  );
  let going = 0;
  let maybe = 0;
  for (const row of result.rows) {
    if (row.status === 'going') going = Number(row.count);
    if (row.status === 'maybe') maybe = Number(row.count);
  }
  return { going, maybe };
}

export async function markAttendance(rideId: string, discordId: string): Promise<void> {
  await pool.query(
    `INSERT INTO ride_participants(ride_id, discord_id, status, attended_at)
     VALUES ($1, $2, 'going', NOW())
     ON CONFLICT (ride_id, discord_id)
     DO UPDATE SET attended_at = NOW(), status = 'going', updated_at = NOW()`,
    [rideId, discordId],
  );
}

export async function getLeaderboard(
  limit = 10,
): Promise<Array<{ display_name: string; rides: string; points: string }>> {
  const result = await pool.query<{
    display_name: string;
    rides: string;
    points: string;
  }>(
    `SELECT u.display_name,
            COUNT(*)::text AS rides,
            (COUNT(*) * 10)::text AS points
     FROM ride_participants rp
     JOIN users u ON u.discord_id = rp.discord_id
     WHERE rp.attended_at IS NOT NULL
     GROUP BY u.discord_id, u.display_name
     ORDER BY COUNT(*) DESC, u.display_name ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}
