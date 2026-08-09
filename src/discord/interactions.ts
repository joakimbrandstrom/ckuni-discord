import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyDiscordSignature } from './signature.js';
import type { DiscordInteraction, DiscordOption, DiscordUser } from './types.js';
import { createScheduledEvent, cancelScheduledEvent } from './api.js';
import { isRideManager } from './auth.js';
import {
  cancelRide,
  createRide,
  getLeaderboard,
  getRide,
  listUpcomingRides,
  participantCounts,
  setDiscordEventId,
  setParticipant,
  upsertUser
} from '../rides/repository.js';
import { parseLocalRideStart } from '../rides/time.js';
import { rideMessage } from '../rides/card.js';
import { createStravaConnectUrl } from '../strava/routes.js';

const EPHEMERAL = 1 << 6;

function response(data: Record<string, unknown>, type = 4): Record<string, unknown> {
  return { type, data };
}

function ephemeral(content: string): Record<string, unknown> {
  return response({ content, flags: EPHEMERAL });
}

function getUser(interaction: DiscordInteraction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function displayName(user: DiscordUser): string {
  return user.global_name || user.username;
}

function findSubcommand(options: DiscordOption[] | undefined): DiscordOption | undefined {
  return options?.find((option) => option.type === 1);
}

function value<T extends string | number>(options: DiscordOption[] | undefined, name: string): T | undefined {
  return options?.find((option) => option.name === name)?.value as T | undefined;
}

function scheduledEventLocation(zwiftUrl: string | undefined, rideType: string): string {
  if (zwiftUrl) return 'Zwift + Discord Voice';
  if (rideType === 'outdoor') return 'CK UNI outdoor ride';
  return 'Discord / Zwift';
}

async function handleCreateRide(
  user: DiscordUser,
  channelId: string,
  sub: DiscordOption
): Promise<Record<string, unknown>> {
  try {
    const title = value<string>(sub.options, 'title')!;
    const date = value<string>(sub.options, 'date')!;
    const time = value<string>(sub.options, 'time')!;
    const duration = value<number>(sub.options, 'duration')!;
    const rideType = value<string>(sub.options, 'type')!;
    const zwiftUrl = value<string>(sub.options, 'zwift_url');
    const description = value<string>(sub.options, 'description');
    const startsAt = parseLocalRideStart(date, time, config.TIMEZONE);
    if (startsAt.getTime() < Date.now() - 60_000) return ephemeral('Ride start time must be in the future.');

    const ride = await createRide({
      title,
      description,
      rideType,
      startsAt,
      durationMinutes: duration,
      zwiftUrl,
      creatorDiscordId: user.id,
      channelId
    });
    await setParticipant(ride.id, user.id, 'going');
    const counts = await participantCounts(ride.id);

    setImmediate(() => {
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      void createScheduledEvent({
        name: title,
        description,
        startsAt,
        endsAt,
        location: scheduledEventLocation(zwiftUrl, rideType)
      })
        .then((eventId) => setDiscordEventId(ride.id, eventId))
        .catch((error) => console.error('Failed to create scheduled event:', error));
    });

    return response(rideMessage(ride, counts, config.TIMEZONE));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create ride';
    return ephemeral(message);
  }
}

async function handleListRides(): Promise<Record<string, unknown>> {
  const rides = await listUpcomingRides();
  if (!rides.length) return ephemeral('No upcoming CK UNI rides found.');
  const lines = rides.map((ride) => {
    const start = new Date(ride.starts_at).toLocaleString('sv-SE', { timeZone: config.TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
    return `**#${ride.id}** — ${ride.title} — ${start}`;
  });
  return ephemeral(`### Upcoming CK UNI rides\n${lines.join('\n')}`);
}

async function handleCancelRide(user: DiscordUser, sub: DiscordOption): Promise<Record<string, unknown>> {
  const id = String(value<number>(sub.options, 'id'));
  const ride = await cancelRide(id, user.id);
  if (!ride) return ephemeral('Ride not found, already cancelled, or you are not the creator.');
  if (ride.discord_event_id) {
    void cancelScheduledEvent(ride.discord_event_id).catch((error) => console.error(error));
  }
  return ephemeral(`Cancelled **${ride.title}** (#${ride.id}).`);
}

async function handleRide(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const user = getUser(interaction);
  if (!user || !interaction.channel_id) return ephemeral('This command must be used inside the CK UNI server.');
  await upsertUser(user.id, displayName(user));

  const sub = findSubcommand(interaction.data?.options);
  if (!sub) return ephemeral('Missing ride subcommand.');

  if (sub.name === 'create') {
    if (!isRideManager(interaction, config.DISCORD_RIDE_LEADER_ROLE_ID, config.DISCORD_ADMIN_ROLE_ID)) {
      return ephemeral('🚫 Only Ride Leaders and Admins can create rides.');
    }
    return handleCreateRide(user, interaction.channel_id, sub);
  }
  if (sub.name === 'list') return handleListRides();
  if (sub.name === 'cancel') {
    if (!isRideManager(interaction, config.DISCORD_RIDE_LEADER_ROLE_ID, config.DISCORD_ADMIN_ROLE_ID)) {
      return ephemeral('🚫 Only Ride Leaders and Admins can cancel rides.');
    }
    return handleCancelRide(user, sub);
  }

  return ephemeral('Unknown ride subcommand.');
}

async function handleButton(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const user = getUser(interaction);
  const customId = interaction.data?.custom_id;
  if (!user || !customId) return ephemeral('Invalid button interaction.');
  const [action, rideId] = customId.split(':');
  if (!rideId || !['ride_join', 'ride_maybe'].includes(action)) return ephemeral('Unknown action.');
  const ride = await getRide(rideId);
  if (ride?.status !== 'scheduled') return ephemeral('This ride is no longer available.');

  await upsertUser(user.id, displayName(user));
  await setParticipant(rideId, user.id, action === 'ride_join' ? 'going' : 'maybe');
  const counts = await participantCounts(rideId);
  return response(rideMessage(ride, counts, config.TIMEZONE), 7);
}

async function handleCommand(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const name = interaction.data?.name;
  if (name === 'ping') return ephemeral('CK UNI Bot is online 🚴');
  if (name === 'ride') return handleRide(interaction);

  const user = getUser(interaction);
  if (!user) return ephemeral('Could not identify Discord user.');
  await upsertUser(user.id, displayName(user));

  if (name === 'strava') {
    const url = createStravaConnectUrl(user.id);
    if (!url) return ephemeral('Strava is not configured on the server yet. Discord rides work without it.');
    return response({
      content: 'Connect your Strava account to CK UNI. This is optional and per-user.',
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [{ type: 2, style: 5, label: 'Connect with Strava', url }]
        }
      ]
    });
  }

  if (name === 'leaderboard') {
    const rows = await getLeaderboard();
    if (!rows.length) return ephemeral('No confirmed CK UNI ride attendance yet.');
    const lines = rows.map((row, i) => `${i + 1}. **${row.display_name}** — ${row.points} pts (${row.rides} rides)`);
    return response({ content: `🏆 **CK UNI participation leaderboard**\n${lines.join('\n')}` });
  }

  return ephemeral('Unknown command.');
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function registerDiscordInteractions(app: FastifyInstance): Promise<void> {
  app.post('/discord/interactions', async (request, reply) => {
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
    const signature = header(request, 'x-signature-ed25519');
    const timestamp = header(request, 'x-signature-timestamp');

    if (!rawBody || !signature || !timestamp) return reply.code(401).send({ error: 'Missing Discord signature' });
    if (!verifyDiscordSignature({ publicKeyHex: config.DISCORD_PUBLIC_KEY, signatureHex: signature, timestamp, rawBody })) {
      return reply.code(401).send({ error: 'Invalid Discord signature' });
    }

    const interaction = request.body as DiscordInteraction;
    if (interaction.type === 1) return reply.send({ type: 1 });
    if (interaction.type === 2) return reply.send(await handleCommand(interaction));
    if (interaction.type === 3) return reply.send(await handleButton(interaction));
    return reply.send(ephemeral('Unsupported interaction type.'));
  });
}
