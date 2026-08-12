import assert from 'node:assert/strict';
import test from 'node:test';
import { reminderMessage } from '../src/rides/reminder-message.js';
import { needs24hReminder, needs30mReminder } from '../src/rides/reminder-thresholds.js';

test('reminder messages are Swedish', () => {
  const ride = { title: 'Tisdagspasset', starts_at: new Date('2026-08-12T18:00:00Z') };
  assert.match(reminderMessage(ride, '24h', 'UTC'), /börjar i morgon/);
  assert.match(reminderMessage(ride, '30m', 'UTC'), /börjar om 30 minuter/);
});

// ── 24h reminder ────────────────────────────────────────────────────────────

test('24h reminder: fires when 24h threshold just passed (23:59 minutes until start)', () => {
  assert.equal(needs24hReminder(false, 23 * 60 + 59), true);
});

test('24h reminder: fires at exactly 1 minute until start (catch-up after downtime)', () => {
  assert.equal(needs24hReminder(false, 1), true);
});

test('24h reminder: does not fire if already sent', () => {
  assert.equal(needs24hReminder(true, 23 * 60), false);
});

test('24h reminder: does not fire when ride starts in more than 24h', () => {
  assert.equal(needs24hReminder(false, 24 * 60 + 1), false);
});

test('24h reminder: does not fire when ride has already started (minutes <= 0)', () => {
  assert.equal(needs24hReminder(false, 0), false);
  assert.equal(needs24hReminder(false, -5), false);
});

// ── 30m reminder ────────────────────────────────────────────────────────────

test('30m reminder: fires when 30m threshold just passed (29 minutes until start)', () => {
  assert.equal(needs30mReminder(false, 29), true);
});

test('30m reminder: fires at 1 minute until start (catch-up after downtime)', () => {
  assert.equal(needs30mReminder(false, 1), true);
});

test('30m reminder: does not fire if already sent', () => {
  assert.equal(needs30mReminder(true, 15), false);
});

test('30m reminder: does not fire when ride starts in more than 30 minutes', () => {
  assert.equal(needs30mReminder(false, 31), false);
});

test('30m reminder: does not fire when ride has already started (minutes <= 0)', () => {
  assert.equal(needs30mReminder(false, 0), false);
  assert.equal(needs30mReminder(false, -1), false);
});

// ── Interaction between the two reminders ──────────────────────────────────

test('both reminders fire when bot restarts with 10 minutes until start and neither sent', () => {
  assert.equal(needs24hReminder(false, 10), true);
  assert.equal(needs30mReminder(false, 10), true);
});
