import { DateTime } from 'luxon';
import type { Ride } from './repository.js';

const icons: Record<string, string> = {
  social: '☕',
  intervals: '⚡',
  endurance: '🚴',
  race: '🏁',
  outdoor: '🌤️',
};

export function rideMessage(
  ride: Ride,
  counts: { going: number; maybe: number },
  timezone: string,
): Record<string, unknown> {
  const local = DateTime.fromJSDate(new Date(ride.starts_at), {
    zone: 'utc',
  }).setZone(timezone);
  const description = [
    ride.description || undefined,
    `📅 ${local.toFormat('ccc d LLL, HH:mm')}`,
    `⏱ ${ride.duration_minutes} min`,
    `${icons[ride.ride_type] ?? '🚴'} ${ride.ride_type}`,
    ride.zwift_url ? `🎮 ${ride.zwift_url}` : undefined,
    '',
    `✅ Going: **${counts.going}**   🤔 Maybe: **${counts.maybe}**`,
    `Ride ID: \`${ride.id}\``,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return {
    embeds: [
      {
        title: `🚴 ${ride.title}`,
        description,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Join',
            custom_id: `ride_join:${ride.id}`,
          },
          {
            type: 2,
            style: 2,
            label: 'Maybe',
            custom_id: `ride_maybe:${ride.id}`,
          },
        ],
      },
    ],
  };
}
