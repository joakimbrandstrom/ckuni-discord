import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { parseZwiftEventUrl } from '../integrations/zwift/url.js';
import { rideMessage } from '../rides/card.js';
import { parseCreateRideFields, parseTemplateFields } from '../rides/input.js';
import {
  cancelRide,
  createRideTemplate,
  disableRideTemplate,
  getLeaderboard,
  getRide,
  getRideTemplate,
  listRideTemplates,
  listUpcomingRides,
  participantCounts,
  setDiscordEventId,
  setParticipant,
  updateRide,
  updateRideTemplate,
  upsertUser,
} from '../rides/repository.js';
import {
  cancelScheduledEvent,
  createScheduledEvent,
  editChannelMessage,
  editOriginalInteractionResponse,
  updateScheduledEvent,
} from './api.js';
import { isRideManager } from './auth.js';
import { runDiscordBackgroundTask, waitForDiscordBackgroundTasks } from './background.js';
import {
  modalValues,
  RIDE_TYPE_SELECT_OPTIONS,
  stringSelectLabel,
  textInputLabel,
} from './components.js';
import {
  handleRideCreateComponent,
  handleRideCreateModal,
  openRideCreateBuilder,
  openTemplateRideDraft,
} from './ride-create.js';
import { scheduledEventInput } from './ride-publication.js';
import { verifyDiscordSignature } from './signature.js';
import type { DiscordInteraction, DiscordOption, DiscordUser } from './types.js';

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

function value<T extends string | number>(
  options: DiscordOption[] | undefined,
  name: string,
): T | undefined {
  return options?.find((option) => option.name === name)?.value as T | undefined;
}

function detailsValue(input: {
  description?: string | null;
  route_world?: string | null;
  pace_workout?: string | null;
  zwift_url?: string | null;
  notes?: string | null;
  default_weekday?: number | null;
  default_start_time?: string | null;
  quick_create?: boolean;
  sort_order?: number;
}): string | undefined {
  const weekdays = ['', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
  const lines = [
    input.default_weekday && input.default_start_time
      ? `Veckotid: ${weekdays[input.default_weekday]} ${input.default_start_time.slice(0, 5)}`
      : undefined,
    input.quick_create ? `Snabbval: ${input.sort_order ?? 0}` : undefined,
    input.description ? `Beskrivning: ${input.description}` : undefined,
    input.route_world ? `Rutt/värld: ${input.route_world}` : undefined,
    input.pace_workout ? `Tempo/träning: ${input.pace_workout}` : undefined,
    input.zwift_url ? `Zwift: ${input.zwift_url}` : undefined,
    input.notes ? `Anteckningar: ${input.notes}` : undefined,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

function rideModal(
  customId = 'ride_create',
  modalTitle = 'Skapa CK UNI-pass',
  initial?: {
    title: string;
    starts_at: Date;
    duration_minutes: number;
    ride_type: string;
    description?: string | null;
    route_world?: string | null;
    pace_workout?: string | null;
    zwift_url?: string | null;
    notes?: string | null;
  },
): Record<string, unknown> {
  const local = initial
    ? DateTime.fromJSDate(new Date(initial.starts_at), { zone: 'utc' }).setZone(config.TIMEZONE)
    : null;
  return response(
    {
      custom_id: customId,
      title: modalTitle,
      components: [
        textInputLabel('title', 'Titel', {
          placeholder: 'Tisdagens intervaller',
          maxLength: 100,
          value: initial?.title,
        }),
        textInputLabel('date_time', 'Datum och tid', {
          placeholder: 'ÅÅÅÅ-MM-DD TT:mm',
          maxLength: 16,
          value: local?.toFormat('yyyy-MM-dd HH:mm'),
        }),
        textInputLabel('duration', 'Längd i minuter', {
          placeholder: '60',
          maxLength: 3,
          value: initial ? String(initial.duration_minutes) : undefined,
        }),
        stringSelectLabel(
          'ride_type',
          'Typ av pass',
          RIDE_TYPE_SELECT_OPTIONS.map((option) => ({
            ...option,
            default: option.value === initial?.ride_type,
          })),
        ),
        textInputLabel('details', 'Övriga passuppgifter', {
          placeholder:
            'Beskrivning: ...\nRutt/värld: ...\nTempo/träning: ...\nZwift: ...\nAnteckningar: ...',
          required: false,
          style: 2,
          maxLength: 2000,
          value: initial ? detailsValue(initial) : undefined,
        }),
      ],
    },
    9,
  );
}

function templateModal(
  customId: string,
  modalTitle: string,
  initial?: {
    name: string;
    title: string;
    duration_minutes: number;
    ride_type: string;
    description?: string | null;
    route_world?: string | null;
    pace_workout?: string | null;
    notes?: string | null;
    default_weekday?: number | null;
    default_start_time?: string | null;
    quick_create?: boolean;
    sort_order?: number;
  },
): Record<string, unknown> {
  return response(
    {
      custom_id: customId,
      title: modalTitle,
      components: [
        textInputLabel('name', 'Mallnamn', { maxLength: 100, value: initial?.name }),
        textInputLabel('title', 'Passtitel', { maxLength: 100, value: initial?.title }),
        textInputLabel('duration', 'Längd i minuter', {
          maxLength: 3,
          value: initial ? String(initial.duration_minutes) : undefined,
        }),
        stringSelectLabel(
          'ride_type',
          'Typ av pass',
          RIDE_TYPE_SELECT_OPTIONS.map((option) => ({
            ...option,
            default: option.value === initial?.ride_type,
          })),
        ),
        textInputLabel('details', 'Schema, snabbval och detaljer', {
          description: 'Valfritt. Snabbvalets nummer styr ordningen.',
          placeholder: 'Veckotid: tisdag 18:00\nSnabbval: 1\nBeskrivning: ...\nRutt/värld: ...',
          required: false,
          style: 2,
          maxLength: 2000,
          value: initial ? detailsValue(initial) : undefined,
        }),
      ],
    },
    9,
  );
}

function updateInteractionLater(
  interaction: DiscordInteraction,
  work: () => Promise<string>,
): void {
  runDiscordBackgroundTask(async () => {
    await work()
      .then((content) =>
        editOriginalInteractionResponse(interaction.application_id, interaction.token, { content }),
      )
      .catch(async (error) => {
        console.error('Bakgrundsarbete för Discord-interaktion misslyckades:', error);
        try {
          await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
            content:
              'Åtgärden sparades inte fullständigt. Försök igen eller kontakta en administratör.',
          });
        } catch (callbackError) {
          console.error('Kunde inte uppdatera Discord-interaktionen:', callbackError);
        }
      });
  });
}

async function handleListRides(): Promise<Record<string, unknown>> {
  const rides = await listUpcomingRides();
  if (!rides.length) return ephemeral('Det finns inga kommande CK UNI-pass.');
  const lines = rides.map((ride) => {
    const start = new Date(ride.starts_at).toLocaleString('sv-SE', {
      timeZone: config.TIMEZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    });
    return `**#${ride.id}** — ${ride.title} — ${start}`;
  });
  return ephemeral(`### Kommande CK UNI-pass\n${lines.join('\n')}`);
}

async function handleCancelRide(sub: DiscordOption): Promise<Record<string, unknown>> {
  const id = String(value<number>(sub.options, 'id'));
  const ride = await cancelRide(id);
  if (!ride) return ephemeral('Passet hittades inte eller är redan inställt.');
  runDiscordBackgroundTask(async () => {
    try {
      if (ride.discord_message_id) {
        const counts = await participantCounts(ride.id);
        await editChannelMessage(
          ride.discord_channel_id,
          ride.discord_message_id,
          rideMessage(ride, counts, config.TIMEZONE),
        );
      }
      if (ride.discord_event_id) await cancelScheduledEvent(ride.discord_event_id);
    } catch (error) {
      console.error('Kunde inte synka det inställda passet:', error);
    }
  });
  return ephemeral(`**${ride.title}** (#${ride.id}) har ställts in.`);
}

function optionId(sub: DiscordOption): string | null {
  const id = value<number>(sub.options, 'id');
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? String(id) : null;
}

async function openEditRideModal(sub: DiscordOption): Promise<Record<string, unknown>> {
  const id = optionId(sub);
  if (!id) return ephemeral('Ett giltigt pass-ID måste anges.');
  const ride = await getRide(id);
  if (ride?.status !== 'scheduled' || new Date(ride.starts_at).getTime() <= Date.now()) {
    return ephemeral('Passet finns inte eller kan inte längre redigeras.');
  }
  return rideModal(`ride_edit:${id}`, 'Redigera CK UNI-pass', ride);
}

async function syncEditedRide(ride: NonNullable<Awaited<ReturnType<typeof updateRide>>>): Promise<{
  messageUpdated: boolean;
}> {
  const counts = await participantCounts(ride.id);
  let messageUpdated = false;
  if (ride.discord_message_id) {
    await editChannelMessage(
      ride.discord_channel_id,
      ride.discord_message_id,
      rideMessage(ride, counts, config.TIMEZONE),
    );
    messageUpdated = true;
  }

  const eventInput = scheduledEventInput(ride);
  if (ride.discord_event_id) {
    await updateScheduledEvent(ride.discord_event_id, eventInput);
  } else {
    const eventId = await createScheduledEvent(eventInput);
    await setDiscordEventId(ride.id, eventId);
  }
  return { messageUpdated };
}

async function handleEditRideSubmit(
  interaction: DiscordInteraction,
  rideId: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    const parsed = parseCreateRideFields(fields, config.TIMEZONE);
    if (config.ZWIFT_ENABLED && parsed.zwiftUrl) parseZwiftEventUrl(parsed.zwiftUrl);
    const ride = await updateRide(rideId, parsed);
    if (!ride) return ephemeral('Passet finns inte eller kan inte längre redigeras.');
    updateInteractionLater(interaction, async () => {
      const { messageUpdated } = await syncEditedRide(ride);
      const warning = messageUpdated
        ? ''
        : ' Passet är äldre och saknar ett sparat meddelande-ID, så passkortet kunde inte uppdateras.';
      return `Passet **${ride.title}** (#${ride.id}) har uppdaterats.${warning}`;
    });
    return ephemeral(
      `Ändringarna för **${ride.title}** (#${ride.id}) har sparats och publiceras …`,
    );
  } catch (error) {
    return ephemeral(error instanceof Error ? error.message : 'Kunde inte uppdatera passet.');
  }
}

async function handleTemplateList(): Promise<Record<string, unknown>> {
  const templates = await listRideTemplates();
  if (!templates.length) return ephemeral('Det finns inga sparade passmallar.');
  const weekdays = ['', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'];
  const lines = templates.map((template) => {
    const schedule =
      template.default_weekday && template.default_start_time
        ? ` · ${weekdays[template.default_weekday]} ${template.default_start_time.slice(0, 5)}`
        : '';
    const quick = template.quick_create ? ` · snabbval ${template.sort_order}` : '';
    return `**#${template.id}** · ${template.name} · ${template.title} (${template.duration_minutes} min)${schedule}${quick}${template.active ? '' : ' · inaktiverad'}`;
  });
  return ephemeral(`### Passmallar\n${lines.join('\n')}`);
}

async function openTemplateEditModal(sub: DiscordOption): Promise<Record<string, unknown>> {
  const id = optionId(sub);
  if (!id) return ephemeral('Ett giltigt mall-ID måste anges.');
  const template = await getRideTemplate(id);
  if (!template) return ephemeral('Mallen hittades inte.');
  return templateModal(`template_edit:${id}`, 'Redigera passmall', template);
}

async function handleDisableTemplate(sub: DiscordOption): Promise<Record<string, unknown>> {
  const id = optionId(sub);
  if (!id) return ephemeral('Ett giltigt mall-ID måste anges.');
  const template = await disableRideTemplate(id);
  if (!template) return ephemeral('Mallen hittades inte eller är redan inaktiverad.');
  return ephemeral(`Mallen **${template.name}** (#${template.id}) har inaktiverats.`);
}

async function handleTemplateSubmit(
  customId: string,
  user: DiscordUser,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    const parsed = parseTemplateFields(fields);
    if (customId === 'template_save') {
      const template = await createRideTemplate({ ...parsed, creatorDiscordId: user.id });
      return ephemeral(`Mallen **${template.name}** (#${template.id}) har sparats.`);
    }
    const templateId = customId.split(':')[1];
    const template = templateId ? await updateRideTemplate(templateId, parsed) : null;
    if (!template) return ephemeral('Mallen hittades inte.');
    return ephemeral(`Mallen **${template.name}** (#${template.id}) har uppdaterats.`);
  } catch (error) {
    const databaseError = error as { code?: string };
    if (databaseError.code === '23505') return ephemeral('Det finns redan en mall med det namnet.');
    return ephemeral(error instanceof Error ? error.message : 'Kunde inte spara mallen.');
  }
}

async function handleRide(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const user = getUser(interaction);
  if (!user || !interaction.channel_id)
    return ephemeral('Kommandot måste användas på CK UNI-servern.');
  await upsertUser(user.id, displayName(user));

  const sub = findSubcommand(interaction.data?.options);
  if (!sub) return ephemeral('Underkommando för pass saknas.');

  if (sub.name === 'create') {
    if (
      !isRideManager(interaction, config.DISCORD_RIDE_LEADER_ROLE_ID, config.DISCORD_ADMIN_ROLE_ID)
    ) {
      return ephemeral('🚫 Endast ledare och administratörer kan skapa pass.');
    }
    return openRideCreateBuilder();
  }
  if (sub.name === 'list') return handleListRides();
  if (
    !isRideManager(interaction, config.DISCORD_RIDE_LEADER_ROLE_ID, config.DISCORD_ADMIN_ROLE_ID)
  ) {
    return ephemeral('🚫 Endast ledare och administratörer kan hantera pass och mallar.');
  }

  if (sub.name === 'edit') return openEditRideModal(sub);
  if (sub.name === 'cancel') return handleCancelRide(sub);
  if (sub.name === 'mall-spara') return templateModal('template_save', 'Spara passmall');
  if (sub.name === 'mall-lista') return handleTemplateList();
  if (sub.name === 'mall-skapa') {
    const id = optionId(sub);
    if (!id) return ephemeral('Ett giltigt mall-ID måste anges.');
    return openTemplateRideDraft(user, interaction.channel_id, id);
  }
  if (sub.name === 'mall-redigera') return openTemplateEditModal(sub);
  if (sub.name === 'mall-inaktivera') return handleDisableTemplate(sub);

  return ephemeral('Okänt underkommando för pass.');
}

async function handleModal(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const user = getUser(interaction);
  if (!user || !interaction.channel_id)
    return ephemeral('Formuläret måste användas på CK UNI-servern.');
  if (
    !isRideManager(interaction, config.DISCORD_RIDE_LEADER_ROLE_ID, config.DISCORD_ADMIN_ROLE_ID)
  ) {
    return ephemeral('🚫 Endast ledare och administratörer kan skapa pass.');
  }
  await upsertUser(user.id, displayName(user));
  const customId = interaction.data?.custom_id;
  const createResponse = await handleRideCreateModal(interaction);
  if (createResponse) return createResponse;
  const fields = modalValues(interaction);
  if (customId?.startsWith('ride_edit:')) {
    return handleEditRideSubmit(interaction, customId.split(':')[1], fields);
  }
  if (customId === 'template_save' || customId?.startsWith('template_edit:')) {
    return handleTemplateSubmit(customId, user, fields);
  }
  return ephemeral('Okänt formulär.');
}

async function handleButton(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const createResponse = await handleRideCreateComponent(interaction);
  if (createResponse) return createResponse;
  const user = getUser(interaction);
  const customId = interaction.data?.custom_id;
  if (!user || !customId) return ephemeral('Ogiltig knapptryckning.');
  const [action, rideId] = customId.split(':');
  if (!rideId || !['ride_join', 'ride_maybe'].includes(action)) return ephemeral('Okänd åtgärd.');
  const ride = await getRide(rideId);
  if (ride?.status !== 'scheduled') return ephemeral('Passet är inte längre tillgängligt.');

  await upsertUser(user.id, displayName(user));
  await setParticipant(rideId, user.id, action === 'ride_join' ? 'going' : 'maybe');
  const counts = await participantCounts(rideId);
  return response(rideMessage(ride, counts, config.TIMEZONE), 7);
}

async function handleCommand(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const name = interaction.data?.name;
  if (name === 'ping') return ephemeral('CK UNI-boten är online 🚴');
  if (name === 'ride') return handleRide(interaction);

  const user = getUser(interaction);
  if (!user) return ephemeral('Kunde inte identifiera Discord-användaren.');
  await upsertUser(user.id, displayName(user));

  if (name === 'leaderboard') {
    const rows = await getLeaderboard();
    if (!rows.length) return ephemeral('Det finns inget bekräftat deltagande på CK UNI-pass ännu.');
    const lines = rows.map(
      (row, i) => `${i + 1}. **${row.display_name}** — ${row.points} poäng (${row.rides} pass)`,
    );
    return response({
      content: `🏆 **CK UNI:s deltagartabell**\n${lines.join('\n')}`,
    });
  }

  return ephemeral('Okänt kommando.');
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function registerDiscordInteractions(app: FastifyInstance): Promise<void> {
  app.addHook('onClose', waitForDiscordBackgroundTasks);
  app.post('/discord/interactions', async (request, reply) => {
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
    const signature = header(request, 'x-signature-ed25519');
    const timestamp = header(request, 'x-signature-timestamp');

    if (!rawBody || !signature || !timestamp)
      return reply.code(401).send({ error: 'Missing Discord signature' });
    if (
      !verifyDiscordSignature({
        publicKeyHex: config.DISCORD_PUBLIC_KEY,
        signatureHex: signature,
        timestamp,
        rawBody,
      })
    ) {
      return reply.code(401).send({ error: 'Invalid Discord signature' });
    }

    const interaction = request.body as DiscordInteraction;
    if (interaction.type === 1) return reply.send({ type: 1 });
    if (interaction.type === 2) return reply.send(await handleCommand(interaction));
    if (interaction.type === 3) return reply.send(await handleButton(interaction));
    if (interaction.type === 5) return reply.send(await handleModal(interaction));
    return reply.send(ephemeral('Interaktionstypen stöds inte.'));
  });
}
