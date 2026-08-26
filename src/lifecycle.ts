import type { WelcomeGateway, WelcomeLogger } from './discord/welcome.js';
import type { ReminderLoop } from './reminders.js';

type LifecycleConfig = {
  port: number;
  discordBotToken: string;
  discordGuildId: string;
  welcomeChannelId?: string;
  announcementsChannelId?: string;
  zwiftRideChannelId?: string;
  generalChannelId?: string;
};

type LifecycleApp = {
  log: WelcomeLogger;
  listen: (options: { host: string; port: number }) => Promise<unknown>;
  close: () => Promise<void>;
};

type ProcessControl = {
  once: (signal: 'SIGTERM' | 'SIGINT', listener: () => void) => unknown;
  exitCode?: string | number | null;
};

type LifecycleDependencies = {
  app: LifecycleApp;
  config: LifecycleConfig;
  processControl: ProcessControl;
  closePool: () => Promise<void>;
  startReminderLoop: () => ReminderLoop;
  stopReminderLoop: (loop: ReminderLoop) => Promise<void>;
  startWelcomeGateway: (options: {
    token: string;
    guildId: string;
    welcomeChannelId?: string;
    announcementsChannelId?: string;
    zwiftRideChannelId?: string;
    generalChannelId?: string;
    signal: AbortSignal;
    logger: WelcomeLogger;
  }) => Promise<WelcomeGateway | null>;
  stopWelcomeGateway: (gateway: WelcomeGateway | null) => Promise<void>;
};

export type ApplicationLifecycle = {
  shutdown: (reason: string, exitCode?: number) => Promise<void>;
};

export async function runApplication(
  dependencies: LifecycleDependencies,
): Promise<ApplicationLifecycle> {
  let reminderLoop: ReminderLoop | null = null;
  let welcomeGateway: WelcomeGateway | null = null;
  let shutdownPromise: Promise<void> | null = null;
  const gatewayStartup = new AbortController();

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      dependencies.app.log.info({ reason }, 'Shutting down');
      gatewayStartup.abort();
      let shutdownFailed = false;

      const close = async (resource: string, work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          shutdownFailed = true;
          dependencies.app.log.error({ err: error, resource }, 'Failed to shut down resource');
        }
      };

      await close('Discord welcome Gateway', () => dependencies.stopWelcomeGateway(welcomeGateway));
      const activeReminderLoop = reminderLoop;
      if (activeReminderLoop) {
        await close('reminder loop', () => dependencies.stopReminderLoop(activeReminderLoop));
      }
      await close('Fastify', () => dependencies.app.close());
      await close('PostgreSQL pool', dependencies.closePool);

      dependencies.processControl.exitCode = shutdownFailed && exitCode === 0 ? 1 : exitCode;
    })();

    return shutdownPromise;
  }

  dependencies.processControl.once('SIGTERM', () => void shutdown('SIGTERM'));
  dependencies.processControl.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    welcomeGateway = await dependencies.startWelcomeGateway({
      token: dependencies.config.discordBotToken,
      guildId: dependencies.config.discordGuildId,
      welcomeChannelId: dependencies.config.welcomeChannelId,
      announcementsChannelId: dependencies.config.announcementsChannelId,
      zwiftRideChannelId: dependencies.config.zwiftRideChannelId,
      generalChannelId: dependencies.config.generalChannelId,
      signal: gatewayStartup.signal,
      logger: dependencies.app.log,
    });
    if (shutdownPromise) {
      await dependencies.stopWelcomeGateway(welcomeGateway);
      welcomeGateway = null;
    } else {
      reminderLoop = dependencies.startReminderLoop();
      await dependencies.app.listen({ host: '0.0.0.0', port: dependencies.config.port });
    }
  } catch (error) {
    if (!shutdownPromise) {
      dependencies.app.log.error({ err: error }, 'Application failed to start');
      await shutdown('startup failure', 1);
    }
  }

  return { shutdown };
}
