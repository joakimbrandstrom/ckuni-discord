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

let running = false;
let currentTick: Promise<void> | null = null;

async function sendReminder(ride: ReminderRide, kind: '24h' | '30m'): Promise<void> {
  await sendChannelMessage(ride.discord_channel_id, {
    content: reminderMessage(ride, kind, config.TIMEZONE),
  });
  await pool.query(
    `UPDATE rides SET ${kind === '24h' ? 'reminder_24h_sent' : 'reminder_30m_sent'} = TRUE WHERE id = $1`,
    [ride.id],
  );
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await pool.query<ReminderRide>(
      `SELECT id, title, starts_at, discord_channel_id, reminder_24h_sent, reminder_30m_sent
       FROM rides
       WHERE status = 'scheduled'
         AND starts_at > NOW()
         AND starts_at < NOW() + INTERVAL '25 hours'`,
    );

    const now = Date.now();
    for (const ride of result.rows) {
      const ms = new Date(ride.starts_at).getTime() - now;
      const minutes = ms / 60_000;

      // Catch up after downtime: send if the threshold has passed but the ride
      // has not started yet. The upper bound is kept to avoid a fresh start
      // sending a 24h reminder moments before the 30m one is due.
      if (needs24hReminder(ride.reminder_24h_sent, minutes)) {
        await sendReminder(ride, '24h');
      }
      if (needs30mReminder(ride.reminder_30m_sent, minutes)) {
        await sendReminder(ride, '30m');
      }
    }
  } finally {
    running = false;
  }
}

export function startReminderLoop(): NodeJS.Timeout {
  const runTick = () => {
    if (currentTick) return;
    currentTick = tick().finally(() => {
      currentTick = null;
    });
  };
  runTick();
  return setInterval(runTick, 60_000);
}

/** Stop scheduling reminders and let an in-flight database/Discord operation finish. */
export async function stopReminderLoop(timer: NodeJS.Timeout): Promise<void> {
  clearInterval(timer);
  await currentTick;
}
