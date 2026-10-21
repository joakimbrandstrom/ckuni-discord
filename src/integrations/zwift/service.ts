import {
  type Data,
  type Lookup,
  noProvider,
  type Operation,
  operationSchemas,
  type ZwiftProvider,
  ZwiftRateLimitError,
} from './provider.js';
import type { ZwiftSettings } from './settings.js';

type Observation = { provider: string; operation: Operation; outcome: string };
const MAX_CACHE_BYTES = 1024 * 1024;
const MAX_RESPONSE_CACHE_BYTES = 256 * 1024;

/** One bounded cache and request budget per process/provider, shared by every Discord consumer. */
export class ZwiftService {
  private cache = new Map<string, { expires: number; value: Lookup<unknown>; bytes: number }>();
  private cacheBytes = 0;
  private nextRequestAt = 0;
  private failures = 0;
  private busy = false;

  constructor(
    readonly settings: ZwiftSettings,
    readonly provider: ZwiftProvider = noProvider,
    private observe: (event: Observation) => void = () => {},
    private now: () => number = Date.now,
    private allowTestProvider = false,
  ) {}

  private deleteCached(key: string): void {
    const entry = this.cache.get(key);
    if (entry) this.cacheBytes -= entry.bytes;
    this.cache.delete(key);
  }

  supports(operation: Operation): boolean {
    return (
      this.settings.ZWIFT_ENABLED &&
      (this.provider.access === 'permitted' ||
        (this.allowTestProvider && this.provider.access === 'test-only')) &&
      this.provider.capabilities[operation] &&
      Boolean(this.provider.operations[operation])
    );
  }

  async lookup<K extends Operation>(operation: K, id: string): Promise<Lookup<Data[K]>> {
    if (!this.settings.ZWIFT_ENABLED) return { status: 'unavailable', reason: 'disabled' };
    if (!this.supports(operation)) return { status: 'unavailable', reason: 'unsupported' };
    if (!/^[1-9]\d{0,19}$/.test(id)) return { status: 'unavailable', reason: 'invalid-data' };
    const key = `${operation}:${id}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now())
      return structuredClone(cached.value) as Lookup<Data[K]>;
    this.deleteCached(key);
    if (this.busy || this.now() < this.nextRequestAt)
      return { status: 'unavailable', reason: 'rate-limited' };

    this.busy = true;
    this.nextRequestAt = this.now() + this.settings.ZWIFT_MIN_INTERVAL_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let value: Lookup<Data[K]>;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, this.settings.ZWIFT_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this.provider.operations[operation]?.(id, controller.signal),
        timeout,
      ]);
      if (result?.status === 'available') {
        const parsed = operationSchemas[operation].safeParse(result.data);
        if (
          !parsed.success ||
          ('eventId' in parsed.data ? parsed.data.eventId : parsed.data.riderId) !== id ||
          Date.parse(parsed.data.provenance.fetchedAt) > this.now() + 60000
        ) {
          value = { status: 'unavailable', reason: 'invalid-data' };
        } else if ('visibility' in parsed.data && parsed.data.visibility !== 'permitted') {
          value = { status: 'unavailable', reason: 'forbidden' };
        } else {
          value = { status: 'available', data: parsed.data as Data[K] };
        }
      } else {
        // Only known, safe adapter outcomes may cross the provider boundary.
        const reason = result?.reason;
        value = {
          status: 'unavailable',
          reason:
            reason &&
            [
              'not-found',
              'unpublished',
              'unsupported',
              'forbidden',
              'unavailable',
              'rate-limited',
            ].includes(reason)
              ? reason
              : 'invalid-data',
        };
      }
    } catch (error) {
      value = {
        status: 'unavailable',
        reason: controller.signal.aborted
          ? 'timeout'
          : error instanceof ZwiftRateLimitError
            ? 'rate-limited'
            : 'unavailable',
      };
      if (error instanceof ZwiftRateLimitError && Number.isFinite(error.retryAfterMs)) {
        this.nextRequestAt = Math.max(
          this.nextRequestAt,
          this.now() + Math.min(3600000, Math.max(0, error.retryAfterMs)),
        );
      }
    } finally {
      clearTimeout(timer);
      this.busy = false;
    }
    if (value.status === 'available') {
      this.failures = 0;
      // Personal profiles are deliberately not cached or persisted.
      if (operation !== 'profile' && this.settings.ZWIFT_CACHE_TTL_MS > 0) {
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        if (bytes <= MAX_RESPONSE_CACHE_BYTES) {
          while (this.cache.size >= 100 || this.cacheBytes + bytes > MAX_CACHE_BYTES) {
            this.deleteCached(this.cache.keys().next().value as string);
          }
          this.cache.set(key, {
            expires: this.now() + this.settings.ZWIFT_CACHE_TTL_MS,
            value: structuredClone(value),
            bytes,
          });
          this.cacheBytes += bytes;
        }
      }
    } else if (['timeout', 'unavailable', 'rate-limited', 'invalid-data'].includes(value.reason)) {
      this.failures = Math.min(this.failures + 1, 10);
      this.nextRequestAt = Math.max(
        this.nextRequestAt,
        this.now() + Math.min(300000, this.settings.ZWIFT_MIN_INTERVAL_MS * 2 ** this.failures),
      );
    }
    // Log only categorical outcomes, never raw exceptions, URLs, identifiers or personal data.
    try {
      this.observe({
        provider: this.provider.name,
        operation,
        outcome: value.status === 'available' ? 'available' : value.reason,
      });
    } catch {
      /* Observability must not break manual workflows. */
    }
    return value;
  }
}
