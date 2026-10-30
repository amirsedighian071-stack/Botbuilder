import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger, hashPassword, loadConfig } from '@botforge/core';
import { buildApp } from '../src/app';
import { createAppContext } from '../src/context';

const config = loadConfig({
  NODE_ENV: 'test',
  PORT: "8090",
  DATABASE_DRIVER: 'memory',
  SECRET_MASTER_KEY: 'api-test-master-key-32-characters',
  JWT_SECRET: 'api-test-jwt-secret-32-characters',
  ADMIN_SEED_EMAIL: 'admin@botforge.test',
  ADMIN_SEED_PASSWORD: 'TestPassword#1',
  RATE_LIMIT_MAX: '1000',
  CORS_ORIGINS: '*',
  SSRF_PROTECTION: 'false',
});

async function setup() {
  const logger = createLogger({ level: 'error' });
  const context = await createAppContext({ config, logger, startQueue: false });
  const app = await buildApp(context);
  return { app, context };
}

async function login(app: Awaited<ReturnType<typeof setup>>['app']): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@botforge.test', password: 'TestPassword#1' },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { token: string };
  return body.token;
}

test('health endpoint reports storage and template counts', async () => {
  const { app } = await setup();
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { status: string; storage: { driver: string }; bots: { loaded: number } };
  assert.equal(body.status, 'ok');
  assert.equal(body.storage.driver, 'memory');
  assert.equal(body.bots.loaded, 0);
  await app.close();
});

test('catalog is public and lists all 32 bots', async () => {
  const { app } = await setup();
  const response = await app.inject({ method: 'GET', url: '/api/catalog' });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { bots: unknown[]; categories: unknown[]; total: number };
  assert.equal(body.total, 32);
  assert.equal(body.bots.length, 32);
  assert.equal(body.categories.length, 5);
  await app.close();
});

test('protected routes require authentication', async () => {
  const { app } = await setup();
  for (const url of ['/api/bots', '/api/system/stats', '/api/keys']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} must be protected`);
  }
  await app.close();
});

test('login issues a JWT usable on protected routes', async () => {
  const { app } = await setup();
  const token = await login(app);
  const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  const me = response.json() as { kind: string; admin: { email: string; role: string } };
  assert.equal(me.kind, 'admin');
  assert.equal(me.admin.email, 'admin@botforge.test');
  assert.equal(me.admin.role, 'superadmin');

  const bots = await app.inject({ method: 'GET', url: '/api/bots', headers: { authorization: `Bearer ${token}` } });
  assert.equal(bots.statusCode, 200);
  assert.deepEqual((bots.json() as { items: unknown[] }).items, []);
  await app.close();
});

test('api keys are issued once and authenticate requests', async () => {
  const { app } = await setup();
  const token = await login(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/keys',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'کلید آزمایشی', scopes: ['bots:read', 'system:read'] },
  });
  assert.equal(created.statusCode, 201, created.body);
  const { key } = created.json() as { key: string };
  assert.match(key, /^bf_[a-f0-9]{48}$/);

  const viaKey = await app.inject({ method: 'GET', url: '/api/system/stats', headers: { 'x-api-key': key } });
  assert.equal(viaKey.statusCode, 200);

  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/bots',
    headers: { 'x-api-key': key },
    payload: { templateId: 'gold-price', name: 'x', slug: 'xx', platform: 'telegram', token: 'nope' },
  });
  assert.equal(forbidden.statusCode, 403);
  await app.close();
});

test('bot creation validates payloads before calling the platform', async () => {
  const { app } = await setup();
  const token = await login(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/bots',
    headers: { authorization: `Bearer ${token}` },
    payload: { templateId: 'gold-price', name: 'x', slug: 'Invalid Slug', platform: 'telegram', token: 'short' },
  });
  assert.equal(response.statusCode, 400);
  const unknownTemplate = await app.inject({
    method: 'POST',
    url: '/api/bots',
    headers: { authorization: `Bearer ${token}` },
    payload: { templateId: 'nope', name: 'نام', slug: 'valid-slug', platform: 'telegram', token: '123456789:AAHabcdefghijklmnop' },
  });
  assert.ok([400, 404].includes(unknownTemplate.statusCode), unknownTemplate.body);
  await app.close();
});

test('webhooks reject unknown bots and bad secrets', async () => {
  const { app, context } = await setup();
  const missing = await app.inject({
    method: 'POST',
    url: '/webhooks/telegram/bot_missing/secret-value',
    payload: { update_id: 1 },
  });
  assert.equal(missing.statusCode, 404);

  const now = new Date().toISOString();
  const bot = await context.storage.bots.create({
    id: 'bot_test',
    slug: 'test-bot',
    templateId: 'gold-price',
    name: 'قیمت طلا',
    platform: 'telegram',
    status: 'active',
    tokenCipher: context.secrets.seal('123456789:AAHabcdefghijklmnop').cipher,
    tokenHint: '1234••••mnop',
    ownerId: 'system',
    config: {},
    forceMembership: {
      enabled: false,
      channels: [],
      message: 'm',
      buttonLabel: 'b',
      recheckLabel: 'r',
      bypassAdmins: true,
      cacheSeconds: 60,
    },
    webhookSecret: 'correct-secret-value',
    createdAt: now,
    updatedAt: now,
  });
  const badSecret = await app.inject({
    method: 'POST',
    url: `/webhooks/telegram/${bot.id}/wrong-secret`,
    payload: { update_id: 2 },
  });
  assert.equal(badSecret.statusCode, 401);
  await app.close();
});

test('seed admin password hashing matches verification', async () => {
  const { context } = await setup();
  const admins = await context.storage.admins.list();
  assert.equal(admins.length, 1);
  const { verifyPassword } = await import('@botforge/core');
  assert.equal(verifyPassword('TestPassword#1', admins[0].passwordHash), true);
  assert.notEqual(admins[0].passwordHash, hashPassword('TestPassword#1'));
});
