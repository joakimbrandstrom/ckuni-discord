import type { FastifyInstance } from 'fastify';
import { config, stravaConfigured } from '../config.js';
import { exchangeCode, handleActivityWebhook, saveConnection, disconnectAthlete } from './service.js';
import { signState, verifyState } from './state.js';

export function createStravaConnectUrl(discordId: string): string | null {
  if (!stravaConfigured()) return null;
  const state = signState(
    { discordId, exp: Math.floor(Date.now() / 1000) + 10 * 60 },
    config.STRAVA_STATE_SECRET!
  );
  return `${config.PUBLIC_BASE_URL}/strava/oauth?state=${encodeURIComponent(state)}`;
}

export async function registerStravaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/strava/oauth', async (request, reply) => {
    if (!stravaConfigured()) return reply.code(503).send({ error: 'Strava integration is not configured' });
    const { state } = request.query as { state?: string };
    if (!state) return reply.code(400).send({ error: 'Missing state' });
    try {
      verifyState(state, config.STRAVA_STATE_SECRET!);
    } catch {
      return reply.code(400).send({ error: 'Invalid or expired state' });
    }

    const redirectUri = `${config.PUBLIC_BASE_URL}/strava/oauth/callback`;
    const url = new URL('https://www.strava.com/oauth/authorize');
    url.searchParams.set('client_id', config.STRAVA_CLIENT_ID!);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', 'read,activity:read');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/strava/oauth/callback', async (request, reply) => {
    if (!stravaConfigured()) return reply.code(503).send('Strava integration is not configured');
    const query = request.query as { state?: string; code?: string; error?: string };
    if (query.error) return reply.code(400).send(`Strava authorization failed: ${query.error}`);
    if (!query.state || !query.code) return reply.code(400).send('Missing state or code');

    const state = verifyState(query.state, config.STRAVA_STATE_SECRET!);
    const token = await exchangeCode(query.code);
    await saveConnection(state.discordId, token);
    return reply.type('text/html').send(
      '<!doctype html><meta charset="utf-8"><title>CK UNI</title><h1>Strava connected ✅</h1><p>You can close this window and return to Discord.</p>'
    );
  });

  app.get('/strava/webhook', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === config.STRAVA_VERIFY_TOKEN &&
      query['hub.challenge']
    ) {
      return reply.send({ 'hub.challenge': query['hub.challenge'] });
    }
    return reply.code(403).send({ error: 'Webhook verification failed' });
  });

  app.post('/strava/webhook', async (request, reply) => {
    const event = request.body as {
      object_type?: string;
      object_id?: number;
      aspect_type?: string;
      owner_id?: number;
      updates?: Record<string, unknown>;
    };

    reply.code(200).send();

    setImmediate(() => {
      if (event.object_type === 'activity' && event.aspect_type === 'create' && event.owner_id && event.object_id) {
        void handleActivityWebhook(event.owner_id, event.object_id).catch((error) => app.log.error(error));
      }
      if (event.object_type === 'athlete' && event.aspect_type === 'update' && event.owner_id && event.updates?.authorized === 'false') {
        void disconnectAthlete(event.owner_id).catch((error) => app.log.error(error));
      }
    });
  });
}
