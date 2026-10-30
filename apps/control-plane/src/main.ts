import { createLogger, loadConfig, toErrorMessage } from '@botforge/core';
import { buildApp } from './app';
import { createAppContext, shutdownContext } from './context';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const context = await createAppContext({ config, logger });
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
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: toErrorMessage(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error: toErrorMessage(error) });
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info('control plane listening', {
    port: config.PORT,
    host: config.HOST,
    driver: context.storage.driver,
    bots: context.manager.loadedCount,
    templates: context.templates.size,
    publicBaseUrl: config.PUBLIC_BASE_URL,
  });
}

main().catch((error: unknown) => {
  const logger = createLogger({ level: 'error' });
  logger.error('control plane failed to start', { error: toErrorMessage(error) });
  process.exit(1);
});
