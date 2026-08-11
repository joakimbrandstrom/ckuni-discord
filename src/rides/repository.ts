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
  discord_message_id: string | null;
  route_world: string | null;
  pace_workout: string | null;
  notes: string | null;
  template_id: string | null;
  status: string;
};

export type RideTemplate = {
  id: string;
  name: string;
  title: string;
  description: string | null;
  ride_type: string;
  duration_minutes: number;
  route_world: string | null;
  pace_workout: string | null;
  notes: string | null;
  creator_discord_id: string;
  active: boolean;
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
  routeWorld?: string;
  paceWorkout?: string;
  notes?: string;
  templateId?: string;
}): Promise<Ride> {
  const result = await pool.query<Ride>(
    `INSERT INTO rides(
       title, description, ride_type, starts_at, duration_minutes, zwift_url,
       creator_discord_id, discord_channel_id, route_world, pace_workout, notes, template_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      input.routeWorld ?? null,
      input.paceWorkout ?? null,
      input.notes ?? null,
      input.templateId ?? null,
    ],
  );
  return result.rows[0];
}

export async function setDiscordEventId(rideId: string, eventId: string): Promise<void> {
  await pool.query('UPDATE rides SET discord_event_id = $2 WHERE id = $1', [rideId, eventId]);
}

export async function setDiscordMessageId(rideId: string, messageId: string): Promise<void> {
  await pool.query('UPDATE rides SET discord_message_id = $2 WHERE id = $1', [rideId, messageId]);
}

export async function updateRide(
  rideId: string,
  input: {
    title: string;
    description?: string;
    rideType: string;
    startsAt: Date;
    durationMinutes: number;
    zwiftUrl?: string;
    routeWorld?: string;
    paceWorkout?: string;
    notes?: string;
  },
): Promise<Ride | null> {
  const result = await pool.query<Ride>(
    `UPDATE rides SET
       title=$2, description=$3, ride_type=$4, starts_at=$5, duration_minutes=$6,
       zwift_url=$7, route_world=$8, pace_workout=$9, notes=$10
     WHERE id=$1 AND status='scheduled' AND starts_at > NOW()
     RETURNING *`,
    [
      rideId,
      input.title,
      input.description ?? null,
      input.rideType,
      input.startsAt,
      input.durationMinutes,
      input.zwiftUrl ?? null,
      input.routeWorld ?? null,
      input.paceWorkout ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function createRideTemplate(input: {
  name: string;
  title: string;
  description?: string;
  rideType: string;
  durationMinutes: number;
  routeWorld?: string;
  paceWorkout?: string;
  notes?: string;
  creatorDiscordId: string;
}): Promise<RideTemplate> {
  const result = await pool.query<RideTemplate>(
    `INSERT INTO ride_templates(
       name, title, description, ride_type, duration_minutes, route_world,
       pace_workout, notes, creator_discord_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      input.name,
      input.title,
      input.description ?? null,
      input.rideType,
      input.durationMinutes,
      input.routeWorld ?? null,
      input.paceWorkout ?? null,
      input.notes ?? null,
      input.creatorDiscordId,
    ],
  );
  return result.rows[0];
}

export async function getRideTemplate(templateId: string): Promise<RideTemplate | null> {
  const result = await pool.query<RideTemplate>('SELECT * FROM ride_templates WHERE id=$1', [
    templateId,
  ]);
  return result.rows[0] ?? null;
}

export async function listRideTemplates(): Promise<RideTemplate[]> {
  const result = await pool.query<RideTemplate>(
    'SELECT * FROM ride_templates ORDER BY active DESC, name ASC',
  );
  return result.rows;
}

export async function updateRideTemplate(
  templateId: string,
  input: {
    name: string;
    title: string;
    description?: string;
    rideType: string;
    durationMinutes: number;
    routeWorld?: string;
    paceWorkout?: string;
    notes?: string;
  },
): Promise<RideTemplate | null> {
  const result = await pool.query<RideTemplate>(
    `UPDATE ride_templates SET name=$2, title=$3, description=$4, ride_type=$5,
       duration_minutes=$6, route_world=$7, pace_workout=$8, notes=$9, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      templateId,
      input.name,
      input.title,
      input.description ?? null,
      input.rideType,
      input.durationMinutes,
      input.routeWorld ?? null,
      input.paceWorkout ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function disableRideTemplate(templateId: string): Promise<RideTemplate | null> {
  const result = await pool.query<RideTemplate>(
    'UPDATE ride_templates SET active=FALSE, updated_at=NOW() WHERE id=$1 AND active=TRUE RETURNING *',
    [templateId],
  );
  return result.rows[0] ?? null;
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

export async function cancelRide(rideId: string): Promise<Ride | null> {
  const result = await pool.query<Ride>(
    `UPDATE rides SET status = 'cancelled'
     WHERE id = $1 AND status = 'scheduled'
     RETURNING *`,
    [rideId],
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
