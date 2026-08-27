import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { Ride } from './repository.js';

export type RideDraft = {
  id: string;
  owner_discord_id: string;
  source_template_id: string | null;
  source_ride_id: string | null;
  published_ride_id: string | null;
  discord_channel_id: string;
  title: string | null;
  description: string | null;
  ride_type: string | null;
  starts_at: Date | null;
  duration_minutes: number | null;
  zwift_url: string | null;
  route_world: string | null;
  pace_workout: string | null;
  notes: string | null;
  extra_comment: string | null;
  status: 'active' | 'publishing' | 'published' | 'cancelled' | 'expired';
  publication_error: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
};

export class RideDraftError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'expired' | 'cancelled' | 'incomplete' | 'template_inactive',
  ) {
    super(message);
  }
}

export async function cleanupRideDrafts(): Promise<void> {
  await pool.query(
    `UPDATE ride_drafts
     SET status='expired', updated_at=NOW()
     WHERE status='active' AND expires_at <= NOW()`,
  );
  await pool.query(
    `UPDATE ride_drafts d
     SET status='expired', updated_at=NOW()
     FROM rides r
     WHERE d.status='publishing' AND r.id=d.published_ride_id AND r.starts_at <= NOW()`,
  );
  await pool.query(
    `DELETE FROM ride_drafts
     WHERE status IN ('cancelled', 'expired') AND updated_at < NOW() - INTERVAL '30 days'`,
  );
}

export async function createEmptyRideDraft(
  ownerDiscordId: string,
  channelId: string,
): Promise<RideDraft> {
  const result = await pool.query<RideDraft>(
    `INSERT INTO ride_drafts(owner_discord_id, discord_channel_id)
     VALUES ($1, $2)
     RETURNING *`,
    [ownerDiscordId, channelId],
  );
  return result.rows[0];
}

export async function createRideDraftFromTemplate(
  ownerDiscordId: string,
  templateId: string,
  channelId: string,
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `INSERT INTO ride_drafts(
       owner_discord_id, source_template_id, discord_channel_id, title, description,
       ride_type, duration_minutes, route_world, pace_workout, notes
     )
     SELECT $1, id, $3, title, description, ride_type, duration_minutes,
            route_world, pace_workout, notes
     FROM ride_templates
     WHERE id=$2 AND active=TRUE
     RETURNING *`,
    [ownerDiscordId, templateId, channelId],
  );
  return result.rows[0] ?? null;
}

export async function createRideDraftFromLatestRide(
  ownerDiscordId: string,
  channelId: string,
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `INSERT INTO ride_drafts(
       owner_discord_id, source_ride_id, discord_channel_id,
       title, description, ride_type, duration_minutes, route_world, pace_workout, notes
     )
     SELECT $1, id, $2, title, description, ride_type, duration_minutes,
            route_world, pace_workout, notes
     FROM rides
     WHERE creator_discord_id=$1
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     RETURNING *`,
    [ownerDiscordId, channelId],
  );
  return result.rows[0] ?? null;
}

export async function getRideDraft(
  draftId: string,
  ownerDiscordId: string,
): Promise<RideDraft | null> {
  await pool.query(
    `UPDATE ride_drafts SET status='expired', updated_at=NOW()
     WHERE id=$1 AND status='active' AND expires_at <= NOW()`,
    [draftId],
  );
  const result = await pool.query<RideDraft>(
    'SELECT * FROM ride_drafts WHERE id=$1 AND owner_discord_id=$2',
    [draftId, ownerDiscordId],
  );
  return result.rows[0] ?? null;
}

export async function updateRideDraftBasic(
  draftId: string,
  ownerDiscordId: string,
  input: { title: string; startsAt: Date; durationMinutes: number; rideType: string },
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `UPDATE ride_drafts SET
       title=$3, starts_at=$4, duration_minutes=$5, ride_type=$6, updated_at=NOW()
     WHERE id=$1 AND owner_discord_id=$2 AND status='active' AND expires_at > NOW()
     RETURNING *`,
    [draftId, ownerDiscordId, input.title, input.startsAt, input.durationMinutes, input.rideType],
  );
  return result.rows[0] ?? null;
}

export async function updateRideDraftSchedule(
  draftId: string,
  ownerDiscordId: string,
  input: { startsAt: Date; zwiftUrl?: string; extraComment?: string },
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `UPDATE ride_drafts SET
       starts_at=$3, zwift_url=$4, extra_comment=$5, updated_at=NOW()
     WHERE id=$1 AND owner_discord_id=$2 AND status='active' AND expires_at > NOW()
     RETURNING *`,
    [draftId, ownerDiscordId, input.startsAt, input.zwiftUrl ?? null, input.extraComment ?? null],
  );
  return result.rows[0] ?? null;
}

export async function updateRideDraftDetails(
  draftId: string,
  ownerDiscordId: string,
  input: {
    description?: string;
    zwiftUrl?: string;
    routeWorld?: string;
    paceWorkout?: string;
    notes?: string;
  },
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `UPDATE ride_drafts SET
       description=$3, zwift_url=$4, route_world=$5, pace_workout=$6, notes=$7,
       updated_at=NOW()
     WHERE id=$1 AND owner_discord_id=$2 AND status='active' AND expires_at > NOW()
     RETURNING *`,
    [
      draftId,
      ownerDiscordId,
      input.description ?? null,
      input.zwiftUrl ?? null,
      input.routeWorld ?? null,
      input.paceWorkout ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function cancelRideDraft(
  draftId: string,
  ownerDiscordId: string,
): Promise<RideDraft | null> {
  const result = await pool.query<RideDraft>(
    `UPDATE ride_drafts SET status='cancelled', updated_at=NOW()
     WHERE id=$1 AND owner_discord_id=$2 AND status='active'
     RETURNING *`,
    [draftId, ownerDiscordId],
  );
  return result.rows[0] ?? null;
}

export async function prepareRideDraftPublication(
  draftId: string,
  ownerDiscordId: string,
): Promise<{ draft: RideDraft; ride: Ride }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<RideDraft>(
      'SELECT * FROM ride_drafts WHERE id=$1 AND owner_discord_id=$2 FOR UPDATE',
      [draftId, ownerDiscordId],
    );
    const draft = result.rows[0];
    if (!draft) throw new RideDraftError('Utkastet hittades inte.', 'not_found');
    if (draft.status === 'cancelled') {
      throw new RideDraftError('Utkastet har avbrutits.', 'cancelled');
    }
    if (draft.published_ride_id) {
      const existing = await client.query<Ride>('SELECT * FROM rides WHERE id=$1', [
        draft.published_ride_id,
      ]);
      if (!existing.rows[0])
        throw new RideDraftError('Det publicerade passet saknas.', 'not_found');
      if (new Date(existing.rows[0].starts_at).getTime() <= Date.now()) {
        throw new RideDraftError('Starttiden måste fortfarande ligga i framtiden.', 'expired');
      }
      await client.query('COMMIT');
      return { draft, ride: existing.rows[0] };
    }
    if (draft.status === 'expired' || new Date(draft.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE ride_drafts SET status='expired', updated_at=NOW() WHERE id=$1", [
        draftId,
      ]);
      throw new RideDraftError('Utkastet har gått ut. Kör /ride create igen.', 'expired');
    }

    if (
      !draft.title ||
      !draft.starts_at ||
      !draft.duration_minutes ||
      !draft.ride_type ||
      new Date(draft.starts_at).getTime() <= Date.now()
    ) {
      throw new RideDraftError(
        draft.starts_at && new Date(draft.starts_at).getTime() <= Date.now()
          ? 'Starttiden måste fortfarande ligga i framtiden.'
          : 'Utkastet saknar obligatoriska grunduppgifter.',
        'incomplete',
      );
    }
    if (draft.source_template_id) {
      const template = await client.query(
        'SELECT 1 FROM ride_templates WHERE id=$1 AND active=TRUE',
        [draft.source_template_id],
      );
      if (!template.rowCount) {
        throw new RideDraftError('Mallen är inte längre aktiv.', 'template_inactive');
      }
    }

    const notes = [draft.notes, draft.extra_comment].filter(Boolean).join('\n') || null;
    const rideResult = await client.query<Ride>(
      `INSERT INTO rides(
         title, description, ride_type, starts_at, duration_minutes, zwift_url,
         creator_discord_id, discord_channel_id, route_world, pace_workout, notes,
         template_id, creation_draft_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        draft.title,
        draft.description,
        draft.ride_type,
        draft.starts_at,
        draft.duration_minutes,
        draft.zwift_url,
        ownerDiscordId,
        draft.discord_channel_id,
        draft.route_world,
        draft.pace_workout,
        notes,
        draft.source_template_id,
        draft.id,
      ],
    );
    const ride = rideResult.rows[0];
    await client.query(
      `INSERT INTO ride_participants(ride_id, discord_id, status)
       VALUES ($1, $2, 'going')
       ON CONFLICT (ride_id, discord_id)
       DO UPDATE SET status='going', updated_at=NOW()`,
      [ride.id, ownerDiscordId],
    );
    const draftResult = await client.query<RideDraft>(
      `UPDATE ride_drafts SET status='publishing', published_ride_id=$2,
         publication_error=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [draft.id, ride.id],
    );
    await client.query('COMMIT');
    return { draft: draftResult.rows[0], ride };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof RideDraftError && error.code === 'expired') {
      await client.query(
        "UPDATE ride_drafts SET status='expired', updated_at=NOW() WHERE id=$1 AND owner_discord_id=$2",
        [draftId, ownerDiscordId],
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withRideDraftPublicationLock<T>(
  draftId: string,
  ownerDiscordId: string,
  work: (client: PoolClient, draft: RideDraft, ride: Ride) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      `ride-draft:${draftId}`,
    ]);
    const result = await client.query<RideDraft & Ride>(
      `SELECT d.*, r.id AS ride_id
       FROM ride_drafts d
       JOIN rides r ON r.id=d.published_ride_id
       WHERE d.id=$1 AND d.owner_discord_id=$2`,
      [draftId, ownerDiscordId],
    );
    const draft = result.rows[0] as RideDraft | undefined;
    if (!draft?.published_ride_id) throw new RideDraftError('Utkastet hittades inte.', 'not_found');
    const rideResult = await client.query<Ride>('SELECT * FROM rides WHERE id=$1', [
      draft.published_ride_id,
    ]);
    return await work(client, draft, rideResult.rows[0]);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
      `ride-draft:${draftId}`,
    ]);
    client.release();
  }
}

export async function recordRideDraftPublicationError(
  draftId: string,
  ownerDiscordId: string,
  error: string,
): Promise<void> {
  await pool.query(
    `UPDATE ride_drafts SET publication_error=$3, updated_at=NOW()
     WHERE id=$1 AND owner_discord_id=$2 AND status='publishing'`,
    [draftId, ownerDiscordId, error.slice(0, 2000)],
  );
}
