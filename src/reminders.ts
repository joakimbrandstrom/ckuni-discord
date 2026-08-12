import { config } from './config.js';
import { pool } from './db/pool.js';
import { sendChannelMessage } from './discord/api.js';
import { reminderMessage } from './rides/reminder-message.js';
import { needs24hReminder, needs30mReminder } from './rides/reminder-thresholds.js';

type ReminderRide = {
  id: string;
  title: string;
  starts_at: Date;
  discord_channel_id: string;
  reminder_24h_sent: boolean;
  reminder_30m_sent: boolean;
};

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: ReminderRide[] }>;

export function createReminderTick(dependencies: {
  query: Query;
  send: typeof sendChannelMessage;
  timezone: string;
  now?: () => number;
}): () => Promise<void> {
  const now = dependencies.now ?? Date.now;

  async function sendReminder(ride: ReminderRide, kind: '24h' | '30m'): Promise<void> {
    await dependencies.send(ride.discord_channel_id, {
      content: reminderMessage(ride, kind, dependencies.timezone),
    });
    await dependencies.query(
      `UPDATE rides SET ${kind === '24h' ? 'reminder_24h_sent' : 'reminder_30m_sent'} = TRUE WHERE id = $1`,
      [ride.id],
    );
  }

  return async () => {
    const result = await dependencies.query(
      `SELECT id, title, starts_at, discord_channel_id, reminder_24h_sent, reminder_30m_sent
       FROM rides
       WHERE status = 'scheduled'
         AND starts_at > NOW()
         AND starts_at < NOW() + INTERVAL '25 hours'`,
    );

    const currentTime = now();
    for (const ride of result.rows) {
      const minutes = (new Date(ride.starts_at).getTime() - currentTime) / 60_000;
      if (needs24hReminder(ride.reminder_24h_sent, minutes)) {
        await sendReminder(ride, '24h');
      }
      if (needs30mReminder(ride.reminder_30m_sent, minutes)) {
        await sendReminder(ride, '30m');
      }
    }
  };
}

export type ReminderLoop = {
  stop: () => Promise<void>;
};

export function createReminderLoop(
  work: () => Promise<void>,
  options: {
    schedule?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
    cancel?: (timer: NodeJS.Timeout) => void;
    onError?: (error: unknown) => void;
  } = {},
): ReminderLoop {
  const schedule =
    options.schedule ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
  const cancel = options.cancel ?? ((timer) => clearInterval(timer));
  const onError =
    options.onError ?? ((error) => console.error('Påminnelsejobbet misslyckades:', error));
  let currentTick: Promise<void> | null = null;

  const run = () => {
    if (currentTick) return;
    currentTick = Promise.resolve()
      .then(work)
      .catch((error) => {
        try {
          onError(error);
        } catch (loggingError) {
          console.error('Kunde inte logga ett misslyckat påminnelsejobb:', error, loggingError);
        }
      })
      .finally(() => {
        currentTick = null;
      });
  };

  run();
  const timer = schedule(run, 60_000);
  return {
    async stop() {
      cancel(timer);
      await currentTick;
    },
  };
}

const tick = createReminderTick({
  query: async (sql, values) => {
    const result = await pool.query<ReminderRide>(sql, values);
    return { rows: result.rows };
  },
  send: sendChannelMessage,
  timezone: config.TIMEZONE,
});

export function startReminderLoop(): ReminderLoop {
  return createReminderLoop(tick);
}

export async function stopReminderLoop(loop: ReminderLoop): Promise<void> {
  await loop.stop();
}
