import type { BotContext } from '@botforge/core';
import { defineBot, fa, truncateText } from '../kit';

const TOPICS: Array<{ id: string; label: string; topic: string }> = [
  { id: 'world', label: 'جهان', topic: 'world' },
  { id: 'iran', label: 'ایران', topic: 'iran' },
  { id: 'tech', label: 'فناوری', topic: 'technology' },
  { id: 'business', label: 'اقتصاد', topic: 'business' },
  { id: 'sport', label: 'ورزش', topic: 'sport' },
  { id: 'science', label: 'علم', topic: 'science' },
];

async function sendNews(ctx: BotContext, topic: string, page = 1): Promise<void> {
  if (!(await ctx.guardRate('news', 8, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. یک دقیقه بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const limit = await ctx.getSetting<number>('itemsPerPage', 5);
  const effectiveLimit = Math.min(Math.max(Number(limit) || 5, 3), 10);
  const items = await ctx.services.news.latest({ topic, limit: effectiveLimit * 2 });
  const start = (page - 1) * effectiveLimit;
  const pageItems = items.slice(start, start + effectiveLimit);
  if (pageItems.length === 0) {
    await ctx.reply('خبری برای این دسته پیدا نشد.');
    return;
  }
  const label = TOPICS.find((item) => item.topic === topic)?.label ?? topic;
  const lines = [`<b>اخبار ${label}</b>`, ''];
  pageItems.forEach((item, index) => {
    lines.push(`${start + index + 1}. <a href="${escapeAttr(item.link)}">${ctx.escape(truncateText(item.title, 140))}</a>`);
    lines.push(`   ${ctx.escape(item.source)} — ${ctx.formatDateTime(item.publishedAt)}`);
    if (item.summary) lines.push(`   ${ctx.escape(truncateText(item.summary, 160))}`);
    lines.push('');
  });
  lines.push('برای خلاصه هوشمند هر خبر، دستور /summarize را همراه لینک ارسال کنید.');

  const topicButtons = TOPICS.map((item) => ({ text: item.label, callbackData: `a:topic:${item.topic}` }));
  const rows = [];
  for (let index = 0; index < topicButtons.length; index += 3) rows.push(topicButtons.slice(index, index + 3));
  const nav: Array<{ text: string; callbackData: string }> = [];
  if (page > 1) nav.push({ text: 'قبلی', callbackData: `a:topic:${topic}:${page - 1}` });
  if (items.length > start + effectiveLimit) nav.push({ text: 'بعدی', callbackData: `a:topic:${topic}:${page + 1}` });
  if (nav.length > 0) rows.push(nav);
  rows.push([{ text: 'منوی اصلی', callbackData: 'a:__menu' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows }, disablePreview: true });
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '%22').replace(/</g, '').replace(/>/g, '');
}

export const dailyNewsBot = defineBot({
  id: 'daily-news',
  name: 'اخبار روز دنیا',
  category: 'A',
  summary: 'آخرین اخبار جهان، ایران، فناوری، اقتصاد و ورزش با دسته‌بندی',
  description:
    'اخبار روز را از منابع معتبر بین‌المللی و فارسی‌زبان می‌خواند و در دسته‌بندی‌های مختلف نمایش می‌دهد. در صورت تنظیم کلید NewsAPI از جست‌وجوی پیشرفته و در غیر این صورت از خوراک RSS منابع استفاده می‌کند.',
  icon: 'newspaper',
  tags: ['news', 'content'],
  commands: [
    { command: 'news', description: 'آخرین اخبار' },
    { command: 'world', description: 'اخبار جهان' },
    { command: 'summarize', description: 'خلاصه‌سازی لینک خبر' },
  ],
  menu: [
    { id: 'topic:world', label: 'جهان' },
    { id: 'topic:iran', label: 'ایران' },
    { id: 'topic:technology', label: 'فناوری' },
    { id: 'topic:business', label: 'اقتصاد' },
    { id: 'topic:sport', label: 'ورزش' },
    { id: 'search', label: 'جست‌وجوی خبر' },
  ],
  requirements: [
    {
      key: 'NEWS_API_KEY',
      label: 'کلید NewsAPI',
      description: 'اختیاری؛ برای جست‌وجوی پیشرفته. بدون کلید از RSS استفاده می‌شود.',
      required: false,
      env: 'NEWS_API_KEY',
    },
    { key: 'AI_API_KEY', label: 'کلید هوش مصنوعی', description: 'برای خلاصه‌سازی هوشمند اخبار', required: false, env: 'AI_API_KEY' },
  ],
  defaultConfig: { itemsPerPage: 5 },
  actions: {
    topic: async (ctx, param) => {
      const parts = (param ?? 'world').split(':');
      const topic = parts[0] || 'world';
      const page = Number(parts[1] ?? 1) || 1;
      await sendNews(ctx, topic, page);
    },
    search: async (ctx) => {
      await ctx.ask('عبارت مورد جست‌وجو در اخبار را ارسال کنید.', 'search');
    },
    summarize: async (ctx) => {
      await ctx.ask('لینک خبر را ارسال کنید تا خلاصه شود.', 'summarize');
    },
  },
  steps: {
    search: async (ctx) => {
      const query = ctx.text.trim();
      if (query.length < 2) {
        await ctx.reply('عبارت جست‌وجو خیلی کوتاه است.');
        return;
      }
      await ctx.clearFlow();
      if (!ctx.services.isConfigured('NEWS_API_KEY')) {
        await ctx.reply('برای جست‌وجو، کلید NewsAPI لازم است. مدیر ربات می‌تواند آن را از پنل تنظیم کند.');
        return;
      }
      const items = await ctx.services.news.latest({ topic: query, limit: 6 });
      const lines = [`<b>نتایج جست‌وجو: ${ctx.escape(query)}</b>`, ''];
      items.forEach((item, index) => {
        lines.push(`${index + 1}. <a href="${escapeAttr(item.link)}">${ctx.escape(truncateText(item.title, 130))}</a>`);
        lines.push(`   ${ctx.escape(item.source)} — ${ctx.formatDateTime(item.publishedAt)}`);
      });
      await ctx.reply(lines.join('\n'));
    },
    summarize: async (ctx) => {
      const url = ctx.text.trim();
      await ctx.clearFlow();
      const article = await ctx.services.media.summarizeUrl(url);
      if (!ctx.services.ai.available) {
        await ctx.reply(
          `<b>${ctx.escape(article.title)}</b>\n\n${ctx.escape(truncateText(article.text, 2500))}\n\n` +
            'برای خلاصه‌سازی هوشمند، کلید AI_API_KEY را تنظیم کنید.',
        );
        return;
      }
      const summary = await ctx.services.ai.complete(
        `خبر زیر را در ۵ بولت فارسی خلاصه کن و نکات کلیدی را جدا کن:\n\nعنوان: ${article.title}\nمتن:\n${truncateText(article.text, 6000)}`,
        'تو یک روزنامه‌نگار دقیق فارسی‌زبان هستی. فقط خلاصه را برگردان.',
      );
      await ctx.reply(`<b>${ctx.escape(article.title)}</b>\n\n${ctx.escape(summary)}`);
    },
  },
  async onCommand(ctx, command) {
    if (command === 'news' || command === 'world') {
      await sendNews(ctx, 'world');
      return true;
    }
    if (['iran', 'tech', 'business', 'sport', 'science'].includes(command)) {
      const map: Record<string, string> = { iran: 'iran', tech: 'technology', business: 'business', sport: 'sport', science: 'science' };
      await sendNews(ctx, map[command]);
      return true;
    }
    return false;
  },
  onText: async (ctx) => {
    const url = ctx.text.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      await ctx.ask('این لینک را خلاصه کنم؟', 'summarize');
      await ctx.setFlow('summarize', {});
      const article = await ctx.services.media.summarizeUrl(url).catch(() => null);
      if (!article) {
        await ctx.reply('این لینک قابل خواندن نیست.');
        await ctx.clearFlow();
        return;
      }
      if (!ctx.services.ai.available) {
        await ctx.reply(`<b>${ctx.escape(article.title)}</b>\n\n${ctx.escape(truncateText(article.text, 2500))}`);
        await ctx.clearFlow();
        return;
      }
      const summary = await ctx.services.ai.complete(
        `این متن را در حداکثر ۶ بولت فارسی خلاصه کن:\n\n${truncateText(article.text, 6000)}`,
        'خلاصه‌ساز حرفه‌ای فارسی. فقط خلاصه را برگردان.',
      );
      await ctx.reply(`<b>${ctx.escape(article.title)}</b>\n\n${ctx.escape(summary)}`);
      await ctx.clearFlow();
      return;
    }
    await ctx.reply(`برای خواندن اخبار از منو استفاده کنید.\n${fa('')}`, {
      inline: { rows: [[{ text: 'اخبار جهان', callbackData: 'a:topic:world' }]] },
    });
  },
  async onStart(ctx) {
    await ctx.reply('<b>اخبار روز</b>\n\nدسته مورد نظر را انتخاب کنید.', {
      inline: {
        rows: [
          [
            { text: 'جهان', callbackData: 'a:topic:world' },
            { text: 'ایران', callbackData: 'a:topic:iran' },
          ],
          [
            { text: 'فناوری', callbackData: 'a:topic:technology' },
            { text: 'اقتصاد', callbackData: 'a:topic:business' },
          ],
          [{ text: 'منوی کامل', callbackData: 'a:__menu' }],
        ],
      },
    });
  },
});
