import { localTimestamp, safeText } from './presentation.js';
import { profileSchema, type ZwiftProfile } from './provider.js';

export function formatZwiftProfile(input: ZwiftProfile, timezone: string): string {
  const result = profileSchema.safeParse(input);
  if (!result.success) return 'Profiluppgifterna kunde inte valideras.';
  const data = result.data;
  if (data.visibility !== 'permitted') return 'Källan tillåter inte att profilen visas.';
  return [
    `**Zwift-profil ${data.riderId}** – uppslag, inte verifierad kontokoppling`,
    `Namn: ${safeText(data.displayName)}`,
    `Land: ${safeText(data.country, 60)}`,
    `Kategori: ${safeText(data.category, 60)}`,
    `Nivå: ${data.level ?? 'okänd'}`,
    `Källa: ${safeText(data.provenance.source, 80)}`,
    `Hämtad: ${localTimestamp(data.provenance.fetchedAt, timezone)}`,
    `Observerad: ${localTimestamp(data.provenance.observedAt, timezone)}`,
    `Tillstånd: källan tillåter visning för CK UNI-medlemmar. Säkerhet: ${data.provenance.confidence === 'source-reported' ? 'källans uppgift' : 'okänd'}.`,
    'Okända fält är inte tillgängliga/verifierade. Inga kontokopplingar sparas. Närvaro och poäng påverkas inte.',
  ].join('\n');
}
