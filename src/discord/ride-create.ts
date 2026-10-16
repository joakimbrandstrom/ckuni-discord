import { DateTime } from 'luxon';
import { config } from '../config.js';
import { zwiftEventPreview } from '../integrations/zwift/event-preview.js';
import { zwift } from '../integrations/zwift/runtime.js';
import { rideMessage, ridePreviewEmbed } from '../rides/card.js';
import {
  cancelRideDraft,
  cleanupRideDrafts,
  createEmptyRideDraft,
  createRideDraftFromLatestRide,
  createRideDraftFromTemplate,
  getRideDraft,
  prepareRideDraftPublication,
  type RideDraft,
  recordRideDraftPublicationError,
  updateRideDraftBasic,
  updateRideDraftDetails,
  updateRideDraftSchedule,
  withRideDraftPublicationLock,
} from '../rides/drafts.js';
import {
  normalizeZwiftRideUrl,
  parseRideBasicFields,
  parseRideDetailFields,
  parseRideScheduleFields,
} from '../rides/input.js';
import { listActiveRideTemplates, participantCounts, upsertUser } from '../rides/repository.js';
import {
  createScheduledEvent,
  editOriginalInteractionResponse,
  findScheduledEventByDescriptionMarker,
  sendChannelMessage,
} from './api.js';
import { isRideManager } from './auth.js';
import { runDiscordBackgroundTask } from './background.js';
import {
  ComponentType,
  modalValues,
  RIDE_TYPE_SELECT_OPTIONS,
  stringSelectLabel,
  textInputLabel,
} from './components.js';
import { scheduledEventInput, scheduledEventMarker } from './ride-publication.js';
import type { DiscordInteraction, DiscordUser } from './types.js';

const EPHEMERAL = 1 << 6;
function response(data: Record<string, unknown>, type = 4): Record<string, unknown> {
  return { type, data };
}

function ephemeral(content: string): Record<string, unknown> {
  return response({ content, flags: EPHEMERAL });
}

function userFrom(interaction: DiscordInteraction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function displayName(user: DiscordUser): string {
  return user.global_name || user.username;
}

function isAuthorized(interaction: DiscordInteraction): boolean {
  return isRideManager(
    interaction,
    config.DISCORD_RIDE_LEADER_ROLE_ID,
    config.DISCORD_ADMIN_ROLE_ID,
  );
}

function localStart(draft: RideDraft): DateTime | null {
  return draft.starts_at
    ? DateTime.fromJSDate(new Date(draft.starts_at), { zone: 'utc' }).setZone(config.TIMEZONE)
    : null;
}

function modal(customId: string, title: string, components: unknown[]): Record<string, unknown> {
  return response({ custom_id: customId, title, components }, 9);
}

function basicModal(draft: RideDraft): Record<string, unknown> {
  const local = localStart(draft);
  return modal(`ride_draft_basic:${draft.id}`, 'Grunduppgifter', [
    textInputLabel('title', 'Titel', {
      placeholder: 'Tisdagens intervaller',
      maxLength: 100,
      value: draft.title ?? undefined,
    }),
    textInputLabel('date', 'Datum', {
      description: 'Datum i svensk tid, exempel 2026-09-15',
      placeholder: 'ÅÅÅÅ-MM-DD',
      maxLength: 10,
      value: local?.toFormat('yyyy-MM-dd'),
    }),
    textInputLabel('time', 'Tid', {
      description: `Starttid i ${config.TIMEZONE}, exempel 18:30`,
      placeholder: 'TT:mm',
      maxLength: 5,
      value: local?.toFormat('HH:mm'),
    }),
    textInputLabel('duration', 'Längd i minuter', {
      placeholder: '60',
      maxLength: 3,
      value: draft.duration_minutes ? String(draft.duration_minutes) : undefined,
    }),
    stringSelectLabel(
      'ride_type',
      'Passtyp',
      RIDE_TYPE_SELECT_OPTIONS.map((option) => ({
        ...option,
        default: option.value === draft.ride_type,
      })),
    ),
  ]);
}

function scheduleModal(draft: RideDraft, title: string): Record<string, unknown> {
  const local = localStart(draft);
  return modal(`ride_draft_schedule:${draft.id}`, title.slice(0, 45), [
    textInputLabel('zwift_url', 'Zwift-länk (valfri)', {
      placeholder: 'https://www.zwift.com/events/...',
      required: false,
      maxLength: 500,
      value: draft.zwift_url ?? undefined,
    }),
    textInputLabel('date', 'Datum', {
      placeholder: 'ÅÅÅÅ-MM-DD',
      maxLength: 10,
      value: local?.toFormat('yyyy-MM-dd'),
    }),
    textInputLabel('time', 'Tid', {
      description: config.TIMEZONE,
      placeholder: 'TT:mm',
      maxLength: 5,
      value: local?.toFormat('HH:mm'),
    }),
    textInputLabel('extra_comment', 'Extra kommentar (valfri)', {
      required: false,
      style: 2,
      maxLength: 1000,
      value: draft.extra_comment ?? undefined,
    }),
  ]);
}

function detailsModal(draft: RideDraft): Record<string, unknown> {
  return modal(`ride_draft_details:${draft.id}`, 'Passdetaljer', [
    textInputLabel('zwift_url', 'Zwift-länk', {
      placeholder: 'https://www.zwift.com/events/...',
      required: false,
      maxLength: 500,
      value: draft.zwift_url ?? undefined,
    }),
    textInputLabel('description', 'Beskrivning', {
      required: false,
      style: 2,
      maxLength: 2000,
      value: draft.description ?? undefined,
    }),
    textInputLabel('route_world', 'Rutt/värld', {
      placeholder: 'Watopia, Tempus Fugit',
      required: false,
      maxLength: 200,
      value: draft.route_world ?? undefined,
    }),
    textInputLabel('pace_workout', 'Tempo/träningsupplägg', {
      placeholder: '2,5 W/kg eller 4 x 8 minuter',
      required: false,
      maxLength: 500,
      value: draft.pace_workout ?? undefined,
    }),
    textInputLabel('notes', 'Anteckningar', {
      required: false,
      style: 2,
      maxLength: 1000,
      value: draft.notes ?? undefined,
    }),
  ]);
}

async function previewData(draft: RideDraft, flags = false): Promise<Record<string, unknown>> {
  if (!draft.title || !draft.starts_at || !draft.duration_minutes || !draft.ride_type) {
    return { content: 'Utkastet saknar grunduppgifter.', ...(flags ? { flags: EPHEMERAL } : {}) };
  }
  const hasDetails = Boolean(
    draft.zwift_url ||
      draft.description ||
      draft.route_world ||
      draft.pace_workout ||
      draft.notes ||
      draft.extra_comment,
  );
  const eventPreview = await zwiftEventPreview(draft.zwift_url, draft, zwift, config.TIMEZONE);
  return {
    content: `**Förhandsvisning**\nPasset publiceras i <#${draft.discord_channel_id}> först när du väljer **Publicera**.`,
    embeds: [
      ridePreviewEmbed(
        {
          title: draft.title,
          description: draft.description,
          ride_type: draft.ride_type,
          starts_at: draft.starts_at,
          duration_minutes: draft.duration_minutes,
          zwift_url: draft.zwift_url,
          route_world: draft.route_world,
          pace_workout: draft.pace_workout,
          notes:
            [draft.notes, draft.extra_comment ? `Extra kommentar: ${draft.extra_comment}` : null]
              .filter(Boolean)
              .join('\n') || null,
        },
        config.TIMEZONE,
      ),
      ...(eventPreview ? [eventPreview] : []),
    ],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: 3,
            label: 'Publicera',
            custom_id: `ride_draft_publish:${draft.id}`,
          },
          {
            type: ComponentType.Button,
            style: 2,
            label: 'Redigera grunduppgifter',
            custom_id: `ride_draft_edit_basic:${draft.id}`,
          },
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: 2,
            label: hasDetails ? 'Redigera detaljer' : 'Lägg till detaljer',
            custom_id: `ride_draft_edit_details:${draft.id}`,
          },
          {
            type: ComponentType.Button,
            style: 4,
            label: 'Avbryt',
            custom_id: `ride_draft_cancel:${draft.id}`,
          },
        ],
      },
    ],
    ...(flags ? { flags: EPHEMERAL } : {}),
  };
}

function draftUnavailable(draft: RideDraft | null): Record<string, unknown> | null {
  if (!draft) return ephemeral('Utkastet hittades inte eller tillhör en annan användare.');
  if (draft.status === 'expired')
    return ephemeral('Utkastet har gått ut. Kör `/ride create` igen.');
  if (draft.status === 'cancelled') return ephemeral('Utkastet har avbrutits.');
  if (draft.status !== 'active') return ephemeral('Passet håller redan på att publiceras.');
  return null;
}

export async function openRideCreateBuilder(
  requestedPage = 0,
  responseType = 4,
): Promise<Record<string, unknown>> {
  await cleanupRideDrafts();
  const templates = await listActiveRideTemplates();
  const quickTemplates = templates.filter((template) => template.quick_create).slice(0, 3);
  const quickIds = new Set(quickTemplates.map((template) => template.id));
  const otherTemplates = templates.filter((template) => !quickIds.has(template.id));
  const pageCount = Math.max(1, Math.ceil(otherTemplates.length / 25));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const visibleTemplates = otherTemplates.slice(page * 25, (page + 1) * 25);
  const components: Array<Record<string, unknown>> = [];
  if (quickTemplates.length) {
    components.push({
      type: ComponentType.ActionRow,
      components: quickTemplates.map((template) => ({
        type: ComponentType.Button,
        style: 1,
        label: template.name.slice(0, 80),
        custom_id: `ride_create_quick:${template.id}`,
      })),
    });
  }
  if (visibleTemplates.length) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: 'ride_create_template',
          placeholder: 'Andra mallar',
          options: visibleTemplates.map((template) => ({
            label: template.name.slice(0, 100),
            value: template.id,
            description: `${template.title} · ${template.duration_minutes} min`.slice(0, 100),
          })),
        },
      ],
    });
  }
  const buttons: Array<Record<string, unknown>> = [
    {
      type: ComponentType.Button,
      style: 2,
      label: 'Kopiera senaste',
      custom_id: 'ride_create_copy',
    },
    {
      type: ComponentType.Button,
      style: 1,
      label: 'Skapa nytt pass',
      custom_id: 'ride_create_new',
    },
    {
      type: ComponentType.Button,
      style: 4,
      label: 'Avbryt',
      custom_id: 'ride_create_cancel',
    },
  ];
  components.push({
    type: ComponentType.ActionRow,
    components: buttons,
  });
  const paginationButtons: Array<Record<string, unknown>> = [];
  if (page > 0) {
    paginationButtons.push({
      type: ComponentType.Button,
      style: 2,
      label: 'Föregående mallar',
      custom_id: `ride_create_templates:${page - 1}`,
    });
  }
  if (page + 1 < pageCount) {
    paginationButtons.push({
      type: ComponentType.Button,
      style: 2,
      label: 'Fler mallar',
      custom_id: `ride_create_templates:${page + 1}`,
    });
  }
  if (paginationButtons.length) {
    components.push({ type: ComponentType.ActionRow, components: paginationButtons });
  }
  return response(
    {
      content: templates.length
        ? `**Skapa CK UNI-pass**${pageCount > 1 ? ` · mallsida ${page + 1}/${pageCount}` : ''}`
        : '**Skapa CK UNI-pass**\nIngen aktiv mall finns ännu.',
      components,
      ...(responseType === 4 ? { flags: EPHEMERAL } : {}),
    },
    responseType,
  );
}

export async function openTemplateRideDraft(
  user: DiscordUser,
  channelId: string,
  templateId: string,
): Promise<Record<string, unknown>> {
  const draft = await createRideDraftFromTemplate(user.id, templateId, channelId, config.TIMEZONE);
  if (!draft) return ephemeral('Mallen finns inte eller är inaktiverad.');
  return scheduleModal(draft, `Skapa ${draft.title ?? 'pass'}`);
}

async function publishDraftLater(
  interaction: DiscordInteraction,
  draftId: string,
  userId: string,
): Promise<void> {
  try {
    const ride = await withRideDraftPublicationLock(
      draftId,
      userId,
      async (client, draft, ride) => {
        if (!ride.discord_message_id) {
          const counts = await participantCounts(ride.id);
          const messageId = await sendChannelMessage(
            ride.discord_channel_id,
            rideMessage(ride, counts, config.TIMEZONE),
            `ckuni-ride-${ride.id}`.slice(0, 25),
          );
          if (!messageId) throw new Error('Discord returnerade inget meddelande-ID.');
          await client.query('UPDATE rides SET discord_message_id=$2 WHERE id=$1', [
            ride.id,
            messageId,
          ]);
          ride.discord_message_id = messageId;
        }
        if (!ride.discord_event_id) {
          const eventId =
            (await findScheduledEventByDescriptionMarker(scheduledEventMarker(ride.id))) ??
            (await createScheduledEvent(scheduledEventInput(ride)));
          await client.query('UPDATE rides SET discord_event_id=$2 WHERE id=$1', [
            ride.id,
            eventId,
          ]);
          ride.discord_event_id = eventId;
        }
        await client.query(
          `UPDATE ride_drafts SET status='published', publication_error=NULL, updated_at=NOW()
         WHERE id=$1 AND published_ride_id=$2`,
          [draft.id, ride.id],
        );
        return ride;
      },
    );
    await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
      content: `Passet **${ride.title}** (#${ride.id}) har publicerats i <#${ride.discord_channel_id}>.`,
      components: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt publiceringsfel';
    await recordRideDraftPublicationError(draftId, userId, message);
    try {
      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content:
          'Discord-publiceringen blev inte fullständig. Sparade steg återanvänds när du försöker igen.',
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: 1,
                label: 'Försök publicera igen',
                custom_id: `ride_draft_publish:${draftId}`,
              },
            ],
          },
        ],
      });
    } catch (callbackError) {
      console.error('Kunde inte visa publiceringsfelet i Discord:', callbackError);
    }
  }
}

export async function handleRideCreateComponent(
  interaction: DiscordInteraction,
): Promise<Record<string, unknown> | null> {
  const customId = interaction.data?.custom_id;
  if (!customId || (!customId.startsWith('ride_create_') && !customId.startsWith('ride_draft_'))) {
    return null;
  }
  const user = userFrom(interaction);
  if (!user || !interaction.channel_id)
    return ephemeral('Åtgärden måste användas på CK UNI-servern.');
  if (!isAuthorized(interaction)) {
    return ephemeral('🚫 Endast ledare och administratörer kan skapa och publicera pass.');
  }
  await upsertUser(user.id, displayName(user));

  if (customId === 'ride_create_cancel') {
    return response({ content: 'Skapandet avbröts.', components: [] }, 7);
  }
  if (customId.startsWith('ride_create_templates:')) {
    return openRideCreateBuilder(Number(customId.split(':')[1]) || 0, 7);
  }
  if (customId === 'ride_create_template') {
    const templateId = interaction.data?.values?.[0];
    if (!templateId) return ephemeral('Välj en giltig passmall.');
    return openTemplateRideDraft(user, interaction.channel_id, templateId);
  }
  if (customId.startsWith('ride_create_quick:')) {
    const templateId = customId.split(':')[1];
    return openTemplateRideDraft(user, interaction.channel_id, templateId);
  }
  if (customId === 'ride_create_copy') {
    const draft = await createRideDraftFromLatestRide(
      user.id,
      interaction.channel_id,
      config.TIMEZONE,
    );
    if (!draft) return ephemeral('Du har inget tidigare officiellt pass att kopiera.');
    return scheduleModal(draft, 'Kopiera senaste passet');
  }
  if (customId === 'ride_create_new') {
    return basicModal(await createEmptyRideDraft(user.id, interaction.channel_id));
  }

  const [action, draftId] = customId.split(':');
  if (!draftId) return ephemeral('Utkast-ID saknas.');
  const draft = await getRideDraft(draftId, user.id);
  if (action === 'ride_draft_publish') {
    if (!draft) return ephemeral('Utkastet hittades inte eller tillhör en annan användare.');
    if (draft.status === 'expired' || draft.status === 'cancelled') {
      return ephemeral(
        draft.status === 'expired' ? 'Utkastet har gått ut.' : 'Utkastet har avbrutits.',
      );
    }
    try {
      const publication = await prepareRideDraftPublication(draftId, user.id);
      runDiscordBackgroundTask(() => publishDraftLater(interaction, draftId, user.id));
      return response(
        {
          content: `Publicerar **${publication.ride.title}** (#${publication.ride.id}) …`,
          components: [],
        },
        7,
      );
    } catch (error) {
      return ephemeral(error instanceof Error ? error.message : 'Kunde inte publicera utkastet.');
    }
  }

  const unavailable = draftUnavailable(draft);
  if (unavailable) return unavailable;
  if (action === 'ride_draft_edit_basic') return basicModal(draft as RideDraft);
  if (action === 'ride_draft_edit_details') return detailsModal(draft as RideDraft);
  if (action === 'ride_draft_cancel') {
    const cancelled = await cancelRideDraft(draftId, user.id);
    return cancelled
      ? response(
          { content: 'Utkastet har avbrutits och kommer inte att publiceras.', components: [] },
          7,
        )
      : ephemeral('Utkastet kunde inte avbrytas.');
  }
  return ephemeral('Okänd åtgärd för utkastet.');
}

export async function handleRideCreateModal(
  interaction: DiscordInteraction,
): Promise<Record<string, unknown> | null> {
  const customId = interaction.data?.custom_id;
  if (!customId?.startsWith('ride_draft_')) return null;
  const user = userFrom(interaction);
  if (!user) return ephemeral('Kunde inte identifiera Discord-användaren.');
  if (!isAuthorized(interaction)) {
    return ephemeral('🚫 Endast ledare och administratörer kan skapa pass.');
  }
  await upsertUser(user.id, displayName(user));
  const [action, draftId] = customId.split(':');
  if (!draftId) return ephemeral('Utkast-ID saknas.');
  const draft = await getRideDraft(draftId, user.id);
  const unavailable = draftUnavailable(draft);
  if (unavailable) return unavailable;

  try {
    const fields = modalValues(interaction);
    if (config.ZWIFT_ENABLED && fields.zwift_url !== undefined) {
      fields.zwift_url = normalizeZwiftRideUrl(fields.zwift_url, draft?.zwift_url ?? null) ?? '';
    }
    let updated: RideDraft | null = null;
    if (action === 'ride_draft_basic') {
      updated = await updateRideDraftBasic(
        draftId,
        user.id,
        parseRideBasicFields(fields, config.TIMEZONE),
      );
    } else if (action === 'ride_draft_schedule') {
      updated = await updateRideDraftSchedule(
        draftId,
        user.id,
        parseRideScheduleFields(fields, config.TIMEZONE),
      );
    } else if (action === 'ride_draft_details') {
      updated = await updateRideDraftDetails(draftId, user.id, parseRideDetailFields(fields));
    } else {
      return ephemeral('Okänt formulär för utkastet.');
    }
    if (!updated) return ephemeral('Utkastet kunde inte uppdateras. Det kan ha gått ut.');
    return response(await previewData(updated, true));
  } catch (error) {
    return ephemeral(error instanceof Error ? error.message : 'Kunde inte uppdatera utkastet.');
  }
}
