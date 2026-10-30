import { createLogger, loadConfig, toErrorMessage, type AppConfig } from '@botforge/core';
import { createAppContext, shutdownContext } from './context';
import { buildApp } from './app';
import { ensureInstalledBot, type InstallSpec } from '@botforge/engine';

/**
 * BotForge installer runtime.
 *
 * Unlike `main.ts` (the multi-bot control plane), this entrypoint boots a
 * single-tenant instance that is completely described by environment
 * variables: the installer wizard on the static site generates `.env`,
 * `wrangler.toml` or `railway.json`, and this server turns them into a live
 * bot, database tables and a registered webhook on first boot.
 */
function readInstallSpec(config: AppConfig): InstallSpec {
  const templateId = config.BOT_TEMPLATE;
  const platform = config.BOT_PLATFORM;
  const token = config.BOT_TOKEN;
  const slug = config.BOT_SLUG;

  if (!templateId) throw new Error('BOT_TEMPLATE تنظیم نشده است؛ قالب ربات را در ویزارد انتخاب و در متغیرها ثبت کنید');
  if (!token) throw new Error('BOT_TOKEN تنظیم نشده است؛ توکن ربات از BotFather را در متغیرها ثبت کنید');
  if (!['telegram', 'bale', 'rubika'].includes(platform)) throw new Error('BOT_PLATFORM باید telegram، bale یا rubika باشد');

  let botConfig: Record<string, unknown> = {};
  const rawConfig = config.BOT_CONFIG_JSON;
  if (rawConfig) {
    try {
      const parsed = JSON.parse(rawConfig);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) botConfig = parsed as Record<string, unknown>;
    } catch {
      throw new Error('BOT_CONFIG_JSON یک JSON معتبر نیست');
    }
  }

  let forceMembership: unknown = undefined;
  const rawForce = config.BOT_FORCE_MEMBERSHIP_JSON;
  if (rawForce) {
    try {
      forceMembership = JSON.parse(rawForce);
    } catch {
      throw new Error('BOT_FORCE_MEMBERSHIP_JSON یک JSON معتبر نیست');
    }
  }

  return {
    templateId,
    platform,
    token,
    slug: slug || `botforge-${templateId}-${platform}`,
    name: config.BOT_NAME ?? '',
    botId: config.BOT_ID,
    webhookSecret: config.BOT_WEBHOOK_SECRET,
    config: botConfig,
    forceMembership,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const context = await createAppContext({ config, logger });

  const spec = readInstallSpec(config);
  const installed = await ensureInstalledBot({
    storage: context.storage,
    manager: context.manager,
    logger: logger.child({ scope: 'installer' }),
    spec,
  });

  logger.info('installer completed', {
    botId: installed.bot.id,
    created: installed.created,
    template: installed.bot.templateId,
    platform: installed.bot.platform,
    webhookRegistered: installed.webhookRegistered,
  });
  if (!installed.webhookRegistered) {
    logger.warn('installer could not register the platform webhook', { webhookUrl: installed.webhookUrl });
  }

  const app = await buildApp(context);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    try {
      await app.close();
    } catch (error) {
      logger.warn('http server close failed', { error: toErrorMessage(error) });
    }
    await shutdownContext(context);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info('installed bot listening', {
    port: config.PORT,
    host: config.HOST,
    bot: installed.bot.slug,
    webhookUrl: installed.webhookUrl,
    health: `http://${config.HOST}:${config.PORT}/health`,
    api: `http://${config.HOST}:${config.PORT}/api`,
    console: 'https://amirsedighian071-stack.github.io/Botbuilder/admin/',
  });
}

main().catch((error: unknown) => {
  const logger = createLogger({ level: 'error' });
  logger.error('installer failed to start', { error: toErrorMessage(error) });
  process.exit(1);
});
