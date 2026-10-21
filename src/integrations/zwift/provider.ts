import { z } from 'zod';

const id = z.string().regex(/^[1-9]\d{0,19}$/);
const text = z.string().min(1).max(200);
const timestamp = z.iso.datetime({ offset: true });
export const provenanceSchema = z.object({
  source: text,
  fetchedAt: timestamp,
  observedAt: timestamp.nullable(),
  confidence: z.enum(['source-reported', 'unknown']),
});
export const eventSchema = z.object({
  eventId: id,
  name: text.nullable(),
  startsAt: timestamp.nullable(),
  durationMinutes: z.number().int().positive().max(1440).nullable(),
  route: text.nullable(),
  world: text.nullable(),
  eventType: text.nullable(),
  provenance: provenanceSchema,
});
export const resultsSchema = z.object({
  eventId: id,
  eventName: text.nullable(),
  startsAt: timestamp.nullable(),
  publishedAt: timestamp.nullable(),
  coverage: z.enum(['partial', 'complete', 'unknown']),
  entries: z
    .array(
      z.object({
        riderId: id,
        displayName: text,
        rank: z.number().int().positive().nullable(),
        category: text.nullable(),
      }),
    )
    .max(10000),
  provenance: provenanceSchema,
});
export const profileSchema = z.object({
  riderId: id,
  // Permission is explicit; an adapter must not infer it from mere visibility.
  visibility: z.enum(['permitted', 'restricted']),
  displayName: text.nullable(),
  country: text.nullable(),
  category: text.nullable(),
  level: z.number().int().nonnegative().nullable(),
  provenance: provenanceSchema,
});

export const operationSchemas = {
  event: eventSchema,
  results: resultsSchema,
  profile: profileSchema,
};
export type Operation = keyof typeof operationSchemas;
export type Data = { [K in Operation]: z.infer<(typeof operationSchemas)[K]> };
export type ZwiftEvent = Data['event'];
export type ZwiftResults = Data['results'];
export type ZwiftProfile = Data['profile'];
export type UnavailableReason =
  | 'disabled'
  | 'unsupported'
  | 'not-found'
  | 'unpublished'
  | 'unavailable'
  | 'timeout'
  | 'rate-limited'
  | 'invalid-data'
  | 'forbidden';
export type Lookup<T> =
  | { status: 'available'; data: T }
  | { status: 'unavailable'; reason: UnavailableReason };

export interface ZwiftProvider {
  readonly name: string;
  readonly access: 'unreviewed' | 'permitted' | 'test-only';
  readonly capabilities: Readonly<
    Record<Operation | 'presence' | 'attendance' | 'identityVerification', boolean>
  >;
  readonly operations: Partial<
    Record<Operation, (id: string, signal: AbortSignal) => Promise<Lookup<unknown>>>
  >;
}

export const noProvider: ZwiftProvider = {
  name: 'none',
  access: 'unreviewed',
  capabilities: {
    event: false,
    results: false,
    profile: false,
    presence: false,
    attendance: false,
    identityVerification: false,
  },
  operations: {},
};

/** Adapters translate upstream retry-after responses without exposing response bodies or secrets. */
export class ZwiftRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Provider rate limit');
  }
}
