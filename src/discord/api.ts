import { config } from '../config.js';

const API_BASE = 'https://discord.com/api/v10';

async function discordFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API ${response.status}: ${body}`);
  }
  return response;
}

async function webhookFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook API ${response.status}: ${body}`);
  }
  return response;
}

export async function registerGuildCommands(commands: unknown[]): Promise<void> {
  await discordFetch(
    `/applications/${config.DISCORD_APPLICATION_ID}/guilds/${config.DISCORD_GUILD_ID}/commands`,
    { method: 'PUT', body: JSON.stringify(commands) },
  );
}

export async function createScheduledEvent(input: {
  name: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  location: string;
}): Promise<string> {
  const response = await discordFetch(`/guilds/${config.DISCORD_GUILD_ID}/scheduled-events`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.slice(0, 100),
      description: input.description?.slice(0, 1000) || undefined,
      privacy_level: 2,
      entity_type: 3,
      scheduled_start_time: input.startsAt.toISOString(),
      scheduled_end_time: input.endsAt.toISOString(),
      entity_metadata: { location: input.location.slice(0, 100) },
    }),
  });
  const event = (await response.json()) as { id: string };
  return event.id;
}

export async function cancelScheduledEvent(eventId: string): Promise<void> {
  await discordFetch(`/guilds/${config.DISCORD_GUILD_ID}/scheduled-events/${eventId}`, {
    method: 'DELETE',
  });
}

export async function updateScheduledEvent(
  eventId: string,
  input: {
    name: string;
    description?: string | null;
    startsAt: Date;
    endsAt: Date;
    location: string;
  },
): Promise<void> {
  await discordFetch(`/guilds/${config.DISCORD_GUILD_ID}/scheduled-events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: input.name.slice(0, 100),
      description: input.description?.slice(0, 1000) || null,
      scheduled_start_time: input.startsAt.toISOString(),
      scheduled_end_time: input.endsAt.toISOString(),
      entity_metadata: { location: input.location.slice(0, 100) },
    }),
  });
}

export async function sendChannelMessage(
  channelId: string,
  payload: unknown,
): Promise<string | null> {
  const response = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const message = (await response.json()) as { id?: string };
  return message.id ?? null;
}

export async function editChannelMessage(
  channelId: string,
  messageId: string,
  payload: unknown,
): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  token: string,
  payload: unknown,
): Promise<void> {
  await webhookFetch(`/webhooks/${applicationId}/${token}/messages/@original`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
