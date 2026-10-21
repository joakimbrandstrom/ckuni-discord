import { z } from 'zod';

export const zwiftSettingsSchema = z.object({
  ZWIFT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // No live provider has passed the access review. Mock providers are injection-only in tests.
  ZWIFT_PROVIDER: z.literal('none').default('none'),
  ZWIFT_RESULTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ZWIFT_PROFILES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ZWIFT_TIMEOUT_MS: z.coerce.number().int().min(10).max(1500).default(1000),
  ZWIFT_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300000).default(60000),
  ZWIFT_MIN_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(5000),
});

export type ZwiftSettings = z.output<typeof zwiftSettingsSchema>;
