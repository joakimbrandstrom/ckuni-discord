import assert from 'node:assert/strict';
import test from 'node:test';
import { isRideManager } from '../src/discord/auth.js';
import type { DiscordInteraction } from '../src/discord/types.js';

function makeInteraction(roles: string[]): DiscordInteraction {
  return {
    id: '1',
    type: 2,
    token: 'tok',
    application_id: 'app',
    member: { user: { id: 'u1', username: 'rider' }, roles },
  };
}

const LEADER_ROLE = '111111111111111111';
const ADMIN_ROLE = '222222222222222222';
const OTHER_ROLE = '333333333333333333';

// ── Open mode (no role IDs configured) ─────────────────────────────────────

test('open mode: allows any member when no role IDs are configured', () => {
  const interaction = makeInteraction([]);
  assert.equal(isRideManager(interaction, undefined, undefined), true);
});

test('open mode: allows member with unrelated role when no role IDs are configured', () => {
  const interaction = makeInteraction([OTHER_ROLE]);
  assert.equal(isRideManager(interaction, undefined, undefined), true);
});

// ── Restricted mode ─────────────────────────────────────────────────────────

test('restricted: denies member with no matching roles', () => {
  const interaction = makeInteraction([OTHER_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), false);
});

test('restricted: denies member with empty roles array', () => {
  const interaction = makeInteraction([]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), false);
});

test('restricted: allows Ride Leader role', () => {
  const interaction = makeInteraction([LEADER_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), true);
});

test('restricted: allows Admin role', () => {
  const interaction = makeInteraction([ADMIN_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), true);
});

test('restricted: allows member with both roles', () => {
  const interaction = makeInteraction([LEADER_ROLE, ADMIN_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), true);
});

// ── Only one role ID configured ──────────────────────────────────────────────

test('only leader role configured: allows Ride Leader', () => {
  const interaction = makeInteraction([LEADER_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, undefined), true);
});

test('only leader role configured: denies non-leader', () => {
  const interaction = makeInteraction([OTHER_ROLE]);
  assert.equal(isRideManager(interaction, LEADER_ROLE, undefined), false);
});

test('only admin role configured: allows Admin', () => {
  const interaction = makeInteraction([ADMIN_ROLE]);
  assert.equal(isRideManager(interaction, undefined, ADMIN_ROLE), true);
});

test('only admin role configured: denies non-admin', () => {
  const interaction = makeInteraction([OTHER_ROLE]);
  assert.equal(isRideManager(interaction, undefined, ADMIN_ROLE), false);
});

// ── No member (DM context) ───────────────────────────────────────────────────

test('restricted: denies DM interactions (no member)', () => {
  const interaction: DiscordInteraction = {
    id: '2',
    type: 2,
    token: 'tok',
    application_id: 'app',
    user: { id: 'u1', username: 'rider' },
  };
  assert.equal(isRideManager(interaction, LEADER_ROLE, ADMIN_ROLE), false);
});
