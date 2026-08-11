import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runDiscordBackgroundTask,
  waitForDiscordBackgroundTasks,
} from '../src/discord/background.js';

test('tracks Discord background work until deterministic completion', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed = false;
  runDiscordBackgroundTask(async () => {
    await gate;
    completed = true;
  });

  const waiting = waitForDiscordBackgroundTasks();
  assert.equal(completed, false);
  release?.();
  await waiting;
  assert.equal(completed, true);
});
