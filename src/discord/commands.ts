export const commands = [
  {
    name: 'ping',
    description: 'Check that CK UNI Bot is online',
  },
  {
    name: 'ride',
    description: 'Create and manage CK UNI rides',
    options: [
      {
        type: 1,
        name: 'create',
        description: 'Create a CK UNI ride',
        options: [
          { type: 3, name: 'title', description: 'Ride title', required: true },
          {
            type: 3,
            name: 'date',
            description: 'Date as YYYY-MM-DD',
            required: true,
          },
          {
            type: 3,
            name: 'time',
            description: 'Local time as HH:mm',
            required: true,
          },
          {
            type: 4,
            name: 'duration',
            description: 'Duration in minutes',
            required: true,
            min_value: 15,
            max_value: 600,
          },
          {
            type: 3,
            name: 'type',
            description: 'Ride type',
            required: true,
            choices: [
              { name: 'Social', value: 'social' },
              { name: 'Intervals', value: 'intervals' },
              { name: 'Endurance', value: 'endurance' },
              { name: 'Race', value: 'race' },
              { name: 'Outdoor', value: 'outdoor' },
            ],
          },
          {
            type: 3,
            name: 'zwift_url',
            description: 'Optional Zwift event URL',
            required: false,
          },
          {
            type: 3,
            name: 'description',
            description: 'Optional details',
            required: false,
          },
        ],
      },
      { type: 1, name: 'list', description: 'List upcoming CK UNI rides' },
      {
        type: 1,
        name: 'cancel',
        description: 'Cancel a ride you created',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Ride ID',
            required: true,
            min_value: 1,
          },
        ],
      },
    ],
  },
  {
    name: 'strava',
    description: 'Connect optional Strava activity data',
    options: [{ type: 1, name: 'connect', description: 'Connect your Strava account' }],
  },
  {
    name: 'leaderboard',
    description: 'Show CK UNI participation leaderboard',
  },
];
