import { DateTime } from 'luxon';

function localTimeParts(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) throw new Error('Starttiden måste skrivas som TT:mm.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Starttiden måste skrivas som TT:mm.');
  return { hour, minute };
}

export function parseLocalRideStart(date: string, time: string, zone: string): Date {
  const value = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', {
    zone,
    setZone: true,
  });
  if (!value.isValid) {
    throw new Error('Invalid date/time. Use YYYY-MM-DD and HH:mm.');
  }
  return value.toUTC().toJSDate();
}

export function nextWeeklyOccurrence(
  weekday: number,
  time: string,
  zone: string,
  now = new Date(),
): Date {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error('Veckodagen måste vara mellan 1 och 7.');
  }
  const { hour, minute } = localTimeParts(time);
  const localNow = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(zone);
  let occurrence = localNow
    .startOf('week')
    .plus({ days: weekday - 1 })
    .set({ hour, minute, second: 0, millisecond: 0 });
  if (occurrence <= localNow) occurrence = occurrence.plus({ weeks: 1 });
  return occurrence.toUTC().toJSDate();
}

export function nextWeeklyRideStart(previousStart: Date, zone: string, now = new Date()): Date {
  const localNow = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(zone);
  let occurrence = DateTime.fromJSDate(previousStart, { zone: 'utc' })
    .setZone(zone)
    .plus({ weeks: 1 });
  while (occurrence <= localNow) occurrence = occurrence.plus({ weeks: 1 });
  return occurrence.toUTC().toJSDate();
}
