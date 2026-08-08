import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalRideStart } from '../src/rides/time.js';

test('parses Stockholm local ride time to UTC', () => {
  const date = parseLocalRideStart('2026-11-10', '19:00', 'Europe/Stockholm');
  assert.equal(date.toISOString(), '2026-11-10T18:00:00.000Z');
});

test('rejects invalid date', () => {
  assert.throws(() => parseLocalRideStart('not-a-date', '19:00', 'Europe/Stockholm'));
});
