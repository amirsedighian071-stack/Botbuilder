import type { BotContext } from '@botforge/core';
import { defineBot, fa, saveDoc, truncateText } from '../kit';

const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

function extractiveSummary(text: string, maxSentences = 5): string {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?؟])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
  if (sentences.length === 0) return truncateText(text, 800);
  const frequencies = new Map<string, number>();
  const stopWords = new Set(['و', 'در', 'به', 'از', 'که', 'این', 'را', 'با', 'است', 'for', 'the', 'and', 'that', 'with', 'this']);
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) {
      const normalized = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (normalized.length < 3 || stopWords.has(normalized)) continue;
      frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
    }
  }
  const scored = sentences.map((sentence, index) => {
    let score = 0;
    for (const word of sentence.split(/\s+/)) {
      const normalized = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      score += frequencies.get(normalized) ?? 0;
    }
    return { sentence, score, index };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
    .join(' ');
}

async function summarizeLink(ctx: BotContext, url: string): Promise<void> {
  if (!URL_PATTERN.test(url)) {
    await ctx.reply('لینک معتبر ارسال کنید.');
    return;
  }
  if (!(await ctx.guardRate('summarize', 5, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const article = await ctx.services.media.summarizeUrl(url);
  if (article.text.length < 200) {
    await ctx.reply('محتوای کافی در این صفحه پیدا نشد.');
    return;
  }
  let summary: string;
  let mode = 'خلاصه استخراجی';
  if (ctx.services.ai.available) {
    summary = await ctx.services.ai.complete(
      `متن زیر را در حداکثر ۵ بولت فارسی خلاصه کن و در پایان ۳ نکته کلیدی جدا کن.\n\nعنوان: ${article.title}\nمتن:\n${truncateText(article.text, 7000)}`,
      'تو یک تحلیلگر محتوای فارسی هستی. فقط خلاصه ساختارمند برگردان.',
    );
    mode = 'خلاصه هوشمند';
  } else {
    summary = extractiveSummary(article.text);
  }
  await ctx.reply(
    `<b>${ctx.escape(truncateText(article.title, 200))}</b>\n${article.siteName ? `<i>${ctx.escape(article.siteName)}</i>\n` : ''}\n` +
      `${ctx.escape(summary)}\n\n<i>${mode} — ${fa(article.text.length)} کاراکتر متن اصلی</i>`,
    {
      inline: {
        rows: [
          [
            { text: 'کوتاه‌تر', callbackData: `a:short|${encodeURIComponent(truncateText(summary, 1200))}` },
            { text: 'باز کردن لینک', url },
          ],
        ],
      },
    },
  );
  await saveDoc(ctx.storage, ctx.bot.id, 'summaries', `sum_${ctx.user.id}_${Date.now()}`, {
    userId: ctx.user.id,
    url,
    title: article.title,
    summary: summary.slice(0, 4000),
    createdAt: new Date().toISOString(),
  });
  await ctx.recordEvent('summarize.link', 'info', { url: article.url.slice(0, 120) });
}

export const linkSummarizerBot = defineBot({
  id: 'link-summarizer',
  name: 'خلاصه‌ساز لینک و مقاله',
  category: 'D',
  summary: 'خواندن مقاله و خلاصه‌سازی هوشمند با محافظت کامل در برابر SSRF',
  description:
    'لینک مقاله را می‌خواند و خلاصه ساختارمند ارائه می‌دهد. درخواست‌های خروجی از محافظت SSRF عبور می‌کنند (بلاک شبکه‌های داخلی، پورت‌های غیرمجاز و دامنه‌های محلی)، محدودیت حجم پاسخ اعمال می‌شود و در نبود هوش مصنوعی خلاصه استخراجی تولید می‌شود.',
  icon: 'file-text',
  tags: ['ai', 'content', 'security'],
  commands: [
    { command: 'summary', description: 'خلاصه‌سازی لینک' },
    { command: 'history', description: 'تاریخچه خلاصه‌ها' },
  ],
  menu: [
    { id: 'howto', label: 'راهنما' },
    { id: 'history', label: 'تاریخچه' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای خلاصه هوشمند؛ بدون آن خلاصه استخراجی ارائه می‌شود.',
      required: false,
      env: 'AI_API_KEY',
    },
  ],
  defaultConfig: { maxChars: 8000 },
  actions: {
    howto: async (ctx) => {
      await ctx.reply(
        '<b>خلاصه‌ساز لینک</b>\n\nلینک مقاله یا صفحه خبری را ارسال کنید تا خلاصه آن را دریافت کنید.\n\n' +
          '• فقط آدرس‌های عمومی http/https پذیرفته می‌شوند.\n• آدرس‌های شبکه داخلی و پورت‌های غیرمجاز بلاک می‌شوند.\n' +
          '• برای خلاصه هوشمند، کلید هوش مصنوعی لازم است.',
      );
    },
    history: async (ctx) => {
      const result = await ctx.storage.documents.list(ctx.bot.id, 'summaries', { pageSize: 100 });
      const mine = result.items
        .map((item) => item.data as Record<string, unknown>)
        .filter((item) => item.userId === ctx.user.id)
        .slice(0, 6);
      if (mine.length === 0) {
        await ctx.reply('خلاصه‌ای ذخیره نشده است.');
        return;
      }
      const lines = ['<b>خلاصه‌های اخیر</b>', ''];
      for (const item of mine) {
        lines.push(`• ${ctx.escape(truncateText(String(item.title ?? item.url ?? ''), 80))}`);
      }
      await ctx.reply(lines.join('\n'));
    },
    short: async (ctx, param) => {
      if (!param) return;
      const text = decodeURIComponent(param);
      if (ctx.services.ai.available) {
        const shorter = await ctx.services.ai.complete(
          `این خلاصه را در حداکثر ۳ جمله فارسی فشرده کن:\n\n${text}`,
          'خلاصه‌ساز حرفه‌ای فارسی.',
        );
        await ctx.reply(ctx.escape(shorter));
        return;
      }
      await ctx.reply(ctx.escape(truncateText(text, 400)));
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>خلاصه‌ساز لینک</b>\n\nلینک مقاله را ارسال کنید.', {
      inline: { rows: [[{ text: 'راهنما', callbackData: 'a:howto' }]] },
    });
  },
  onText: async (ctx) => {
    const match = ctx.text.match(URL_PATTERN);
    if (!match) {
      await ctx.reply('لینک معتبر (http/https) ارسال کنید.');
      return;
    }
    await summarizeLink(ctx, match[1]);
  },
  async onCommand(ctx, command) {
    if (command === 'summary') {
      const url = ctx.params[0];
      if (!url) {
        await ctx.reply('لینک را بعد از دستور ارسال کنید: /summary https://example.com/article');
        return true;
      }
      await summarizeLink(ctx, url);
      return true;
    }
    if (command === 'history') {
      await linkSummarizerBot.actions.history(ctx);
      return true;
    }
    return false;
  },
});

export { extractiveSummary };
