import assert from 'node:assert/strict';
import test from 'node:test';
import { modalValues } from '../src/discord/components.js';
import type { DiscordInteraction } from '../src/discord/types.js';

test('parses text and select values from current Discord Label components', () => {
  const interaction = {
    data: {
      components: [
        {
          type: 18,
          component: { type: 4, custom_id: 'title', value: 'Tisdagsintervaller' },
        },
        {
          type: 18,
          component: { type: 3, custom_id: 'ride_type', values: ['intervals'] },
        },
      ],
    },
  } as DiscordInteraction;

  assert.deepEqual(modalValues(interaction), {
    title: 'Tisdagsintervaller',
    ride_type: 'intervals',
  });
});

test('continues to parse legacy Action Row modal submissions', () => {
  const interaction = {
    data: {
      components: [
        {
          type: 1,
          components: [{ type: 4, custom_id: 'title', value: 'Pass' }],
        },
      ],
    },
  } as DiscordInteraction;

  assert.deepEqual(modalValues(interaction), { title: 'Pass' });
});
