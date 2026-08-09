import { z } from 'zod';

/**
 * Docker Compose/.env files represent an unset optional value as an empty
 * string (FOO=). Convert that to undefined before Zod validates it so
 * optional integrations can genuinely be left unconfigured.
 */
export function blankToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export const optionalNonEmpty = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).optional()
);
