import { parseZwiftEventUrl } from '../integrations/zwift/url.js';
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

export type TemplateFields = Omit<CreateRideFields, 'startsAt' | 'zwiftUrl'> & {
  name: string;
  defaultWeekday?: number;
  defaultStartTime?: string;
  quickCreate: boolean;
  sortOrder: number;
};

const WEEKDAYS: Record<string, number> = {
  måndag: 1,
  monday: 1,
  tisdag: 2,
  tuesday: 2,
  onsdag: 3,
  wednesday: 3,
  torsdag: 4,
  thursday: 4,
  fredag: 5,
  friday: 5,
  lördag: 6,
  saturday: 6,
  söndag: 7,
  sunday: 7,
};

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} måste anges.`);
  return trimmed;
}

export function parseDuration(value: string | undefined): number {
  const duration = Number(required(value, 'Längd'));
  if (!Number.isInteger(duration) || duration < 15 || duration > 600) {
    throw new Error('Längden måste vara ett heltal mellan 15 och 600 minuter.');
  }
  return duration;
}

export function parseRideType(value: string | undefined): RideType {
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

function parseFutureStart(value: string | undefined, timezone: string, now: Date): Date {
  const dateTime = required(value, 'Datum och tid');
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(dateTime);
  if (!match) throw new Error('Datum och tid måste skrivas som ÅÅÅÅ-MM-DD TT:mm.');

  const startsAt = parseLocalRideStart(match[1], match[2], timezone);
  if (startsAt.getTime() <= now.getTime()) {
    throw new Error('Starttiden måste ligga i framtiden.');
  }
  return startsAt;
}

function parseSeparateFutureStart(
  dateValue: string | undefined,
  timeValue: string | undefined,
  timezone: string,
  now: Date,
): Date {
  const date = required(dateValue, 'Datum');
  const time = required(timeValue, 'Tid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Datum måste skrivas som ÅÅÅÅ-MM-DD.');
  }
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Tid måste skrivas som TT:mm.');
  const startsAt = parseLocalRideStart(date, time, timezone);
  if (startsAt.getTime() <= now.getTime()) throw new Error('Starttiden måste ligga i framtiden.');
  return startsAt;
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function parseHttpUrl(value: string | undefined): string | undefined {
  const trimmed = optional(value);
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Zwift-länken är inte en giltig webbadress.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Zwift-länken måste börja med http:// eller https://.');
  }
  return trimmed;
}

/** Enabled-integration input policy: canonical new links, but allow unchanged legacy values. */
export function normalizeZwiftRideUrl(
  value: string | undefined,
  previous: string | null,
): string | undefined {
  const trimmed = optional(value);
  if (!trimmed) return undefined;
  try {
    return parseZwiftEventUrl(trimmed).url;
  } catch (error) {
    if (trimmed === previous?.trim()) return trimmed;
    throw error;
  }
}

export function parseRideBasicFields(
  fields: Record<string, string | undefined>,
  timezone: string,
  now = new Date(),
): Pick<CreateRideFields, 'title' | 'startsAt' | 'durationMinutes' | 'rideType'> {
  return {
    title: required(fields.title, 'Titel'),
    startsAt: parseSeparateFutureStart(fields.date, fields.time, timezone, now),
    durationMinutes: parseDuration(fields.duration),
    rideType: parseRideType(fields.ride_type),
  };
}

export function parseRideScheduleFields(
  fields: Record<string, string | undefined>,
  timezone: string,
  now = new Date(),
): { startsAt: Date; zwiftUrl?: string; extraComment?: string } {
  return {
    startsAt: parseSeparateFutureStart(fields.date, fields.time, timezone, now),
    zwiftUrl: parseHttpUrl(fields.zwift_url),
    extraComment: optional(fields.extra_comment),
  };
}

export function parseRideDetailFields(fields: Record<string, string | undefined>): {
  description?: string;
  zwiftUrl?: string;
  routeWorld?: string;
  paceWorkout?: string;
  notes?: string;
} {
  const details = {
    zwiftUrl: parseHttpUrl(fields.zwift_url),
    description: optional(fields.description),
    routeWorld: optional(fields.route_world),
    paceWorkout: optional(fields.pace_workout),
    notes: optional(fields.notes),
  };
  if (Object.values(details).filter(Boolean).join('\n').length > 3500) {
    throw new Error('Passuppgifterna är för långa. Korta ned detaljerna.');
  }
  return details;
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
  const urlValue = parseHttpUrl(fields.zwift?.join(' '));

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
  const startsAt = parseFutureStart(fields.date_time, timezone, now);

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
  let defaultWeekday: number | undefined;
  let defaultStartTime: string | undefined;
  let quickCreate = false;
  let sortOrder = 0;
  const detailLines: string[] = [];
  for (const line of fields.details?.split('\n') ?? []) {
    const schedule = /^Veckotid:\s*(\S+)\s+(\d{2}:\d{2})\s*$/i.exec(line);
    if (schedule) {
      defaultWeekday = WEEKDAYS[schedule[1].toLowerCase()];
      if (!defaultWeekday || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule[2])) {
        throw new Error('Veckotid måste skrivas som exempelvis tisdag 18:00.');
      }
      defaultStartTime = schedule[2];
      continue;
    }
    if (/^Veckotid:/i.test(line)) {
      throw new Error('Veckotid måste skrivas som exempelvis tisdag 18:00.');
    }
    const quick = /^Snabbval:\s*(ja|nej|\d+)\s*$/i.exec(line);
    if (quick) {
      quickCreate = quick[1].toLowerCase() !== 'nej';
      sortOrder = /^\d+$/.test(quick[1]) ? Number(quick[1]) : 0;
      if (sortOrder > 999) throw new Error('Snabbvalets ordning måste vara mellan 0 och 999.');
      continue;
    }
    if (/^Snabbval:/i.test(line)) {
      throw new Error('Snabbval måste vara ja, nej eller ett ordningsnummer.');
    }
    detailLines.push(line);
  }
  const details = parseRideDetails(detailLines.join('\n'));
  return {
    name: required(fields.name, 'Mallnamn'),
    title: required(fields.title, 'Titel'),
    durationMinutes: parseDuration(fields.duration),
    rideType: parseRideType(fields.ride_type),
    description: details.description,
    routeWorld: details.routeWorld,
    paceWorkout: details.paceWorkout,
    notes: details.notes,
    defaultWeekday,
    defaultStartTime,
    quickCreate,
    sortOrder,
  };
}

export function parseTemplateRideFields(
  fields: Record<string, string | undefined>,
  timezone: string,
  now = new Date(),
): { startsAt: Date; zwiftUrl?: string } {
  const startsAt = parseFutureStart(fields.date_time, timezone, now);
  const rawUrl = fields.zwift_url?.trim();
  const zwiftUrl = rawUrl ? parseRideDetails(`Zwift: ${rawUrl}`).zwiftUrl : undefined;
  return { startsAt, zwiftUrl };
}
