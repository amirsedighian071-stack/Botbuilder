import assert from 'node:assert/strict';
import test from 'node:test';
import { botCatalog, botTemplates, catalogByCategory, getBotTemplate, requiredEnvKeys, templateCategories } from '@botforge/bot-templates';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test('registry exposes exactly 32 unique bots', () => {
  assert.equal(botTemplates.length, 32);
  assert.equal(botCatalog.length, 32);
  const ids = new Set(botTemplates.map((bot) => bot.id));
  assert.equal(ids.size, 32, 'bot ids must be unique');
  assert.deepEqual(
    botTemplates.map((bot) => bot.category).reduce<Record<string, number>>((acc, category) => {
      acc[category] = (acc[category] ?? 0) + 1;
      return acc;
    }, {}),
    { A: 5, B: 7, C: 8, D: 5, E: 7 },
  );
});

test('every category has a Persian title and description', () => {
  assert.equal(templateCategories.length, 5);
  for (const category of templateCategories) {
    assert.ok(category.title.length > 3);
    assert.ok(category.description.length > 10);
    assert.ok(category.accent.startsWith('#'));
    assert.ok(catalogByCategory(category.id).length > 0);
  }
});

test('each bot exposes a complete definition', () => {
  for (const bot of botTemplates) {
    assert.match(bot.id, /^[a-z0-9-]{3,40}$/, `invalid id: ${bot.id}`);
    assert.ok(bot.name.length >= 3, `${bot.id} name too short`);
    assert.ok(bot.summary.length >= 10, `${bot.id} summary too short`);
    assert.ok(bot.description.length >= 40, `${bot.id} description too short`);
    assert.ok(bot.icon.length > 0);
    assert.match(bot.version, /^\d+\.\d+\.\d+$/, `${bot.id} version must be semver`);
    assert.ok(bot.tags.length >= 1, `${bot.id} needs tags`);
    assert.ok(bot.commands.length >= 1, `${bot.id} needs commands`);
    assert.ok(bot.menu.length >= 1, `${bot.id} needs a menu`);
    assert.ok(Object.keys(bot.actions).length >= 1, `${bot.id} needs actions`);
    for (const command of bot.commands) {
      assert.match(command.command, /^[a-z0-9_]{2,20}$/, `${bot.id} invalid command ${command.command}`);
      assert.ok(command.description.length > 3);
    }
    for (const item of bot.menu) {
      const baseAction = item.id.split(':')[0];
      assert.ok(bot.actions[baseAction], `${bot.id} menu item ${item.id} has no matching action`);
    }
  }
});

test('requirements declare environment variable names', () => {
  const envs = requiredEnvKeys();
  assert.ok(envs.length > 0, 'templates should declare at least one environment requirement');
  for (const env of envs) assert.match(env, /^[A-Z0-9_]+$/);
  for (const bot of botTemplates) {
    for (const requirement of bot.requirements) {
      assert.match(requirement.key, /^[A-Za-z0-9_.:-]+$/, `${bot.id}: invalid requirement key`);
      assert.ok(requirement.label.length >= 2);
      assert.ok(requirement.description.length > 5);
    }
  }
});

test('no emoji leaks into user-facing bot copy', () => {
  for (const bot of botTemplates) {
    const copy = [bot.name, bot.summary, bot.description, ...bot.tags, ...bot.commands.map((c) => c.description), ...bot.menu.map((m) => m.label)].join(' ');
    assert.equal(EMOJI.test(copy), false, `${bot.id} contains emoji`);
  }
});

test('template lookup helpers work', () => {
  const template = getBotTemplate('gold-price');
  assert.ok(template);
  assert.equal(template?.category, 'A');
  assert.equal(getBotTemplate('does-not-exist'), undefined);
  assert.ok(botCatalog.every((entry, index) => entry.number === index + 1));
});
