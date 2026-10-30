import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { isAppError, toErrorMessage } from '@botforge/core';
import type { AppContext } from './context';
import { registerAuthRoutes } from './routes/auth';
import { registerBotRoutes } from './routes/bots';
import { registerTemplateRoutes } from './routes/templates';
import { registerSystemRoutes } from './routes/system';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerMediaRoutes } from './routes/media';

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(context: AppContext, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: context.config.TRUST_PROXY,
    bodyLimit: Math.max(context.config.MAX_UPLOAD_MB * 1024 * 1024, 1024 * 1024),
    genReqId: () => `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: context.config.corsOrigins.includes('*')
      ? true
      : (origin, callback) => {
          if (!origin || context.config.corsOrigins.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error('origin not allowed'), false);
        },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Telegram-Bot-Api-Secret-Token'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: context.config.RATE_LIMIT_MAX,
    timeWindow: context.config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    allowList: [],
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, ctx) => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'تعداد درخواست‌ها بیش از حد مجاز است؛ لطفاً کمی صبر کنید.',
        retryAfter: ctx.after,
      },
    }),
  });

  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/webhooks/')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      if (error.status >= 500) {
        context.logger.error('request failed', { path: request.url, code: error.code, error: error.message });
      }
      reply.code(error.status).send(error.toJSON());
      return;
    }
    const status = typeof (error as { statusCode?: number }).statusCode === 'number'
      ? (error as { statusCode?: number }).statusCode!
      : 500;
    if (status >= 500) {
      context.logger.error('unhandled request error', {
        path: request.url,
        error: toErrorMessage(error),
      });
      reply.code(500).send({ error: { code: 'INTERNAL', message: 'خطای داخلی سرور' } });
      return;
    }
    reply.code(status).send({
      error: { code: 'BAD_REQUEST', message: toErrorMessage(error).slice(0, 300) },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `مسیر یافت نشد: ${request.url}` } });
  });

  await registerSystemRoutes(app, context);
  await registerAuthRoutes(app, context);
  await registerTemplateRoutes(app, context);
  await registerBotRoutes(app, context);
  await registerWebhookRoutes(app, context);
  await registerMediaRoutes(app, context);

  return app;
}
