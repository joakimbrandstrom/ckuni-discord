import { localTimestamp, safeText } from './presentation.js';
import { resultsSchema, type ZwiftResults } from './provider.js';

/** Keep the source's placements/category scope; never infer a rank or a missing rider's attendance. */
export function formatZwiftResults(input: ZwiftResults, timezone: string): string {
  const parsed = resultsSchema.safeParse(input);
  if (!parsed.success) return 'Resultatuppgifterna kunde inte valideras.';
  const data = parsed.data;
  const riders = new Map<string, ZwiftResults['entries'][number]>();
  for (const entry of data.entries) {
    const existing = riders.get(entry.riderId);
    if (
      existing &&
      (existing.displayName !== entry.displayName ||
        existing.rank !== entry.rank ||
        existing.category !== entry.category)
    ) {
      return 'Källan har motstridiga resultat för samma ryttare. Ingen resultatlista visas.';
    }
    riders.set(entry.riderId, entry);
  }
  const entries = [...riders.values()].sort(
    (a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '', 'sv') ||
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.riderId.localeCompare(b.riderId),
  );
  const lines = [
    `**Zwift-resultat: ${safeText(data.eventName, 100)}** (event ${data.eventId})`,
    `Start: ${localTimestamp(data.startsAt, timezone)}`,
    `Källa: ${safeText(data.provenance.source, 80)}`,
    `Publicerad: ${localTimestamp(data.publishedAt, timezone)}`,
    `Hämtad: ${localTimestamp(data.provenance.fetchedAt, timezone)}`,
    `Täckning: ${{ partial: 'delvis', complete: 'komplett enligt källan', unknown: 'okänd' }[data.coverage]}.`,
  ];
  if (!entries.length) {
    lines.push('Inga publicerade deltagarresultat tillgängliga från källan.');
  } else {
    lines.push(`Visar ${Math.min(10, entries.length)} av ${entries.length} unika synliga ryttare:`);
    for (const entry of entries.slice(0, 10)) {
      lines.push(
        `${entry.rank === null ? 'Placering okänd' : `Plats ${entry.rank}`} · ${safeText(entry.category, 30)} · ${safeText(entry.displayName, 60)}`,
      );
    }
    if (entries.length > 10) lines.push('Fler resultat finns hos källan.');
  }
  lines.push('Resultat är inte CK UNI-närvaro eller poäng. En ryttare som saknas kan ha deltagit.');
  return lines.join('\n');
}
