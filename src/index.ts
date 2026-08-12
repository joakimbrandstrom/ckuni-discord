import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startReminderLoop, stopReminderLoop } from './reminders.js';

const app = await buildApp();
const reminderTimer = startReminderLoop();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await stopReminderLoop(reminderTimer);
  await app.close();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
