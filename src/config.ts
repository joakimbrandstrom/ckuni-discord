import { z } from 'zod';
import { optionalNonEmpty } from './env.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default('info'),
  TIMEZONE: z.string().default('Europe/Stockholm'),
  PUBLIC_BASE_URL: z.string().url().optional(),

  DATABASE_URL: z.string().min(1),

  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_RIDE_LEADER_ROLE_ID: optionalNonEmpty,
  DISCORD_ADMIN_ROLE_ID: optionalNonEmpty,

  STRAVA_CLIENT_ID: optionalNonEmpty,
  STRAVA_CLIENT_SECRET: optionalNonEmpty,
  STRAVA_VERIFY_TOKEN: optionalNonEmpty,
  STRAVA_STATE_SECRET: optionalNonEmpty,
  TOKEN_ENCRYPTION_KEY: optionalNonEmpty,
  STRAVA_API_BASE_URL: z.string().url().default('https://www.strava.com/api/v3'),
});

export const config = schema.parse(process.env);

export type RequiredStravaConfig = {
  clientId: string;
  clientSecret: string;
  verifyToken: string;
  stateSecret: string;
  tokenEncryptionKey: string;
  publicBaseUrl: string;
};

export function getStravaConfig(): RequiredStravaConfig | null {
  const {
    PUBLIC_BASE_URL: publicBaseUrl,
    STRAVA_CLIENT_ID: clientId,
    STRAVA_CLIENT_SECRET: clientSecret,
    STRAVA_VERIFY_TOKEN: verifyToken,
    STRAVA_STATE_SECRET: stateSecret,
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  } = config;

  if (
    !publicBaseUrl ||
    !clientId ||
    !clientSecret ||
    !verifyToken ||
    !stateSecret ||
    !tokenEncryptionKey
  ) {
    return null;
  }

  return { clientId, clientSecret, verifyToken, stateSecret, tokenEncryptionKey, publicBaseUrl };
}

export function requireStravaConfig(): RequiredStravaConfig {
  const stravaConfig = getStravaConfig();
  if (!stravaConfig) throw new Error('Strava integration is not configured');
  return stravaConfig;
}

export function stravaConfigured(): boolean {
  return getStravaConfig() !== null;
}
