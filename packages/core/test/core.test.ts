import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeUrl,
  createBotSchema,
  createMemoryStorage,
  createWebhookSecret,
  decryptSecret,
  encryptSecret,
  escapeHtml,
  formatBytes,
  formatDuration,
  formatNumber,
  hashApiKey,
  hashPassword,
  isPrivateAddress,
  maskToken,
  randomId,
  safeEqual,
  sanitizeText,
  signJwt,
  slugSchema,
  toPersianDigits,
  verifyJwt,
  verifyPassword,
  webhookPathSecret,
  SlidingWindowRateLimiter,
  TokenBucket,
  AppError,
} from '@botforge/core';

const MASTER_KEY = 'test-master-key-at-least-16-chars-long';

test('secrets round-trip through AES-256-GCM', () => {
  const envelope = encryptSecret('123456:AAH-secret-token', MASTER_KEY);
  assert.notEqual(envelope, '123456:AAH-secret-token');
  assert.equal(decryptSecret(envelope, MASTER_KEY), '123456:AAH-secret-token');
  assert.throws(() => decryptSecret(envelope, 'another-master-key-32-characters-long'));
});

test('password hashing verifies and rejects wrong passwords', () => {
  const stored = hashPassword('StrongPassword#1');
  assert.equal(verifyPassword('StrongPassword#1', stored), true);
  assert.equal(verifyPassword('StrongPassword#2', stored), false);
});

test('api keys are hashed deterministically and tokens are masked', () => {
  assert.equal(hashApiKey('bf_abc'), hashApiKey('bf_abc'));
  assert.notEqual(hashApiKey('bf_abc'), hashApiKey('bf_abd'));
  assert.equal(maskToken('123456789:AAHsecret'), '1234••••cret');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
});

test('JWT signs, verifies and rejects tampering', () => {
  const token = signJwt({ sub: 'adm_1', role: 'superadmin' }, 'jwt-secret-value-32-characters-long', 60);
  const payload = verifyJwt(token, 'jwt-secret-value-32-characters-long');
  assert.equal(payload?.sub, 'adm_1');
  assert.equal(verifyJwt(`${token}x`, 'jwt-secret-value-32-characters-long'), null);
  assert.equal(verifyJwt(token, 'different-secret-value-32-chars-long'), null);
});

test('validation helpers sanitize and escape user input', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(sanitizeText('  سلام\u0000  دنیا  '), 'سلام  دنیا');
  assert.equal(slugSchema.safeParse('shop-aram').success, true);
  assert.equal(slugSchema.safeParse('Shop Aram').success, false);
  assert.equal(slugSchema.safeParse('-leading').success, false);

  const parsed = createBotSchema.safeParse({
    templateId: 'gold-price',
    name: 'قیمت طلا',
    slug: 'gold-price',
    platform: 'telegram',
    token: '123456789:AAHfake-token-value',
  });
  assert.equal(parsed.success, true);
  assert.equal(
    createBotSchema.safeParse({ templateId: 'gold-price', name: 'x', slug: 'a', platform: 'telegram', token: 'nope' }).success,
    false,
  );
});

test('persian number and formatter helpers', () => {
  assert.equal(toPersianDigits('1234'), '۱۲۳۴');
  assert.equal(formatNumber(1234.5), '۱٬۲۳۴٫۵');
  assert.equal(formatBytes(1536), '۱٫۵ KB');
  assert.equal(formatBytes(512), '۵۱۲ B');
  assert.equal(formatDuration(3661), '۱ ساعت ۱ دقیقه ۱ ثانیه');
  assert.equal(formatDuration(90), '۱ دقیقه ۳۰ ثانیه');
});

test('rate limiter blocks above the configured limit', () => {
  const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.consume('u1').allowed, true);
  assert.equal(limiter.consume('u1').allowed, true);
  assert.equal(limiter.consume('u1').allowed, false);
  assert.equal(limiter.consume('u2').allowed, true);
});

test('token bucket refills', async () => {
  const bucket = new TokenBucket(2, 20);
  await bucket.take(1);
  await bucket.take(1);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await bucket.take(1);
  assert.ok(true);
});

test('SSRF protection rejects private targets and allows public hosts', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);

  await assert.rejects(() => assertSafeUrl('http://127.0.0.1/admin'));
  await assert.rejects(() => assertSafeUrl('http://localhost:8080/'));
  await assert.rejects(() => assertSafeUrl('file:///etc/passwd'));
  await assert.rejects(() => assertSafeUrl('https://example.com:22/'));

  const safe = await assertSafeUrl('https://example.com/page', { resolver: async () => ['93.184.216.34'] });
  assert.equal(safe.url.hostname, 'example.com');
  await assert.rejects(() =>
    assertSafeUrl('https://internal.example', { resolver: async () => ['192.168.1.10'] }),
  );
});

test('webhook secrets are unique and path secrets are stable', () => {
  const secret = createWebhookSecret();
  assert.ok(secret.length >= 20);
  assert.equal(webhookPathSecret(secret), webhookPathSecret(secret));
  assert.notEqual(webhookPathSecret(secret), secret);
});

test('memory storage isolates bots and supports documents/jobs/users', async () => {
  const storage = await createMemoryStorage();
  await storage.init();
  const now = new Date().toISOString();
  const base = {
    slug: 'demo-bot',
    templateId: 'gold-price',
    name: 'قیمت',
    platform: 'telegram' as const,
    status: 'active' as const,
    tokenCipher: 'cipher',
    tokenHint: '1234••••cret',
    ownerId: 'system',
    config: {},
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'x',
      buttonLabel: 'y',
      recheckLabel: 'z',
      bypassAdmins: true,
      cacheSeconds: 300,
    },
    webhookSecret: 'secret',
    createdAt: now,
    updatedAt: now,
  };
  const botA = await storage.bots.create({ ...base, id: randomId('bot_') });
  const botB = await storage.bots.create({ ...base, id: randomId('bot_'), slug: 'demo-bot-2' });
  assert.equal(await storage.bots.count(), 2);
  assert.equal((await storage.bots.findBySlug('demo-bot'))?.id, botA.id);

  const { user, created } = await storage.users.upsert({
    botId: botA.id,
    platform: 'telegram',
    platformUserId: '555',
    chatId: '555',
    firstName: 'سارا',
  });
  assert.equal(created, true);
  await storage.users.setBlocked(botA.id, user.id, true);
  const blocked = await storage.users.findById(user.id);
  assert.equal(blocked?.isBlocked, true);
  await storage.users.setRole(botA.id, user.id, 'admin');
  assert.equal((await storage.users.findByPlatformId(botA.id, '555'))?.role, 'admin');
  assert.equal(await storage.users.count(botB.id), 0);

  const doc = await storage.documents.insert({
    botId: botA.id,
    collection: 'products',
    key: 'p1',
    data: { title: 'کتاب' },
  });
  await storage.documents.update(botA.id, doc.id, { title: 'کتاب دو' });
  const found = await storage.documents.findByKey(botA.id, 'products', 'p1');
  assert.equal((found?.data as { title: string }).title, 'کتاب دو');
  assert.equal(await storage.documents.count(botB.id, 'products'), 0);

  const job = await storage.jobs.create({ botId: botA.id, type: 'test.job', payload: { a: 1 } });
  const claimed = await storage.jobs.claimDue(5);
  assert.equal(claimed.length, 1);
  await storage.jobs.complete(job.id);
  assert.equal(await storage.jobs.countPending(botA.id), 0);

  await storage.events.log({ botId: botA.id, type: 'bot.init', level: 'info', payload: { ok: true } });
  const events = await storage.events.list(botA.id);
  assert.equal(events.items.length, 1);
  assert.equal(events.items[0].type, 'bot.init');

  assert.equal(await storage.updates.mark(botA.id, 'update-1'), true);
  assert.equal(await storage.updates.mark(botA.id, 'update-1'), false);

  assert.throws(() => {
    throw new AppError('VALIDATION', 'خطای نمونه');
  }, /خطای نمونه/);
  await storage.close();
});
