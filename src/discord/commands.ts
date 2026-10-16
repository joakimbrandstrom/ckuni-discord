export const commands = [
  {
    name: 'ping',
    description: 'Kontrollera att CK UNI-boten är online',
  },
  {
    name: 'ride',
    description: 'Skapa och hantera CK UNI-pass',
    options: [
      {
        type: 1,
        name: 'create',
        description: 'Skapa ett CK UNI-pass',
      },
      { type: 1, name: 'list', description: 'Visa kommande CK UNI-pass' },
      {
        type: 1,
        name: 'edit',
        description: 'Redigera ett kommande CK UNI-pass',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Pass-ID',
            required: true,
            min_value: 1,
          },
        ],
      },
      {
        type: 1,
        name: 'cancel',
        description: 'Ställ in ett pass som du har skapat',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Pass-ID',
            required: true,
            min_value: 1,
          },
        ],
      },
      { type: 1, name: 'mall-spara', description: 'Spara en ny återanvändbar passmall' },
      { type: 1, name: 'mall-lista', description: 'Visa sparade passmallar' },
      {
        type: 1,
        name: 'mall-skapa',
        description: 'Skapa nästa pass från en mall',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Mall-ID',
            required: true,
            min_value: 1,
          },
        ],
      },
      {
        type: 1,
        name: 'mall-redigera',
        description: 'Redigera en passmall',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Mall-ID',
            required: true,
            min_value: 1,
          },
        ],
      },
      {
        type: 1,
        name: 'mall-inaktivera',
        description: 'Inaktivera en passmall',
        options: [
          {
            type: 4,
            name: 'id',
            description: 'Mall-ID',
            required: true,
            min_value: 1,
          },
        ],
      },
    ],
  },
  {
    name: 'leaderboard',
    description: 'Visa CK UNI:s deltagartabell',
  },
];

export function commandsWithZwift(features: { results: boolean }): unknown[] {
  if (!features.results) return commands;
  return [
    ...commands,
    {
      name: 'zwift',
      description: 'Valfria Zwift-uppgifter från godkända källor',
      options: [
        {
          type: 1,
          name: 'results',
          description: 'Visa tillgängliga tävlingsresultat (inte CK UNI-närvaro)',
          options: [
            { type: 3, name: 'url', description: 'Zwift-eventlänk', max_length: 500 },
            {
              type: 4,
              name: 'ride',
              description: 'CK UNI-pass-ID (ange länk eller pass-ID)',
              min_value: 1,
            },
          ],
        },
      ],
    },
  ];
}
