import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayIntentBits, type MessageCreateOptions } from 'discord.js';
import {
  buildWelcomeMessage,
  handleGuildMemberAdd,
  startWelcomeGateway,
  stopWelcomeGateway,
  type WelcomeLogger,
} from '../src/discord/welcome.js';

function recordingLogger() {
  const entries: Array<{
    level: 'info' | 'error';
    context: Record<string, unknown>;
    message: string;
  }> = [];
  const logger: WelcomeLogger = {
    info: (context, message) => entries.push({ level: 'info', context, message }),
    error: (context, message) => entries.push({ level: 'error', context, message }),
  };
  return { entries, logger };
}

test('welcome message mentions only the new member', () => {
  const message = buildWelcomeMessage('member-42', {
    announcements: 'announcements-channel',
    zwiftRide: 'zwift-channel',
    general: 'general-channel',
  });

  assert.match(message.content ?? '', /<@member-42>/);
  assert.match(message.content ?? '', /<#announcements-channel>/);
  assert.match(message.content ?? '', /<#zwift-channel>/);
  assert.match(message.content ?? '', /<#general-channel>/);
  assert.doesNotMatch(message.content ?? '', /#spontan-rides|#zwift-rides/);
  assert.deepEqual(message.allowedMentions, {
    parse: [],
    users: ['member-42'],
    roles: [],
    repliedUser: false,
  });
});

test('ignores member events from another guild', async () => {
  let fetches = 0;
  await handleGuildMemberAdd(
    { id: 'member-42', guild: { id: 'other-guild' } },
    {
      guildId: 'configured-guild',
      welcomeChannelId: 'welcome-channel',
      channelIds: {
        announcements: 'announcements-channel',
        zwiftRide: 'zwift-channel',
        general: 'general-channel',
      },
      async fetchChannel() {
        fetches += 1;
        return null;
      },
      logger: recordingLogger().logger,
    },
  );

  assert.equal(fetches, 0);
});

test('does not send when the welcome channel is missing or not writable', async (t) => {
  for (const name of ['missing', 'not writable'] as const) {
    await t.test(name, async () => {
      let sends = 0;
      const logs = recordingLogger();
      const channel =
        name === 'missing'
          ? null
          : {
              guildId: 'configured-guild',
              canSend: false as const,
              async send() {
                sends += 1;
              },
            };
      await handleGuildMemberAdd(
        { id: 'member-42', guild: { id: 'configured-guild' } },
        {
          guildId: 'configured-guild',
          welcomeChannelId: 'welcome-channel',
          channelIds: {
            announcements: 'announcements-channel',
            zwiftRide: 'zwift-channel',
            general: 'general-channel',
          },
          fetchChannel: async () => channel,
          logger: logs.logger,
        },
      );

      assert.equal(sends, 0);
      assert.equal(logs.entries[0]?.level, 'error');
    });
  }
});

test('sends the protected welcome payload for a matching guild member', async () => {
  const sent: MessageCreateOptions[] = [];
  const logs = recordingLogger();
  await handleGuildMemberAdd(
    { id: 'member-42', guild: { id: 'configured-guild' } },
    {
      guildId: 'configured-guild',
      welcomeChannelId: 'welcome-channel',
      channelIds: {
        announcements: 'announcements-channel',
        zwiftRide: 'zwift-channel',
        general: 'general-channel',
      },
      fetchChannel: async () => ({
        guildId: 'configured-guild',
        canSend: true,
        async send(message) {
          sent.push(message);
        },
      }),
      logger: logs.logger,
    },
  );

  assert.deepEqual(sent, [
    buildWelcomeMessage('member-42', {
      announcements: 'announcements-channel',
      zwiftRide: 'zwift-channel',
      general: 'general-channel',
    }),
  ]);
  assert.equal(logs.entries[0]?.level, 'info');
});

test('does not create a Gateway client when the welcome channel is not configured', async () => {
  let clientsCreated = 0;
  const gateway = await startWelcomeGateway(
    {
      token: 'unused-token',
      guildId: 'configured-guild',
      logger: recordingLogger().logger,
    },
    () => {
      clientsCreated += 1;
      throw new Error('client must not be created');
    },
  );

  assert.equal(gateway, null);
  assert.equal(clientsCreated, 0);
});

test('starts with only the required intents and stops the Gateway client', async () => {
  let capturedIntents: GatewayIntentBits[] = [];
  let loginToken: string | undefined;
  let destroys = 0;
  const logs = recordingLogger();

  const gateway = await startWelcomeGateway(
    {
      token: 'bot-token',
      guildId: 'configured-guild',
      welcomeChannelId: 'welcome-channel',
      announcementsChannelId: 'announcements-channel',
      zwiftRideChannelId: 'zwift-channel',
      generalChannelId: 'general-channel',
      logger: logs.logger,
    },
    (intents) => {
      capturedIntents = intents;
      return {
        onMemberAdd() {},
        onError() {},
        fetchChannel: async () => null,
        async login(token) {
          loginToken = token;
        },
        async destroy() {
          destroys += 1;
        },
      };
    },
  );

  assert.deepEqual(capturedIntents, [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]);
  assert.equal(loginToken, 'bot-token');
  assert.equal(logs.entries[0]?.message, 'Discord welcome Gateway connected');

  await stopWelcomeGateway(gateway);
  assert.equal(destroys, 1);
});

test('cleans up and rejects when the configured Gateway cannot start', async () => {
  let destroys = 0;
  const logs = recordingLogger();

  await assert.rejects(
    startWelcomeGateway(
      {
        token: 'invalid-token',
        guildId: 'configured-guild',
        welcomeChannelId: 'welcome-channel',
        announcementsChannelId: 'announcements-channel',
        zwiftRideChannelId: 'zwift-channel',
        generalChannelId: 'general-channel',
        logger: logs.logger,
      },
      () => ({
        onMemberAdd() {},
        onError() {},
        fetchChannel: async () => null,
        async login() {
          throw new Error('login failed');
        },
        async destroy() {
          destroys += 1;
        },
      }),
    ),
    /Discord welcome Gateway could not start/,
  );

  assert.equal(destroys, 1);
  assert.equal(logs.entries[0]?.message, 'Discord welcome Gateway failed to start');
});

test('rejects incomplete channel references before creating a Gateway client', async () => {
  let clientsCreated = 0;
  const logs = recordingLogger();

  await assert.rejects(
    startWelcomeGateway(
      {
        token: 'unused-token',
        guildId: 'configured-guild',
        welcomeChannelId: 'welcome-channel',
        logger: logs.logger,
      },
      () => {
        clientsCreated += 1;
        throw new Error('client must not be created');
      },
    ),
    /DISCORD_ANNOUNCEMENTS_CHANNEL_ID.*DISCORD_ZWIFT_RIDE_CHANNEL_ID.*DISCORD_GENERAL_CHANNEL_ID/,
  );

  assert.equal(clientsCreated, 0);
  assert.equal(logs.entries[0]?.message, 'Discord welcome Gateway configuration is incomplete');
});
