import { parseLocalRideStart } from './time.js';

export const RIDE_TYPES = ['social', 'intervals', 'endurance', 'race', 'outdoor'] as const;

export type RideType = (typeof RIDE_TYPES)[number];

export type CreateRideFields = {
  title: string;
  startsAt: Date;
  durationMinutes: number;
  rideType: RideType;
  description?: string;
  zwiftUrl?: string;
  routeWorld?: string;
  paceWorkout?: string;
  notes?: string;
};

export type TemplateFields = Omit<CreateRideFields, 'startsAt' | 'zwiftUrl'> & { name: string };

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} måste anges.`);
  return trimmed;
}

function parseDuration(value: string | undefined): number {
  const duration = Number(required(value, 'Längd'));
  if (!Number.isInteger(duration) || duration < 15 || duration > 600) {
    throw new Error('Längden måste vara ett heltal mellan 15 och 600 minuter.');
  }
  return duration;
}

function parseRideType(value: string | undefined): RideType {
  const typeInput = required(value, 'Typ').toLowerCase();
  const aliases: Record<string, RideType> = {
    social: 'social',
    socialt: 'social',
    intervals: 'intervals',
    intervaller: 'intervals',
    endurance: 'endurance',
    distans: 'endurance',
    race: 'race',
    tävling: 'race',
    outdoor: 'outdoor',
    utomhus: 'outdoor',
  };
  const rideType = aliases[typeInput];
  if (!rideType) {
    throw new Error('Typ måste vara social, intervaller, distans, tävling eller utomhus.');
  }
  return rideType;
}

export function parseRideDetails(value: string | undefined): {
  description?: string;
  zwiftUrl?: string;
  routeWorld?: string;
  paceWorkout?: string;
  notes?: string;
} {
  const lines = value
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines?.length) return {};

  const fields: Record<string, string[]> = {};
  const descriptions: string[] = [];
  for (const line of lines) {
    const match =
      /^(beskrivning|rutt(?:\/värld)?|tempo(?:\/träning)?|zwift|anteckningar):\s*(.*)$/i.exec(line);
    if (!match) {
      if (/^https?:\/\//i.test(line)) fields.zwift = [line];
      else descriptions.push(line);
      continue;
    }
    const key = match[1].toLowerCase();
    if (key === 'beskrivning') descriptions.push(match[2]);
    else if (key.startsWith('rutt')) fields.route = [match[2]];
    else if (key.startsWith('tempo')) fields.pace = [match[2]];
    else if (key === 'zwift') fields.zwift = [match[2]];
    else if (key === 'anteckningar') fields.notes = [match[2]];
  }
  const urlValue = fields.zwift?.join(' ').trim() || undefined;
  if (urlValue) {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error('Zwift-länken är inte en giltig webbadress.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Zwift-länken måste börja med http:// eller https://.');
    }
  }

  return {
    description: descriptions.filter(Boolean).join('\n') || undefined,
    zwiftUrl: urlValue,
    routeWorld: fields.route?.join(' ').trim() || undefined,
    paceWorkout: fields.pace?.join(' ').trim() || undefined,
    notes: fields.notes?.join(' ').trim() || undefined,
  };
}

export function parseCreateRideFields(
  fields: Record<string, string | undefined>,
  timezone: string,
  now = new Date(),
): CreateRideFields {
  const title = required(fields.title, 'Titel');
  const dateTime = required(fields.date_time, 'Datum och tid');
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(dateTime);
  if (!match) throw new Error('Datum och tid måste skrivas som ÅÅÅÅ-MM-DD TT:mm.');

  const startsAt = parseLocalRideStart(match[1], match[2], timezone);
  if (startsAt.getTime() < now.getTime() - 60_000) {
    throw new Error('Starttiden måste ligga i framtiden.');
  }

  const durationMinutes = parseDuration(fields.duration);
  const rideType = parseRideType(fields.ride_type);

  return {
    title,
    startsAt,
    durationMinutes,
    rideType,
    ...parseRideDetails(fields.details),
  };
}

export function parseTemplateFields(fields: Record<string, string | undefined>): TemplateFields {
  const details = parseRideDetails(fields.details);
  return {
    name: required(fields.name, 'Mallnamn'),
    title: required(fields.title, 'Titel'),
    durationMinutes: parseDuration(fields.duration),
    rideType: parseRideType(fields.ride_type),
    description: details.description,
    routeWorld: details.routeWorld,
    paceWorkout: details.paceWorkout,
    notes: details.notes,
  };
}

export function parseTemplateRideFields(
  fields: Record<string, string | undefined>,
  timezone: string,
  now = new Date(),
): { startsAt: Date; zwiftUrl?: string } {
  const dateTime = required(fields.date_time, 'Datum och tid');
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(dateTime);
  if (!match) throw new Error('Datum och tid måste skrivas som ÅÅÅÅ-MM-DD TT:mm.');
  const startsAt = parseLocalRideStart(match[1], match[2], timezone);
  if (startsAt.getTime() < now.getTime() - 60_000) {
    throw new Error('Starttiden måste ligga i framtiden.');
  }
  const rawUrl = fields.zwift_url?.trim();
  const zwiftUrl = rawUrl ? parseRideDetails(`Zwift: ${rawUrl}`).zwiftUrl : undefined;
  return { startsAt, zwiftUrl };
}
