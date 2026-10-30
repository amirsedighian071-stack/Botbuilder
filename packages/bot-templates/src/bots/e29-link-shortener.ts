import type { BotContext } from '@botforge/core';
import { defineBot, fa, listDocs, saveDoc, truncateText } from '../kit';

const URL_PATTERN = /(https?:\/\/[^\s]+)/i;
const LINKS = 'links';

async function shorten(ctx: BotContext, url: string): Promise<void> {
  if (!URL_PATTERN.test(url)) {
    await ctx.reply('لینک معتبر (http/https) ارسال کنید.');
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await ctx.reply('لینک معتبر نیست.');
    return;
  }
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)) {
    await ctx.reply('این آدرس قابل کوتاه‌سازی نیست.');
    return;
  }
  if (!(await ctx.guardRate('shorten', 6, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const short = await ctx.services.links.shorten(url);
  await saveDoc(ctx.storage, ctx.bot.id, LINKS, `link_${Date.now()}_${ctx.user.id.slice(-4)}`, {
    userId: ctx.user.id,
    original: url.slice(0, 2000),
    short,
    clicks: 0,
    createdAt: new Date().toISOString(),
  });
  await ctx.reply(
    `<b>لینک کوتاه</b>\n\n<code>${ctx.escape(short)}</code>\n\n<code>${ctx.escape(truncateText(url, 120))}</code>`,
    {
      inline: {
        rows: [
          [{ text: 'باز کردن', url: short }],
          [{ text: 'کوتاه‌کردن لینک دیگر', callbackData: 'a:new' }],
        ],
      },
    },
  );
}

async function renderHistory(ctx: BotContext): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, LINKS, 1, 200);
  const mine = result.items
    .map((item) => item.data as Record<string, unknown>)
    .filter((item) => item.userId === ctx.user.id)
    .slice(0, 8);
  if (mine.length === 0) {
    await ctx.reply('هنوز لینکی کوتاه نکرده‌اید.');
    return;
  }
  const lines = ['<b>لینک‌های کوتاه شما</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  mine.forEach((item, index) => {
    lines.push(`${fa(index + 1)}. ${ctx.escape(String(item.short))}`);
    rows.push([
      { text: `گسترش ${fa(index + 1)}`, callbackData: `a:expand:${encodeURIComponent(String(item.short))}` },
      { text: `کپی ${fa(index + 1)}`, callbackData: `a:copy:${encodeURIComponent(String(item.short))}` },
    ]);
  });
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const linkShortenerBot = defineBot({
  id: 'link-shortener',
  name: 'کوتاه‌کننده لینک',
  category: 'E',
  summary: 'کوتاه‌سازی و گسترش لینک با تاریخچه و کنترل نرخ',
  description:
    'لینک‌های بلند را با سرویس‌های عمومی (is.gd و TinyURL) کوتاه می‌کند و امکان گسترش لینک کوتاه به آدرس اصلی را می‌دهد. تاریخچه لینک‌های هر کاربر ذخیره می‌شود، محدودیت نرخ اعمال می‌گردد و آدرس‌های داخلی مسدود می‌شوند.',
  icon: 'link',
  tags: ['utility'],
  commands: [
    { command: 'short', description: 'کوتاه‌کردن لینک' },
    { command: 'expand', description: 'گسترش لینک کوتاه' },
    { command: 'links', description: 'تاریخچه لینک‌ها' },
  ],
  menu: [
    { id: 'new', label: 'کوتاه‌کردن لینک' },
    { id: 'history', label: 'تاریخچه' },
  ],
  defaultConfig: { provider: 'is.gd' },
  actions: {
    new: async (ctx) => {
      await ctx.ask('لینک خود را ارسال کنید تا کوتاه شود.', 'shorten_input');
    },
    history: async (ctx) => renderHistory(ctx),
    expand: async (ctx, param) => {
      if (!param) return;
      const short = decodeURIComponent(param);
      await ctx.typing();
      const expanded = await ctx.services.links.expand(short);
      await ctx.reply(`<b>لینک اصلی</b>\n\n<code>${ctx.escape(expanded)}</code>`);
    },
    copy: async (ctx, param) => {
      if (!param) return;
      await ctx.reply(`<code>${ctx.escape(decodeURIComponent(param))}</code>\nبرای کپی، روی متن بالا ضربه بزنید.`);
    },
  },
  steps: {
    shorten_input: async (ctx) => {
      const match = ctx.text.match(URL_PATTERN);
      await ctx.clearFlow();
      if (!match) {
        await ctx.reply('لینک معتبر پیدا نشد.');
        return;
      }
      await shorten(ctx, match[1]);
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>کوتاه‌کننده لینک</b>\n\nلینک خود را ارسال کنید یا تاریخچه را ببینید.', {
      inline: {
        rows: [
          [{ text: 'کوتاه‌کردن لینک', callbackData: 'a:new' }],
          [{ text: 'تاریخچه', callbackData: 'a:history' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    const match = ctx.text.match(URL_PATTERN);
    if (!match) {
      await ctx.reply('لینک معتبر ارسال کنید.');
      return;
    }
    await shorten(ctx, match[1]);
  },
  async onCommand(ctx, command) {
    if (command === 'short') {
      const url = ctx.params[0];
      if (url) {
        await shorten(ctx, url);
        return true;
      }
      await ctx.ask('لینک خود را ارسال کنید.', 'shorten_input');
      return true;
    }
    if (command === 'expand') {
      const url = ctx.params[0];
      if (!url) {
        await ctx.reply('لینک کوتاه را وارد کنید: /expand https://is.gd/xxxx');
        return true;
      }
      const expanded = await ctx.services.links.expand(url);
      await ctx.reply(`<b>لینک اصلی</b>\n\n<code>${ctx.escape(expanded)}</code>`);
      return true;
    }
    if (command === 'links') {
      await renderHistory(ctx);
      return true;
    }
    return false;
  },
});

export { shorten as shortenUrl };
