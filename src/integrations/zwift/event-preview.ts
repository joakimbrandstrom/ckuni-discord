import { localTimestamp, safeText, unavailableText } from './presentation.js';
import type { ZwiftService } from './service.js';
import { parseZwiftEventUrl } from './url.js';

type ProposedRide = {
  title: string | null;
  starts_at: Date | null;
  duration_minutes: number | null;
};

/** Suggestions are read-only: publication always uses the leader's editable draft values. */
export async function zwiftEventPreview(
  url: string | null,
  proposed: ProposedRide,
  service: ZwiftService,
  timezone: string,
): Promise<Record<string, string> | null> {
  if (!service.settings.ZWIFT_ENABLED || !url) return null;
  let eventId: string;
  try {
    eventId = parseZwiftEventUrl(url).eventId;
  } catch {
    return {
      title: 'Zwift-kontroll',
      description: 'Länken stöds inte. Redigera detaljerna eller fortsätt med manuella uppgifter.',
    };
  }
  const result = await service.lookup('event', eventId);
  if (result.status === 'unavailable') {
    return {
      title: 'Zwift-kontroll',
      description: `${unavailableText(result.reason)} Uppgifterna är inte verifierade. Du kan publicera manuellt.`,
    };
  }
  const data = result.data;
  const warnings: string[] = [];
  if (
    data.name &&
    proposed.title &&
    data.name.trim().toLowerCase() !== proposed.title.trim().toLowerCase()
  )
    warnings.push('Titeln skiljer sig.');
  if (
    data.startsAt &&
    proposed.starts_at &&
    Date.parse(data.startsAt) !== new Date(proposed.starts_at).getTime()
  )
    warnings.push('Starttiden skiljer sig.');
  if (
    data.durationMinutes !== null &&
    proposed.duration_minutes !== null &&
    data.durationMinutes !== proposed.duration_minutes
  )
    warnings.push('Längden skiljer sig.');
  const lines = [
    `Källa: ${safeText(data.provenance.source, 80)} · event ${data.eventId}`,
    `Hämtad: ${localTimestamp(data.provenance.fetchedAt, timezone)}`,
    `Observerad: ${localTimestamp(data.provenance.observedAt, timezone)}`,
    `Säkerhet: ${data.provenance.confidence === 'source-reported' ? 'källans uppgift, inte oberoende verifierad' : 'okänd'}`,
    `Titel: ${safeText(data.name)}`,
    `Start: ${localTimestamp(data.startsAt, timezone)}`,
    `Längd: ${data.durationMinutes === null ? 'okänd' : `${data.durationMinutes} min`}`,
    `Rutt/värld: ${safeText(data.route, 80)} / ${safeText(data.world, 80)}`,
    `Typ: ${safeText(data.eventType, 80)}`,
    warnings.length ? `⚠ ${warnings.join(' ')}` : 'Inga avvikelser i tillgängliga jämförbara fält.',
    'Förslag ändrar inget automatiskt. Okända fält är inte verifierade. Använd Redigera före Publicera.',
  ];
  return { title: 'Zwift – källans eventuppgifter', description: lines.join('\n').slice(0, 1500) };
}
