import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startWelcomeGateway, stopWelcomeGateway, type WelcomeGateway } from './discord/welcome.js';
import { type ReminderLoop, startReminderLoop, stopReminderLoop } from './reminders.js';

const app = await buildApp();
let reminderLoop: ReminderLoop | null = null;
let welcomeGateway: WelcomeGateway | null = null;
let shutdownPromise: Promise<void> | null = null;
const gatewayStartup = new AbortController();

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    app.log.info({ reason }, 'Shutting down');
    gatewayStartup.abort();
    let shutdownFailed = false;

    const close = async (resource: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        shutdownFailed = true;
        app.log.error({ err: error, resource }, 'Failed to shut down resource');
      }
    };

    await close('Discord welcome Gateway', () => stopWelcomeGateway(welcomeGateway));
    const activeReminderLoop = reminderLoop;
    if (activeReminderLoop)
      await close('reminder loop', () => stopReminderLoop(activeReminderLoop));
    await close('Fastify', () => app.close());
    await close('PostgreSQL pool', closePool);

    process.exitCode = shutdownFailed && exitCode === 0 ? 1 : exitCode;
  })();

  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  welcomeGateway = await startWelcomeGateway({
    token: config.DISCORD_BOT_TOKEN,
    guildId: config.DISCORD_GUILD_ID,
    welcomeChannelId: config.DISCORD_WELCOME_CHANNEL_ID,
    announcementsChannelId: config.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
    zwiftRideChannelId: config.DISCORD_ZWIFT_RIDE_CHANNEL_ID,
    generalChannelId: config.DISCORD_GENERAL_CHANNEL_ID,
    signal: gatewayStartup.signal,
    logger: app.log,
  });
  if (shutdownPromise) {
    await stopWelcomeGateway(welcomeGateway);
    welcomeGateway = null;
  } else {
    reminderLoop = startReminderLoop();
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  }
} catch (error) {
  if (!shutdownPromise) {
    app.log.error({ err: error }, 'Application failed to start');
    await shutdown('startup failure', 1);
  }
}
