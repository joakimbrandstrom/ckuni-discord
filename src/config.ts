import { z } from 'zod';
import { optionalNonEmpty } from './env.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default('info'),
  TIMEZONE: z.string().default('Europe/Stockholm'),

  DATABASE_URL: z.string().min(1),

  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_RIDE_LEADER_ROLE_ID: optionalNonEmpty,
  DISCORD_ADMIN_ROLE_ID: optionalNonEmpty,
  DISCORD_WELCOME_CHANNEL_ID: optionalNonEmpty,
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID: optionalNonEmpty,
  DISCORD_ZWIFT_RIDE_CHANNEL_ID: optionalNonEmpty,
  DISCORD_GENERAL_CHANNEL_ID: optionalNonEmpty,
});

export const config = schema.parse(process.env);
