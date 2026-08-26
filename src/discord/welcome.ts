import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type GuildMember,
  type MessageCreateOptions,
  PermissionFlagsBits,
} from 'discord.js';

export type WelcomeLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

type WelcomeMember = {
  id: string;
  guild: { id: string };
};

type WelcomeChannel =
  | { guildId: string | null; canSend: false }
  | {
      guildId: string;
      canSend: true;
      send: (message: MessageCreateOptions) => Promise<unknown>;
    };

type WelcomeGatewayClient = {
  onMemberAdd: (listener: (member: WelcomeMember) => void) => () => void;
  onError: (listener: (error: Error) => void) => void;
  fetchChannel: (channelId: string) => Promise<WelcomeChannel | null>;
  login: (token: string) => Promise<void>;
  destroy: () => Promise<void>;
};

type WelcomeClientFactory = (intents: GatewayIntentBits[]) => WelcomeGatewayClient;

export type WelcomeGateway = {
  stop: () => Promise<void>;
};

export type WelcomeChannelIds = {
  announcements: string;
  zwiftRide: string;
  general: string;
};

export function buildWelcomeMessage(
  memberId: string,
  channelIds: WelcomeChannelIds,
): MessageCreateOptions {
  return {
    content: `Välkommen till CK UNI:s digitala klubbhus, <@${memberId}>! 🚴

Börja gärna här:

📢 <#${channelIds.announcements}> – officiell information och viktiga uppdateringar
🚴 <#${channelIds.zwiftRide}> – planerade CK UNI-pass på Zwift
💬 <#${channelIds.general}> – diskussioner, frågor och spontana förslag

Under Röstkanaler finns Zwift Ride 1 och Zwift Ride 2. De används för kommunikation under gemensamma pass.

Läs informationen i den här kanalen och presentera dig gärna kort i <#${channelIds.general}>. Berätta vad du brukar cykla och vad du vill få ut av CK UNI-communityn.`,
    allowedMentions: {
      parse: [],
      users: [memberId],
      roles: [],
      repliedUser: false,
    },
  };
}

export async function handleGuildMemberAdd(
  member: WelcomeMember,
  options: {
    guildId: string;
    welcomeChannelId: string;
    channelIds: WelcomeChannelIds;
    fetchChannel: (channelId: string) => Promise<WelcomeChannel | null>;
    logger: WelcomeLogger;
  },
): Promise<void> {
  if (member.guild.id !== options.guildId) return;

  try {
    const channel = await options.fetchChannel(options.welcomeChannelId);
    if (!channel || channel.guildId !== options.guildId) {
      options.logger.error(
        { channelId: options.welcomeChannelId, guildId: options.guildId },
        'Discord welcome channel was not found in the configured guild',
      );
      return;
    }
    if (!channel.canSend) {
      options.logger.error(
        { channelId: options.welcomeChannelId, guildId: options.guildId },
        'Discord bot cannot send messages in the welcome channel',
      );
      return;
    }

    await channel.send(buildWelcomeMessage(member.id, options.channelIds));
    options.logger.info(
      {
        channelId: options.welcomeChannelId,
        guildId: options.guildId,
        memberId: member.id,
      },
      'Discord welcome message sent',
    );
  } catch (error) {
    options.logger.error(
      {
        err: error,
        channelId: options.welcomeChannelId,
        guildId: options.guildId,
        memberId: member.id,
      },
      'Failed to send Discord welcome message',
    );
  }
}

function createDiscordClient(intents: GatewayIntentBits[]): WelcomeGatewayClient {
  const client = new Client({ intents });

  return {
    onMemberAdd(listener) {
      const discordListener = (member: GuildMember) => listener(member);
      client.on(Events.GuildMemberAdd, discordListener);
      return () => client.off(Events.GuildMemberAdd, discordListener);
    },
    onError(listener) {
      client.on(Events.Error, listener);
      client.on(Events.ShardError, listener);
    },
    async fetchChannel(channelId) {
      const channel = await client.channels.fetch(channelId);
      if (!channel) return null;

      const guildId = 'guildId' in channel ? channel.guildId : null;
      if (channel.type !== ChannelType.GuildText || !channel.isSendable()) {
        return { guildId, canSend: false };
      }

      const botMember = channel.guild.members.me;
      const canSend =
        botMember !== null &&
        channel
          .permissionsFor(botMember)
          .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
      if (!canSend) return { guildId: channel.guildId, canSend: false };

      return {
        guildId: channel.guildId,
        canSend: true,
        send: (message) => channel.send(message),
      };
    },
    async login(token) {
      await client.login(token);
    },
    async destroy() {
      await client.destroy();
    },
  };
}

export async function startWelcomeGateway(
  options: {
    token: string;
    guildId: string;
    welcomeChannelId?: string;
    announcementsChannelId?: string;
    zwiftRideChannelId?: string;
    generalChannelId?: string;
    signal?: AbortSignal;
    logger: WelcomeLogger;
  },
  createClient: WelcomeClientFactory = createDiscordClient,
): Promise<WelcomeGateway | null> {
  if (!options.welcomeChannelId) return null;

  const configuredChannelIds = {
    DISCORD_ANNOUNCEMENTS_CHANNEL_ID: options.announcementsChannelId,
    DISCORD_ZWIFT_RIDE_CHANNEL_ID: options.zwiftRideChannelId,
    DISCORD_GENERAL_CHANNEL_ID: options.generalChannelId,
  };
  const missingVariables = Object.entries(configuredChannelIds)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingVariables.length > 0) {
    options.logger.error(
      { missingVariables },
      'Discord welcome Gateway configuration is incomplete',
    );
    throw new Error(`Missing welcome channel configuration: ${missingVariables.join(', ')}`);
  }
  const channelIds: WelcomeChannelIds = {
    announcements: options.announcementsChannelId as string,
    zwiftRide: options.zwiftRideChannelId as string,
    general: options.generalChannelId as string,
  };

  const client = createClient([GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]);
  const pendingEvents = new Set<Promise<void>>();
  const stopMemberEvents = client.onMemberAdd((member) => {
    const event = handleGuildMemberAdd(member, {
      guildId: options.guildId,
      welcomeChannelId: options.welcomeChannelId as string,
      channelIds,
      fetchChannel: client.fetchChannel,
      logger: options.logger,
    });
    pendingEvents.add(event);
    void event.finally(() => pendingEvents.delete(event));
  });
  client.onError((error) => {
    options.logger.error({ err: error }, 'Discord welcome Gateway connection error');
  });

  let startupAborted = options.signal?.aborted ?? false;
  const abortStartup = () => {
    startupAborted = true;
    void client.destroy().catch((error) => {
      options.logger.error({ err: error }, 'Failed to abort Discord welcome Gateway startup');
    });
  };
  options.signal?.addEventListener('abort', abortStartup, { once: true });

  try {
    if (startupAborted) throw new Error('Discord welcome Gateway startup was aborted');
    await client.login(options.token);
    if (startupAborted) throw new Error('Discord welcome Gateway startup was aborted');
  } catch (error) {
    stopMemberEvents();
    if (!startupAborted) {
      options.logger.error({ err: error }, 'Discord welcome Gateway failed to start');
    }
    await client.destroy().catch((destroyError) => {
      options.logger.error(
        { err: destroyError },
        'Failed to clean up Discord welcome Gateway after startup failure',
      );
    });
    throw new Error('Discord welcome Gateway could not start', { cause: error });
  } finally {
    options.signal?.removeEventListener('abort', abortStartup);
  }

  options.logger.info(
    { guildId: options.guildId, channelId: options.welcomeChannelId },
    'Discord welcome Gateway connected',
  );

  return {
    async stop() {
      stopMemberEvents();
      await Promise.allSettled(pendingEvents);
      await client.destroy();
      options.logger.info({}, 'Discord welcome Gateway stopped');
    },
  };
}

export async function stopWelcomeGateway(gateway: WelcomeGateway | null): Promise<void> {
  await gateway?.stop();
}
