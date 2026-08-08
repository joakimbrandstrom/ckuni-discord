import { createHmac, timingSafeEqual } from 'node:crypto';

export type StravaState = { discordId: string; exp: number };

export function signState(payload: StravaState, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyState(value: string, secret: string): StravaState {
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new Error('Invalid state');
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Invalid state signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StravaState;
  if (!payload.discordId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired or invalid state');
  }
  return payload;
}
