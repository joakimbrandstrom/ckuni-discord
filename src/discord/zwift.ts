import { unavailableText } from '../integrations/zwift/presentation.js';
import { formatZwiftProfile } from '../integrations/zwift/profile.js';
import { formatZwiftResults } from '../integrations/zwift/results.js';
import type { ZwiftService } from '../integrations/zwift/service.js';
import { parseZwiftEventUrl } from '../integrations/zwift/url.js';
import type { DiscordInteraction } from './types.js';

export type ZwiftCommandContext = {
  service: ZwiftService;
  guildId: string;
  timezone: string;
  getRide: (id: string) => Promise<{ zwift_url: string | null } | null>;
};

export async function zwiftCommandContent(
  interaction: DiscordInteraction,
  context: ZwiftCommandContext,
): Promise<string> {
  if (interaction.guild_id !== context.guildId || !interaction.member?.user)
    return 'Kommandot måste användas av en medlem på CK UNI-servern.';
  const { service } = context;
  if (!service.settings.ZWIFT_ENABLED) return unavailableText('disabled');
  const sub = interaction.data?.options?.find((option) => option.type === 1);
  if (sub && ['profile', 'privacy', 'unlink', 'link'].includes(sub.name)) {
    if (!service.settings.ZWIFT_PROFILES_ENABLED) return 'Zwift-profiler är avstängda.';
    if (sub.name === 'privacy')
      return 'Endast privata uppslag av fält som källan tillåter. Den här versionen sparar inga Zwift-kontokopplingar och cachar inte profiler. Loggar innehåller inga ryttar-ID:n eller profilfält. Discord och källan har egna lagringsregler. Närvaro och poäng påverkas inte. Kontokoppling kräver framtida verifierat ägarskap; lämna aldrig ditt Zwift-lösenord till boten.';
    if (sub.name === 'unlink')
      return 'Den här versionen sparar inga Zwift-kontokopplingar. Det finns ingen koppling att ta bort. Närvaro och poäng påverkas inte.';
    if (sub.name === 'link')
      return 'Kontokoppling är inte tillgänglig: ägarskap kan inte verifieras. Inget ryttar-ID sparas eller kopplas till ditt Discord-konto.';
    if (!service.supports('profile')) return unavailableText('unsupported');
    const riderId = sub.options?.find((option) => option.name === 'rider')?.value;
    if (typeof riderId !== 'string' || !/^[1-9]\d{0,19}$/.test(riderId))
      return 'Ange ett giltigt numeriskt Zwift-ryttar-ID.';
    const result = await service.lookup('profile', riderId);
    return result.status === 'available'
      ? formatZwiftProfile(result.data, context.timezone)
      : unavailableText(result.reason);
  }
  if (sub?.name !== 'results') return 'Okänt Zwift-underkommando.';
  if (!service.settings.ZWIFT_RESULTS_ENABLED) return 'Zwift-resultat är avstängda.';
  if (!service.supports('results')) return unavailableText('unsupported');
  const options = sub.options ?? [];
  const url = options.find((option) => option.name === 'url')?.value;
  const rideId = options.find((option) => option.name === 'ride')?.value;
  if ((url === undefined) === (rideId === undefined))
    return 'Ange antingen en Zwift-eventlänk eller ett CK UNI-pass-ID.';
  let eventUrl: string;
  if (rideId !== undefined) {
    if (typeof rideId !== 'number' || !Number.isSafeInteger(rideId) || rideId < 1)
      return 'Ogiltigt pass-ID.';
    try {
      const ride = await context.getRide(String(rideId));
      if (!ride?.zwift_url) return 'Passet hittades inte eller saknar en Zwift-eventlänk.';
      eventUrl = ride.zwift_url;
    } catch {
      return 'Passet kunde inte läsas. Försök senare.';
    }
  } else {
    if (typeof url !== 'string') return 'Ogiltig eventlänk.';
    eventUrl = url;
  }
  let eventId: string;
  try {
    eventId = parseZwiftEventUrl(eventUrl).eventId;
  } catch {
    return 'Ange en giltig Zwift-eventlänk, exempel https://www.zwift.com/events/view/123';
  }
  const result = await service.lookup('results', eventId);
  return result.status === 'available'
    ? formatZwiftResults(result.data, context.timezone)
    : unavailableText(result.reason);
}
