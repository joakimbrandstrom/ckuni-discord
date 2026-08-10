import { DateTime } from 'luxon';

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
