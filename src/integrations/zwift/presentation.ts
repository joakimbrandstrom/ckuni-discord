import { DateTime } from 'luxon';
import type { UnavailableReason } from './provider.js';

/** Provider strings are data, never Discord mentions, links or formatting instructions. */
export function safeText(value: string | null, limit = 120): string {
  return value === null
    ? 'okänt'
    : value.replace(/[\p{Cc}\p{Cf}@<>`*_~|\\[\]()]/gu, '').slice(0, limit);
}

export function localTimestamp(value: string | null, timezone: string): string {
  if (!value) return 'okänd';
  const time = DateTime.fromISO(value, { setZone: true }).setZone(timezone);
  return time.isValid ? time.toFormat('yyyy-MM-dd HH:mm ZZ') : 'okänd';
}

export function unavailableText(reason: UnavailableReason): string {
  const messages: Record<UnavailableReason, string> = {
    disabled: 'Zwift-integrationen är avstängd.',
    unsupported: 'Ingen godkänd källa stöder den här uppgiften.',
    'not-found': 'Källan hittade inga uppgifter.',
    unpublished: 'Resultaten är inte publicerade ännu.',
    unavailable: 'Källan är tillfälligt otillgänglig. Försök senare.',
    timeout: 'Källan svarade inte i tid. Försök senare.',
    'rate-limited': 'Källans anropsgräns är nådd. Försök senare.',
    'invalid-data': 'Källans uppgifter kunde inte valideras.',
    forbidden: 'Källan tillåter inte att dessa uppgifter visas.',
  };
  return messages[reason];
}
