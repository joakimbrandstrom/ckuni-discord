import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startWelcomeGateway, stopWelcomeGateway } from './discord/welcome.js';
import { runApplication } from './lifecycle.js';
import { startReminderLoop, stopReminderLoop } from './reminders.js';

const app = await buildApp();

await runApplication({
  app,
  config: {
    port: config.PORT,
    discordBotToken: config.DISCORD_BOT_TOKEN,
    discordGuildId: config.DISCORD_GUILD_ID,
    welcomeChannelId: config.DISCORD_WELCOME_CHANNEL_ID,
    announcementsChannelId: config.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
    zwiftRideChannelId: config.DISCORD_ZWIFT_RIDE_CHANNEL_ID,
    generalChannelId: config.DISCORD_GENERAL_CHANNEL_ID,
  },
  processControl: process,
  closePool,
  startReminderLoop,
  stopReminderLoop,
  startWelcomeGateway,
  stopWelcomeGateway,
});
