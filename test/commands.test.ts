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

test('ride command exposes the supported subcommands and modal-based create', () => {
  const ride = commandDefinitions.find((command) => command.name === 'ride');
  assert.ok(ride?.options);
  assert.deepEqual(
    ride.options.map((option) => option.name),
    [
      'create',
      'list',
      'edit',
      'cancel',
      'mall-spara',
      'mall-lista',
      'mall-skapa',
      'mall-redigera',
      'mall-inaktivera',
    ],
  );

  const create = ride.options.find((option) => option.name === 'create');
  assert.ok(create);
  assert.equal(create.options, undefined);
});

test('ride cancellation requires a positive integer ride ID', () => {
  const cancel = commandDefinitions
    .find((command) => command.name === 'ride')
    ?.options?.find((option) => option.name === 'cancel');
  assert.deepEqual(cancel?.options, [
    {
      type: 4,
      name: 'id',
      description: 'Pass-ID',
      required: true,
      min_value: 1,
    },
  ]);
});
