import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { redactedConfig } from '@botforge/core';
import { botCatalog, requiredEnvKeys, templateCategories } from '@botforge/bot-templates';
import { assertScope, authenticate } from '../plugins/auth';
import type { AppContext } from '../context';

export async function registerSystemRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/health', async () => {
    const storageOk = await context.storage.ping();
    const pending = await context.storage.jobs.countPending();
    return {
      status: storageOk ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - context.startedAt) / 1000),
      queue: { pending },
      storage: { driver: context.storage.driver, ok: storageOk },
      bots: { loaded: context.manager.loadedCount },
      version: '1.0.0',
    };
  });

  app.get('/api/system/stats', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [bots, admins, pending, recentEvents] = await Promise.all([
      context.storage.bots.count(),
      context.storage.admins.count(),
      context.storage.jobs.countPending(),
      context.storage.events.recent(15),
    ]);
    const botList = await context.storage.bots.list({ pageSize: 100 });
    let users = 0;
    let messages24h = 0;
    for (const bot of botList.items) {
      users += await context.storage.users.count(bot.id);
      messages24h += await context.storage.messages.countSince(bot.id, dayAgo);
    }
    return {
      bots,
      admins,
      users,
      messages24h,
      jobsPending: pending,
      templates: botCatalog.length,
      categories: templateCategories.length,
      loadedRuntimes: context.manager.loadedCount,
      storageDriver: context.storage.driver,
      environment: context.config.NODE_ENV,
      recentEvents,
    };
  });

  app.get('/api/system/config', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const config = redactedConfig(context.config) as Record<string, unknown>;
    delete config.JWT_SECRET;
    return {
      config,
      requiredEnv: requiredEnvKeys(),
      integrations: {
        ai: Boolean(context.config.AI_API_KEY),
        speech: Boolean(context.config.SPEECH_API_KEY),
        weather: Boolean(context.config.WEATHER_API_KEY),
        news: Boolean(context.config.NEWS_API_KEY),
        gold: Boolean(context.config.GOLD_API_KEY),
      },
    };
  });

  app.get('/api/system/jobs', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const query = z
      .object({ status: z.enum(['pending', 'running', 'done', 'failed', 'dead']).default('pending') })
      .parse(request.query);
    const bots = await context.storage.bots.list({ pageSize: 100 });
    const items: Array<Record<string, unknown>> = [];
    for (const bot of bots.items) {
      const result = await context.storage.jobs.list(bot.id, { status: query.status, pageSize: 20 });
      for (const job of result.items) items.push({ ...job, botName: bot.name });
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { items: items.slice(0, 100) };
  });

  app.post('/api/system/jobs/purge', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'system:read');
    const body = z.object({ olderThanHours: z.coerce.number().int().min(1).max(720).default(168) }).parse(request.body ?? {});
    const removed = await context.storage.jobs.purge(new Date(Date.now() - body.olderThanHours * 3_600_000).toISOString());
    await context.storage.audits.log({
      actorId: principal.kind === 'admin' ? principal.admin.id : principal.key.id,
      actorType: 'admin',
      action: 'system.jobs_purged',
      target: 'jobs',
      ip: request.ip,
      meta: { removed },
    });
    return { removed };
  });

  app.get('/', async () => ({
    name: 'BotForge Control Plane',
    version: '1.0.0',
    templates: botCatalog.length,
    docs: '/api/templates',
    health: '/health',
  }));
}
