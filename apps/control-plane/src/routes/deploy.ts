import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, botTokenSchema, notFound, platformSchema } from '@botforge/core';
import { assertScope, assertWrite, audit, authenticate } from '../plugins/auth';
import type { AppContext } from '../context';

const cloudflareCredentials = z.object({
  apiToken: z.string().trim().min(20).max(200),
  accountId: z.string().trim().min(10).max(64).optional(),
});

const railwayCredentials = z.object({
  apiToken: z.string().trim().min(20).max(200),
  databaseUrl: z.string().trim().max(500).optional(),
  projectName: z.string().trim().min(2).max(60).optional(),
});

const providerSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('cloudflare'), credentials: cloudflareCredentials }),
  z.object({ provider: z.literal('railway'), credentials: railwayCredentials }),
]);

const deploySchema = z.object({
  provider: z.enum(['cloudflare', 'railway']),
  credentials: z.record(z.string().max(500)),
  integrationKeys: z.record(z.string().max(20), z.string().max(4000)).optional(),
  corsOrigins: z.string().trim().max(500).optional(),
});

const tokenSchema = z.object({
  platform: platformSchema,
  token: botTokenSchema,
});

export async function registerDeployRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/api/deploy/providers', async () => context.deployments.providerCatalog());

  app.post(
    '/api/deploy/validate-token',
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (request) => {
      const principal = await authenticate(context, request);
      assertScope(principal, 'bots:write');
      assertWrite(principal);
      const parsed = tokenSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest('پلتفرم یا توکن نامعتبر است', parsed.error.flatten());
      const result = await context.deployments.validatePlatformToken(parsed.data.platform, parsed.data.token);
      await audit(context, request, principal, 'deploy.token_validated', parsed.data.platform, {
        botUsername: result.bot.username,
      });
      return result;
    },
  );

  app.post(
    '/api/deploy/validate-provider',
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (request) => {
      const principal = await authenticate(context, request);
      assertScope(principal, 'bots:write');
      assertWrite(principal);
      const parsed = providerSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest('اطلاعات سرویس میزبانی نامعتبر است', parsed.error.flatten());
      const result = await context.deployments.validateProvider(parsed.data.provider, parsed.data.credentials);
      await audit(context, request, principal, 'deploy.provider_validated', parsed.data.provider, {
        ok: result.ok,
        account: result.accountName ?? null,
      });
      return result;
    },
  );

  app.post('/api/bots/:id/deploy', async (request, reply) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id } = request.params as { id: string };
    const bot = await context.storage.bots.findById(id);
    if (!bot) throw notFound('ربات پیدا نشد');
    const parsed = deploySchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('درخواست استقرار نامعتبر است', parsed.error.flatten());

    const credentials =
      parsed.data.provider === 'cloudflare'
        ? cloudflareCredentials.parse({ apiToken: parsed.data.credentials.apiToken, accountId: parsed.data.credentials.accountId })
        : railwayCredentials.parse({
            apiToken: parsed.data.credentials.apiToken,
            databaseUrl: parsed.data.credentials.databaseUrl,
            projectName: parsed.data.credentials.projectName,
          });

    const deployment = await context.deployments.start({
      botId: bot.id,
      provider: parsed.data.provider,
      credentials,
      integrationKeys: parsed.data.integrationKeys,
      corsOrigins: parsed.data.corsOrigins,
    });
    await audit(context, request, principal, 'deploy.started', bot.id, {
      provider: parsed.data.provider,
      deploymentId: deployment.id,
    });
    reply.code(202).send({
      deployment: { ...deployment, credentialsCipher: undefined },
      statusUrl: `/api/bots/${bot.id}/deployments/${deployment.id}`,
    });
  });

  app.get('/api/bots/:id/deployments', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id } = request.params as { id: string };
    const bot = await context.storage.bots.findById(id);
    if (!bot) throw notFound('ربات پیدا نشد');
    const items = await context.deployments.listDeployments(bot.id);
    return {
      items: items.map((item) => ({
        ...item,
        credentialsCipher: undefined,
        steps: item.steps,
      })),
      total: items.length,
    };
  });

  app.get('/api/bots/:id/deployments/:deploymentId', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id, deploymentId } = request.params as { id: string; deploymentId: string };
    const bot = await context.storage.bots.findById(id);
    if (!bot) throw notFound('ربات پیدا نشد');
    const deployment = await context.deployments.getDeployment(bot.id, deploymentId);
    return { deployment: { ...deployment, credentialsCipher: undefined } };
  });

  app.post('/api/bots/:id/deployments/:deploymentId/health', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:write');
    assertWrite(principal);
    const { id, deploymentId } = request.params as { id: string; deploymentId: string };
    const bot = await context.storage.bots.findById(id);
    if (!bot) throw notFound('ربات پیدا نشد');
    const deployment = await context.deployments.checkHealth(bot.id, deploymentId);
    await audit(context, request, principal, 'deploy.health_checked', bot.id, {
      deploymentId,
      ok: deployment.health?.ok ?? false,
    });
    return { deployment: { ...deployment, credentialsCipher: undefined } };
  });

  app.get('/api/bots/:id/deployments/:deploymentId/package', async (request) => {
    const principal = await authenticate(context, request);
    assertScope(principal, 'bots:read');
    const { id, deploymentId } = request.params as { id: string; deploymentId: string };
    const bot = await context.storage.bots.findById(id);
    if (!bot) throw notFound('ربات پیدا نشد');
    const deployment = await context.deployments.getDeployment(bot.id, deploymentId);
    return {
      files: context.deployments.buildPackage(deployment, bot),
      urls: deployment.urls,
    };
  });
}
