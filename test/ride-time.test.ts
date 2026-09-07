import assert from 'node:assert/strict';
import test from 'node:test';
import { nextWeeklyOccurrence, nextWeeklyRideStart } from '../src/rides/time.js';

test('finds the next configured weekday and time in the club timezone', () => {
  const result = nextWeeklyOccurrence(
    2,
    '18:00',
    'Europe/Stockholm',
    new Date('2026-09-06T10:00:00Z'),
  );

  assert.equal(result.toISOString(), '2026-09-08T16:00:00.000Z');
});

test('moves a same-day elapsed template schedule to next week', () => {
  const result = nextWeeklyOccurrence(
    2,
    '18:00',
    'Europe/Stockholm',
    new Date('2026-09-08T17:00:00Z'),
  );

  assert.equal(result.toISOString(), '2026-09-15T16:00:00.000Z');
});

test('copies weekly local time across daylight-saving changes', () => {
  const result = nextWeeklyRideStart(
    new Date('2026-10-20T16:00:00Z'),
    'Europe/Stockholm',
    new Date('2026-10-21T10:00:00Z'),
  );

  assert.equal(result.toISOString(), '2026-10-27T17:00:00.000Z');
});
