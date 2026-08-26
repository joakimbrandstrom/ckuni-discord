import assert from 'node:assert/strict';
import test from 'node:test';
import type { WelcomeGateway, WelcomeLogger } from '../src/discord/welcome.js';
import { runApplication } from '../src/lifecycle.js';
import type { ReminderLoop } from '../src/reminders.js';

function createHarness(
  options: { gateway?: WelcomeGateway | null; gatewayError?: Error; closeError?: Error } = {},
) {
  const calls: string[] = [];
  const errors: Array<{ context: Record<string, unknown>; message: string }> = [];
  const signals = new Map<string, () => void>();
  const logger: WelcomeLogger = {
    info: (_context, message) => calls.push(`log:${message}`),
    error: (context, message) => errors.push({ context, message }),
  };
  const processControl: {
    once: (signal: 'SIGTERM' | 'SIGINT', listener: () => void) => void;
    exitCode?: number;
  } = {
    once(signal, listener) {
      signals.set(signal, listener);
    },
  };
  const reminderLoop: ReminderLoop = { stop: async () => undefined };

  return {
    calls,
    errors,
    signals,
    processControl,
    dependencies: {
      app: {
        log: logger,
        async listen(options: { host: string; port: number }) {
          calls.push(`listen:${options.host}:${options.port}`);
        },
        async close() {
          calls.push('close:app');
          if (options.closeError) throw options.closeError;
        },
      },
      config: {
        port: 3000,
        discordBotToken: 'token',
        discordGuildId: 'guild',
        welcomeChannelId: 'welcome',
        announcementsChannelId: 'announcements',
        zwiftRideChannelId: 'zwift',
        generalChannelId: 'general',
      },
      processControl,
      async closePool() {
        calls.push('close:pool');
      },
      startReminderLoop() {
        calls.push('start:reminders');
        return reminderLoop;
      },
      async stopReminderLoop(loop: typeof reminderLoop) {
        assert.equal(loop, reminderLoop);
        calls.push('stop:reminders');
      },
      async startWelcomeGateway(input: { signal: AbortSignal }) {
        calls.push('start:gateway');
        assert.equal(input.signal.aborted, false);
        if (options.gatewayError) throw options.gatewayError;
        return options.gateway === undefined ? { stop: async () => undefined } : options.gateway;
      },
      async stopWelcomeGateway(gateway: WelcomeGateway | null) {
        calls.push(`stop:gateway:${gateway ? 'active' : 'disabled'}`);
      },
    },
  };
}

test('starts the Gateway, reminder loop and HTTP server', async () => {
  const harness = createHarness();
  const lifecycle = await runApplication(harness.dependencies);

  assert.deepEqual(harness.calls, ['start:gateway', 'start:reminders', 'listen:0.0.0.0:3000']);
  assert.deepEqual([...harness.signals.keys()], ['SIGTERM', 'SIGINT']);

  harness.signals.get('SIGTERM')?.();
  await lifecycle.shutdown('test');
  assert.deepEqual(harness.calls.slice(3), [
    'log:Shutting down',
    'stop:gateway:active',
    'stop:reminders',
    'close:app',
    'close:pool',
  ]);
  assert.equal(harness.processControl.exitCode, 0);
});

test('keeps the existing application behavior when the Gateway is disabled', async () => {
  const harness = createHarness({ gateway: null });
  const lifecycle = await runApplication(harness.dependencies);

  harness.signals.get('SIGINT')?.();
  await lifecycle.shutdown('test');
  assert.ok(harness.calls.includes('stop:gateway:disabled'));
});

test('cleans up and exits nonzero when Gateway startup fails', async () => {
  const failure = new Error('Discord unavailable');
  const harness = createHarness({ gatewayError: failure });
  await runApplication(harness.dependencies);

  assert.equal(harness.errors[0]?.message, 'Application failed to start');
  assert.equal(harness.errors[0]?.context.err, failure);
  assert.equal(harness.processControl.exitCode, 1);
  assert.equal(harness.calls.includes('start:reminders'), false);
  assert.equal(harness.calls.includes('listen:0.0.0.0:3000'), false);
  assert.ok(harness.calls.includes('close:app'));
  assert.ok(harness.calls.includes('close:pool'));
});

test('continues cleanup and exits nonzero when a resource fails to close', async () => {
  const failure = new Error('Fastify close failed');
  const harness = createHarness({ closeError: failure });
  const lifecycle = await runApplication(harness.dependencies);
  await lifecycle.shutdown('test');

  assert.equal(harness.errors[0]?.message, 'Failed to shut down resource');
  assert.equal(harness.errors[0]?.context.err, failure);
  assert.equal(harness.errors[0]?.context.resource, 'Fastify');
  assert.ok(harness.calls.includes('close:pool'));
  assert.equal(harness.processControl.exitCode, 1);
});
