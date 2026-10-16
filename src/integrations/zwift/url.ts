export type ZwiftEventReference = { eventId: string; url: string };

/** Parse locally; never follow redirects or fetch a user-supplied URL. */
export function parseZwiftEventUrl(input: string): ZwiftEventReference {
  const invalid = () =>
    new Error('Ange en giltig Zwift-länk: https://www.zwift.com/events/view/123');
  if (input.length > 500 || /[\\\s]/u.test(input.trim())) throw invalid();
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== 'https:' ||
    !['www.zwift.com', 'zwift.com', 'companion.zwift.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw invalid();
  const match = /^\/events\/(?:view\/)?([1-9]\d{0,19})\/?$/.exec(url.pathname);
  if (!match) throw invalid();
  return { eventId: match[1], url: `https://www.zwift.com/events/view/${match[1]}` };
}
