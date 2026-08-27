export function scheduledEventMarker(rideId: string): string {
  return `CK UNI Pass-ID: ${rideId}`;
}

function scheduledEventDescription(ride: {
  id?: string;
  description?: string | null;
  route_world?: string | null;
  pace_workout?: string | null;
  zwift_url?: string | null;
  notes?: string | null;
}): string | undefined {
  const marker = ride.id ? scheduledEventMarker(ride.id) : undefined;
  const lines = [
    ride.description || undefined,
    ride.route_world ? `Rutt/värld: ${ride.route_world}` : undefined,
    ride.pace_workout ? `Tempo/träning: ${ride.pace_workout}` : undefined,
    ride.zwift_url ? `Zwift: ${ride.zwift_url}` : undefined,
    ride.notes ? `Anteckningar: ${ride.notes}` : undefined,
  ].filter(Boolean);
  const details = lines.join('\n');
  if (!marker) return details.slice(0, 1000) || undefined;
  return `${details.slice(0, 1000 - marker.length - 1)}\n${marker}`.trim();
}

export function scheduledEventInput(ride: {
  id?: string;
  title: string;
  description?: string | null;
  route_world?: string | null;
  pace_workout?: string | null;
  zwift_url?: string | null;
  notes?: string | null;
  starts_at: Date;
  duration_minutes: number;
  ride_type: string;
}): {
  name: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  location: string;
} {
  const startsAt = new Date(ride.starts_at);
  return {
    name: ride.title,
    description: scheduledEventDescription(ride),
    startsAt,
    endsAt: new Date(startsAt.getTime() + ride.duration_minutes * 60_000),
    location: ride.zwift_url
      ? 'Zwift + Discord-röstkanal'
      : ride.ride_type === 'outdoor'
        ? 'CK UNI-pass utomhus'
        : 'Discord / Zwift',
  };
}
