import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';

process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
process.env.DISCORD_APPLICATION_ID = 'application';
process.env.DISCORD_PUBLIC_KEY = '00'.repeat(32);
process.env.DISCORD_BOT_TOKEN = 'token';
process.env.DISCORD_GUILD_ID = 'guild';

const { createReminderLoop, createReminderTick, stopReminderLoop } = await import(
  '../src/reminders.js'
);

function controlledLoop(work: () => Promise<void>, errors: unknown[] = []) {
  let scheduled: (() => void) | undefined;
  let cancelled = false;
  const loop = createReminderLoop(work, {
    schedule(callback) {
      scheduled = callback;
      return {} as NodeJS.Timeout;
    },
    cancel() {
      cancelled = true;
    },
    onError(error) {
      errors.push(error);
    },
  });
  return { loop, runScheduled: () => scheduled?.(), wasCancelled: () => cancelled };
}

test('starts immediately and prevents overlapping reminder ticks', async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const work = () => {
    calls += 1;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const controlled = controlledLoop(work);

  await flush();
  assert.equal(calls, 1);
  controlled.runScheduled();
  controlled.runScheduled();
  await flush();
  assert.equal(calls, 1);

  release?.();
  await stopReminderLoop(controlled.loop);
});

test('stop waits for in-flight work and cancels future ticks', async () => {
  let release: (() => void) | undefined;
  const controlled = controlledLoop(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await flush();

  let stopped = false;
  const stopping = stopReminderLoop(controlled.loop).then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(controlled.wasCancelled(), true);
  assert.equal(stopped, false);

  release?.();
  await stopping;
  assert.equal(stopped, true);
});

test('handles a failed tick and can still shut down without rejecting', async () => {
  const failure = new Error('Discord unavailable');
  const errors: unknown[] = [];
  const controlled = controlledLoop(async () => {
    throw failure;
  }, errors);

  await flush();
  await stopReminderLoop(controlled.loop);
  assert.deepEqual(errors, [failure]);
  assert.equal(controlled.wasCancelled(), true);
});

test('continues with a later scheduled tick after a handled failure', async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const controlled = controlledLoop(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
  }, errors);

  await flush();
  controlled.runScheduled();
  await flush();
  await stopReminderLoop(controlled.loop);
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
});

test('a broken error reporter cannot turn a tick failure into a rejected shutdown', async () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => logged.push(values);
  try {
    const loop = createReminderLoop(
      async () => {
        throw new Error('tick failure');
      },
      {
        schedule: () => ({}) as NodeJS.Timeout,
        cancel: () => undefined,
        onError: () => {
          throw new Error('logger failure');
        },
      },
    );
    await flush();
    await stopReminderLoop(loop);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /Kunde inte logga/);
  } finally {
    console.error = originalError;
  }
});

test('orchestrates unsent 24-hour and 30-minute reminders once each', async () => {
  const now = Date.parse('2026-08-12T18:00:00Z');
  const sent: Array<{ channel: string; content: string }> = [];
  const updates: string[] = [];
  const tick = createReminderTick({
    timezone: 'UTC',
    now: () => now,
    async send(channel, payload) {
      sent.push({ channel, content: (payload as { content: string }).content });
      return 'message';
    },
    async query(sql: string) {
      if (sql.includes('SELECT')) {
        return {
          rows: [
            {
              id: '42',
              title: 'Kvällspasset',
              starts_at: new Date(now + 10 * 60_000),
              discord_channel_id: 'rides',
              reminder_24h_sent: false,
              reminder_30m_sent: false,
            },
          ],
        };
      }
      updates.push(sql);
      return { rows: [] };
    },
  });

  await tick();
  assert.equal(sent.length, 2);
  assert.match(sent[0].content, /i morgon/);
  assert.match(sent[1].content, /om 30 minuter/);
  assert.equal(updates.length, 2);
  assert.match(updates[0], /reminder_24h_sent/);
  assert.match(updates[1], /reminder_30m_sent/);
});

test('does not send reminders whose persisted flags are already set', async () => {
  let sends = 0;
  const now = Date.parse('2026-08-12T18:00:00Z');
  const tick = createReminderTick({
    timezone: 'UTC',
    now: () => now,
    async send() {
      sends += 1;
      return null;
    },
    async query() {
      return {
        rows: [
          {
            id: '42',
            title: 'Pass',
            starts_at: new Date(now + 10 * 60_000),
            discord_channel_id: 'rides',
            reminder_24h_sent: true,
            reminder_30m_sent: true,
          },
        ],
      };
    },
  });

  await tick();
  assert.equal(sends, 0);
});
