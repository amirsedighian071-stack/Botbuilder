import type { BotContext } from '@botforge/core';
import { defineBot, fa, getDoc, parseNumberInput, requireAdmin, saveDoc, truncateText } from '../kit';

interface GroupSettings {
  rules: string;
  welcome: string;
  antiSpam: boolean;
  antiLink: boolean;
  antiFlood: boolean;
  floodLimit: number;
  floodWindowSeconds: number;
  bannedWords: string[];
  warnings: Record<string, number>;
}

const GROUPS = 'groups';

function defaultSettings(): GroupSettings {
  return {
    rules: 'احترام متقابل، پرهیز از تبلیغات، عدم ارسال لینک بدون اجازه مدیر.',
    welcome: 'به گروه خوش آمدید. لطفاً قوانین گروه را بخوانید.',
    antiSpam: true,
    antiLink: true,
    antiFlood: true,
    floodLimit: 6,
    floodWindowSeconds: 10,
    bannedWords: [],
    warnings: {},
  };
}

function key(chatId: string): string {
  return `group_${chatId}`;
}

async function settingsFor(ctx: BotContext): Promise<GroupSettings> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, GROUPS, key(ctx.message.chatId));
  return { ...defaultSettings(), ...(doc?.data as unknown as GroupSettings ?? {}) };
}

async function saveSettings(ctx: BotContext, settings: GroupSettings): Promise<void> {
  await saveDoc(ctx.storage, ctx.bot.id, GROUPS, key(ctx.message.chatId), settings as unknown as Record<string, unknown>);
}

async function renderSettings(ctx: BotContext): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const settings = await settingsFor(ctx);
  const lines = [
    '<b>مدیریت گروه</b>',
    '',
    `ضداسپم: ${settings.antiSpam ? 'فعال' : 'غیرفعال'}`,
    `حذف لینک: ${settings.antiLink ? 'فعال' : 'غیرفعال'}`,
    `کنترل سیل پیام: ${settings.antiFlood ? 'فعال' : 'غیرفعال'} (${fa(settings.floodLimit)} پیام در ${fa(settings.floodWindowSeconds)} ثانیه)`,
    `کلمات ممنوعه: ${settings.bannedWords.length > 0 ? settings.bannedWords.join('، ') : 'ندارد'}`,
    '',
    '<b>قوانین</b>',
    ctx.escape(truncateText(settings.rules, 400)),
    '',
    '<b>پیام خوش‌آمد</b>',
    ctx.escape(truncateText(settings.welcome, 300)),
  ];
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [
          { text: settings.antiSpam ? 'خاموش‌کردن ضداسپم' : 'روشن‌کردن ضداسپم', callbackData: 'a:toggle:antiSpam' },
          { text: settings.antiLink ? 'اجازه لینک' : 'ممنوعیت لینک', callbackData: 'a:toggle:antiLink' },
        ],
        [
          { text: settings.antiFlood ? 'خاموش‌کردن ضدسیل' : 'روشن‌کردن ضدسیل', callbackData: 'a:toggle:antiFlood' },
          { text: 'تنظیم آستانه', callbackData: 'a:setflood' },
        ],
        [
          { text: 'ویرایش قوانین', callbackData: 'a:setrules' },
          { text: 'ویرایش خوش‌آمد', callbackData: 'a:setwelcome' },
        ],
        [
          { text: 'کلمه ممنوعه جدید', callbackData: 'a:addword' },
          { text: 'پاک‌کردن اخطارها', callbackData: 'a:clearwarns' },
        ],
      ],
    },
  });
}

export const groupManagerBot = defineBot({
  id: 'group-manager',
  name: 'مدیریت گروه',
  category: 'E',
  summary: 'ضداسپم، کنترل لینک و سیل پیام، قوانین گروه و سیستم اخطار',
  description:
    'در گروه‌ها پیام‌ها را پایش می‌کند: حذف خودکار لینک‌های غیرمجاز، تشخیص سیل پیام، فیلتر کلمات ممنوعه و ثبت اخطار برای کاربران. مدیر گروه می‌تواند قوانین و پیام خوش‌آمد را تنظیم کند و کاربران با دستور /rules آن را ببینند. سه اخطار منجر به اخراج کاربر از گروه می‌شود.',
  icon: 'shield',
  tags: ['group', 'moderation'],
  commands: [
    { command: 'rules', description: 'نمایش قوانین گروه' },
    { command: 'settings', description: 'تنظیمات گروه (مدیر)', adminOnly: true },
    { command: 'warn', description: 'اخطار به کاربر (مدیر)', adminOnly: true },
    { command: 'resetwarns', description: 'پاک‌کردن اخطارها (مدیر)', adminOnly: true },
    { command: 'ban', description: 'حذف کاربر از گروه (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'rules', label: 'قوانین گروه' },
    { id: 'settings', label: 'تنظیمات گروه', adminOnly: true },
  ],
  defaultConfig: { warnLimit: 3, muteMinutes: 30 },
  actions: {
    rules: async (ctx) => {
      const settings = await settingsFor(ctx);
      await ctx.reply(`<b>قوانین گروه</b>\n\n${ctx.escape(settings.rules)}`);
    },
    settings: async (ctx) => renderSettings(ctx),
    toggle: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const settings = await settingsFor(ctx);
      if (param === 'antiSpam') settings.antiSpam = !settings.antiSpam;
      if (param === 'antiLink') settings.antiLink = !settings.antiLink;
      if (param === 'antiFlood') settings.antiFlood = !settings.antiFlood;
      await saveSettings(ctx, settings);
      await renderSettings(ctx);
    },
    setflood: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('group_flood', {});
      await ctx.reply('آستانه سیل پیام را به شکل <code>تعداد ثانیه</code> وارد کنید. نمونه: <code>6 10</code>');
    },
    setrules: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('group_rules', {});
      await ctx.reply('متن جدید قوانین را ارسال کنید:');
    },
    setwelcome: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('group_welcome', {});
      await ctx.reply('متن خوش‌آمدگویی را ارسال کنید:');
    },
    addword: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('group_word', {});
      await ctx.reply('کلمه ممنوعه را ارسال کنید:');
    },
    clearwarns: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const settings = await settingsFor(ctx);
      settings.warnings = {};
      await saveSettings(ctx, settings);
      await ctx.reply('تمام اخطارها پاک شد.');
    },
  },
  steps: {
    group_flood: async (ctx) => {
      const [limitRaw, windowRaw] = ctx.text.split(/\s+/);
      const limit = parseNumberInput(limitRaw ?? '');
      const window = parseNumberInput(windowRaw ?? '');
      if (limit === null || window === null || limit < 2 || window < 2) {
        await ctx.reply('مقادیر نامعتبر است. نمونه: <code>6 10</code>');
        return;
      }
      const settings = await settingsFor(ctx);
      settings.floodLimit = limit;
      settings.floodWindowSeconds = window;
      await saveSettings(ctx, settings);
      await ctx.clearFlow();
      await renderSettings(ctx);
    },
    group_rules: async (ctx) => {
      const settings = await settingsFor(ctx);
      settings.rules = ctx.text.trim().slice(0, 1500);
      await saveSettings(ctx, settings);
      await ctx.clearFlow();
      await ctx.reply('قوانین گروه به‌روزرسانی شد.');
    },
    group_welcome: async (ctx) => {
      const settings = await settingsFor(ctx);
      settings.welcome = ctx.text.trim().slice(0, 500);
      await saveSettings(ctx, settings);
      await ctx.clearFlow();
      await ctx.reply('پیام خوش‌آمد به‌روزرسانی شد.');
    },
    group_word: async (ctx) => {
      const word = ctx.text.trim().toLowerCase();
      if (word.length < 2) {
        await ctx.reply('کلمه نامعتبر است.');
        return;
      }
      const settings = await settingsFor(ctx);
      if (!settings.bannedWords.includes(word)) settings.bannedWords.push(word);
      await saveSettings(ctx, settings);
      await ctx.clearFlow();
      await ctx.reply(`کلمه «${ctx.escape(word)}» به فهرست ممنوعه اضافه شد.`);
    },
  },
  async onCommand(ctx, command) {
    if (command === 'rules') {
      await groupManagerBot.actions.rules(ctx);
      return true;
    }
    if (command === 'settings') {
      await renderSettings(ctx);
      return true;
    }
    if (command === 'warn') {
      if (!(await requireAdmin(ctx))) return true;
      const target = ctx.message.replyToMessageId;
      const settings = await settingsFor(ctx);
      const targetId = ctx.params[0] ?? (target ? `reply:${target}` : '');
      if (!targetId) {
        await ctx.reply('روی پیام کاربر پاسخ دهید یا شناسه او را وارد کنید.');
        return true;
      }
      settings.warnings[targetId] = (settings.warnings[targetId] ?? 0) + 1;
      await saveSettings(ctx, settings);
      const warnLimit = await ctx.getSetting<number>('warnLimit', 3);
      if (settings.warnings[targetId] >= warnLimit) {
        await ctx.reply(`کاربر به سقف ${fa(warnLimit)} اخطار رسید.`);
      } else {
        await ctx.reply(`اخطار ثبت شد (${fa(settings.warnings[targetId])} از ${fa(warnLimit)}).`);
      }
      return true;
    }
    if (command === 'resetwarns') {
      if (!(await requireAdmin(ctx))) return true;
      const settings = await settingsFor(ctx);
      settings.warnings = {};
      await saveSettings(ctx, settings);
      await ctx.reply('اخطارها پاک شد.');
      return true;
    }
    if (command === 'ban') {
      if (!(await requireAdmin(ctx))) return true;
      const target = ctx.params[0];
      if (!target) {
        await ctx.reply('شناسه کاربر را وارد کنید: /ban 123456789');
        return true;
      }
      if (!ctx.api.banChatMember) {
        await ctx.reply('این پلتفرم امکان اخراج کاربر را از طریق API فراهم نمی‌کند.');
        return true;
      }
      const ok = await ctx.api.banChatMember(ctx.message.chatId, target);
      await ctx.reply(ok ? 'کاربر از گروه حذف شد.' : 'حذف کاربر ممکن نشد.');
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    if (ctx.isGroup) {
      const settings = await settingsFor(ctx);
      await ctx.reply(
        `<b>مدیریت گروه فعال شد</b>\n\nقوانین:\n${ctx.escape(truncateText(settings.rules, 600))}\n\n` +
          'برای تنظیمات: /settings',
      );
      return;
    }
    await ctx.reply(
      '<b>مدیریت گروه</b>\n\nاین ربات را به گروه اضافه کنید و آن را مدیر کنید. سپس با /settings تنظیمات را انجام دهید.',
    );
  },
  onText: async (ctx) => {
    if (!ctx.isGroup) {
      await ctx.reply('این ربات برای گروه‌ها طراحی شده است.');
      return;
    }
    const settings = await settingsFor(ctx);
    const text = ctx.text;
    const isAdmin = ctx.isAdmin;

    if (!isAdmin && settings.antiSpam) {
      const lowered = text.toLowerCase();
      const banned = settings.bannedWords.find((word) => lowered.includes(word));
      if (banned) {
        if (ctx.message.messageId) await ctx.deleteMessage(ctx.message.messageId);
        await ctx.reply(`پیام به دلیل استفاده از کلمه ممنوعه حذف شد: <code>${ctx.escape(banned)}</code>`);
        settings.warnings[ctx.user.platformUserId] = (settings.warnings[ctx.user.platformUserId] ?? 0) + 1;
        await saveSettings(ctx, settings);
        const warnLimit = await ctx.getSetting<number>('warnLimit', 3);
        if (settings.warnings[ctx.user.platformUserId] >= warnLimit) {
          await ctx.notifyAdmin(`کاربر ${ctx.user.platformUserId} به سقف اخطار رسید.`);
        }
        return;
      }
      if (settings.antiLink && /(https?:\/\/|t\.me\/|telegram\.me\/|www\.)/i.test(text)) {
        if (ctx.message.messageId) await ctx.deleteMessage(ctx.message.messageId);
        await ctx.reply('ارسال لینک در این گروه مجاز نیست.');
        return;
      }
      if (settings.antiFlood) {
        const allowed = await ctx.guardRate(
          `groupflood:${ctx.message.chatId}`,
          settings.floodLimit,
          settings.floodWindowSeconds * 1000,
        );
        if (!allowed) {
          if (ctx.message.messageId) await ctx.deleteMessage(ctx.message.messageId);
          await ctx.reply('سرعت ارسال پیام‌ها زیاد است. کمی صبر کنید.');
          return;
        }
      }
    }
    if (/^\/rules/.test(text)) {
      await ctx.reply(`<b>قوانین گروه</b>\n\n${ctx.escape(settings.rules)}`);
      return;
    }
    if (/^سلام|^درود|^hi\b/i.test(text) && Math.random() < 0.25) {
      await ctx.reply('سلام. برای دیدن قوانین /rules را بزنید.');
    }
  },
});

export type { GroupSettings };
