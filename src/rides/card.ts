import { DateTime } from 'luxon';
import type { Ride } from './repository.js';

type RideCardData = Pick<
  Ride,
  | 'title'
  | 'description'
  | 'ride_type'
  | 'starts_at'
  | 'duration_minutes'
  | 'zwift_url'
  | 'route_world'
  | 'pace_workout'
  | 'notes'
  | 'status'
>;

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

function rideEmbed(
  ride: RideCardData,
  counts: { going: number; maybe: number },
  timezone: string,
  rideId?: string,
): Record<string, string> {
  const local = DateTime.fromJSDate(new Date(ride.starts_at), {
    zone: 'utc',
  })
    .setZone(timezone)
    .setLocale('sv');
  const description = [
    ride.status === 'cancelled' ? '🚫 **Det här passet är inställt.**' : undefined,
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
    rideId ? `Pass-ID: \`${rideId}\`` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
  if (description.length > 4096) {
    throw new Error('Passuppgifterna är för långa för ett Discord-passkort. Korta ned detaljerna.');
  }

  return {
    title: ride.status === 'cancelled' ? `🚫 INSTÄLLT — ${ride.title}` : `🚴 ${ride.title}`,
    description,
  };
}

export function rideMessage(
  ride: Ride,
  counts: { going: number; maybe: number },
  timezone: string,
): Record<string, unknown> {
  return {
    embeds: [rideEmbed(ride, counts, timezone, ride.id)],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Jag kommer',
            custom_id: `ride_join:${ride.id}`,
            disabled: ride.status !== 'scheduled',
          },
          {
            type: 2,
            style: 2,
            label: 'Kanske',
            custom_id: `ride_maybe:${ride.id}`,
            disabled: ride.status !== 'scheduled',
          },
        ],
      },
    ],
  };
}

export function ridePreviewEmbed(
  ride: Omit<RideCardData, 'status'>,
  timezone: string,
): Record<string, string> {
  return rideEmbed({ ...ride, status: 'scheduled' }, { going: 1, maybe: 0 }, timezone);
}
