import { DateTime } from 'luxon';

export function reminderMessage(
  ride: { title: string; starts_at: Date },
  kind: '24h' | '30m',
  timezone: string,
): string {
  const local = DateTime.fromJSDate(new Date(ride.starts_at), { zone: 'utc' }).setZone(timezone);
  const when = kind === '24h' ? 'i morgon' : 'om 30 minuter';
  return `🔔 **${ride.title}** börjar ${when} — ${local.toFormat('HH:mm')}. Anmäl dig på passkortet.`;
}
