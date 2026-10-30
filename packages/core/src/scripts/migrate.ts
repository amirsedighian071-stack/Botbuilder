import { createLogger, loadConfig, toErrorMessage } from '../index';
import { createStorageFromConfig } from '../storage/index';
import { TABLES } from '../storage/schema';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  if (config.database.driver === 'd1') {
    logger.error('برای Cloudflare D1 از wrangler d1 execute و فایل packages/core/sql/schema.sql استفاده کنید');
    process.exit(1);
  }

  logger.info('running migrations', { driver: config.database.driver });
  const storage = await createStorageFromConfig({ config, logger });
  try {
    await storage.init();
    const healthy = await storage.ping();
    if (!healthy) throw new Error('پایگاه داده پس از مهاجرت پاسخ نداد');
    const names = TABLES.map((table) => table.name);
    logger.info('migration complete', {
      driver: storage.driver,
      tables: names.length,
      names: names.join(', '),
    });
    console.log('جدول‌های آماده:');
    for (const name of names) console.log(`  - ${name}`);
  } finally {
    await storage.close();
  }
}

main().catch((error: unknown) => {
  console.error(`مهاجرت ناموفق بود: ${toErrorMessage(error)}`);
  process.exit(1);
});
