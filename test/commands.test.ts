import assert from 'node:assert/strict';
import test from 'node:test';
import { commands } from '../src/discord/commands.js';

type CommandOption = {
  name: string;
  type: number;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  choices?: Array<{ name: string; value: string }>;
  options?: CommandOption[];
};

type Command = {
  name: string;
  options?: CommandOption[];
};

const commandDefinitions = commands as Command[];

test('Discord command names are unique and include the supported commands', () => {
  const names = commandDefinitions.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ['ping', 'ride', 'strava', 'leaderboard']);
});

test('ride command exposes the supported subcommands and typed create options', () => {
  const ride = commandDefinitions.find((command) => command.name === 'ride');
  assert.ok(ride?.options);
  assert.deepEqual(
    ride.options.map((option) => option.name),
    ['create', 'list', 'cancel'],
  );

  const create = ride.options.find((option) => option.name === 'create');
  assert.ok(create?.options);
  assert.deepEqual(
    create.options.map(({ name, type, required }) => ({ name, type, required })),
    [
      { name: 'title', type: 3, required: true },
      { name: 'date', type: 3, required: true },
      { name: 'time', type: 3, required: true },
      { name: 'duration', type: 4, required: true },
      { name: 'type', type: 3, required: true },
      { name: 'zwift_url', type: 3, required: false },
      { name: 'description', type: 3, required: false },
    ],
  );

  const duration = create.options.find((option) => option.name === 'duration');
  assert.deepEqual({ min: duration?.min_value, max: duration?.max_value }, { min: 15, max: 600 });
  const rideType = create.options.find((option) => option.name === 'type');
  assert.deepEqual(
    rideType?.choices?.map((choice) => choice.value),
    ['social', 'intervals', 'endurance', 'race', 'outdoor'],
  );
});

test('ride cancellation requires a positive integer ride ID', () => {
  const cancel = commandDefinitions
    .find((command) => command.name === 'ride')
    ?.options?.find((option) => option.name === 'cancel');
  assert.deepEqual(cancel?.options, [
    {
      type: 4,
      name: 'id',
      description: 'Ride ID',
      required: true,
      min_value: 1,
    },
  ]);
});
