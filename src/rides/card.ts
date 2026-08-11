import { DateTime } from 'luxon';
import type { Ride } from './repository.js';

const icons: Record<string, string> = {
  social: '☕',
  intervals: '⚡',
  endurance: '🚴',
  race: '🏁',
  outdoor: '🌤️',
};

const typeNames: Record<string, string> = {
  social: 'Socialt',
  intervals: 'Intervaller',
  endurance: 'Distans',
  race: 'Tävling',
  outdoor: 'Utomhus',
};

export function rideMessage(
  ride: Ride,
  counts: { going: number; maybe: number },
  timezone: string,
): Record<string, unknown> {
  const local = DateTime.fromJSDate(new Date(ride.starts_at), {
    zone: 'utc',
  })
    .setZone(timezone)
    .setLocale('sv');
  const description = [
    ride.description || undefined,
    ride.route_world ? `🗺️ ${ride.route_world}` : undefined,
    ride.pace_workout ? `📈 ${ride.pace_workout}` : undefined,
    `📅 ${local.toFormat('ccc d LLL, HH:mm')}`,
    `⏱ ${ride.duration_minutes} min`,
    `${icons[ride.ride_type] ?? '🚴'} ${typeNames[ride.ride_type] ?? ride.ride_type}`,
    ride.zwift_url ? `🎮 ${ride.zwift_url}` : undefined,
    ride.notes ? `📝 ${ride.notes}` : undefined,
    '',
    `✅ Kommer: **${counts.going}**   🤔 Kanske: **${counts.maybe}**`,
    `Pass-ID: \`${ride.id}\``,
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
            label: 'Jag kommer',
            custom_id: `ride_join:${ride.id}`,
          },
          {
            type: 2,
            style: 2,
            label: 'Kanske',
            custom_id: `ride_maybe:${ride.id}`,
          },
        ],
      },
    ],
  };
}
