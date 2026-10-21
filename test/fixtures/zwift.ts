import {
  noProvider,
  type ZwiftEvent,
  type ZwiftProvider,
} from '../../src/integrations/zwift/provider.js';

export const provenance = {
  source: 'Synthetic test fixture',
  fetchedAt: '2026-01-01T10:00:00Z',
  observedAt: null,
  confidence: 'source-reported' as const,
};
export const event: ZwiftEvent = {
  eventId: '123',
  name: 'CK UNI race',
  startsAt: '2026-10-27T17:00:00Z',
  durationMinutes: 60,
  route: null,
  world: 'Watopia',
  eventType: 'race',
  provenance,
};
export function mockProvider(operations: ZwiftProvider['operations']): ZwiftProvider {
  return {
    ...noProvider,
    name: 'fixture',
    access: 'test-only',
    operations,
    capabilities: {
      ...noProvider.capabilities,
      event: Boolean(operations.event),
      results: Boolean(operations.results),
      profile: Boolean(operations.profile),
    },
  };
}
