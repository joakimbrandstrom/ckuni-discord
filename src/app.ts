import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { registerDiscordInteractions } from './discord/interactions.js';
import { registerStravaRoutes } from './strava/routes.js';

export type AppOptions = {
  readinessCheck?: () => Promise<unknown>;
};

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const readinessCheck = options.readinessCheck ?? (() => pool.query('SELECT 1'));

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    try {
      const rawBody = (body as Buffer).toString('utf8');
      (request as typeof request & { rawBody?: string }).rawBody = rawBody;
      done(null, rawBody.length ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await readinessCheck();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not-ready' });
    }
  });

  await registerDiscordInteractions(app);
  await registerStravaRoutes(app);
  return app;
}
