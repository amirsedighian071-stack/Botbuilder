import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, isAppError, platformSchema, toErrorMessage } from '@botforge/core';
import type { AppContext } from '../context';

const paramsSchema = z.object({
  platform: platformSchema,
  botId: z.string().min(3).max(80),
  secret: z.string().min(8).max(128),
});

function normalizeHeaders(request: FastifyRequest): Record<string, string | string[] | undefined> {
  return { ...request.headers } as Record<string, string | string[] | undefined>;
}

export async function registerWebhookRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post(
    '/webhooks/:platform/:botId/:secret',
    {
      config: { rateLimit: { max: 600, timeWindow: 60_000 } },
      bodyLimit: context.config.MAX_UPLOAD_MB * 1024 * 1024,
    },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        reply.code(404).send({ ok: false, error: 'not_found' });
        return;
      }
      const { platform, botId, secret } = parsed.data;
      const bot = await context.storage.bots.findById(botId);
      if (!bot || bot.platform !== platform) {
        reply.code(404).send({ ok: false, error: 'not_found' });
        return;
      }

      const started = Date.now();
      try {
        const result = await context.manager.handleWebhook({
          botId,
          pathSecret: secret,
          headers: normalizeHeaders(request),
          body: request.body,
          remoteIp: request.ip,
        });
        context.logger.debug('webhook handled', {
          botId,
          platform,
          accepted: result.accepted,
          durationMs: Date.now() - started,
        });
        reply.code(200).send({ ok: true, accepted: result.accepted, reason: result.reason ?? null });
      } catch (error) {
        if (isAppError(error) && error.code === 'UNAUTHORIZED') {
          await context.storage.events.log({
            botId,
            type: 'webhook.rejected',
            level: 'warn',
            payload: { ip: request.ip, platform },
          });
          reply.code(401).send({ ok: false, error: 'unauthorized' });
          return;
        }
        context.logger.error('webhook processing failed', {
          botId,
          platform,
          error: toErrorMessage(error),
        });
        await context.storage.events.log({
          botId,
          type: 'webhook.error',
          level: 'error',
          payload: { message: toErrorMessage(error).slice(0, 300), platform },
        });
        reply.code(200).send({ ok: true, accepted: false, error: 'processing_failed' });
      }
    },
  );

  app.get('/webhooks/:platform/:botId/:secret', async (request) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError('NOT_FOUND', 'not found');
    const bot = await context.storage.bots.findById(parsed.data.botId);
    return {
      ok: true,
      platform: parsed.data.platform,
      configured: Boolean(bot),
      hint: 'این آدرس فقط برای دریافت به‌روزرسانی پلتفرم است و به درخواست POST پاسخ کامل می‌دهد.',
    };
  });
}
