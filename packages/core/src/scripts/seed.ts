import { hashApiKey, hashPassword, randomToken } from '../crypto';
import { createLogger, loadConfig, toErrorMessage } from '../index';
import { createStorageFromConfig } from '../storage/index';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  if (config.database.driver === 'd1') {
    logger.error('بذر اولیه روی Cloudflare D1 پشتیبانی نمی‌شود؛ از کنترل‌پلین متصل به D1 استفاده کنید');
    process.exit(1);
  }

  const storage = await createStorageFromConfig({ config, logger });
  try {
    await storage.init();

    const existing = await storage.admins.count();
    if (existing === 0) {
      const admin = await storage.admins.create({
        email: config.ADMIN_SEED_EMAIL,
        passwordHash: hashPassword(config.ADMIN_SEED_PASSWORD),
        role: 'superadmin',
      });
      logger.info('admin created', { email: admin.email, role: admin.role });
      console.log('مدیر جدید ساخته شد:');
      console.log(`  ایمیل: ${config.ADMIN_SEED_EMAIL}`);
      console.log(
        config.isProduction
          ? '  گذرواژه: همان مقدار ADMIN_SEED_PASSWORD (پس از ورود تغییر دهید)'
          : `  گذرواژه: ${config.ADMIN_SEED_PASSWORD}`,
      );
    } else {
      logger.info('admin already exists', { count: existing });
      console.log(`حساب مدیر از قبل وجود دارد (${existing} حساب).`);
    }

    const bots = await storage.bots.count();
    console.log(`ربات‌های ثبت‌شده: ${bots}`);

    const rawKey = `bf_${randomToken(24, 'hex')}`;
    const key = await storage.apiKeys.create({
      name: 'کلید راه‌اندازی اولیه',
      prefix: rawKey.slice(0, 16),
      hash: hashApiKey(rawKey),
      scopes: ['bots:read', 'bots:write', 'users:read', 'users:write', 'broadcast', 'system:read'],
    });
    console.log('');
    console.log('کلید API (فقط همین یک بار نمایش داده می‌شود):');
    console.log(`  ${rawKey}`);
    console.log(`  شناسه: ${key.id}`);
    console.log('این کلید را در متغیر BOTFORGE_API_KEY ذخیره کنید.');
    logger.info('api key seeded', { id: key.id, prefix: key.prefix });
  } finally {
    await storage.close();
  }
}

main().catch((error: unknown) => {
  console.error(`بذر اولیه ناموفق بود: ${toErrorMessage(error)}`);
  process.exit(1);
});
