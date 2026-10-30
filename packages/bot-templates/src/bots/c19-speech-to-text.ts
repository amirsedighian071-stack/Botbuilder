import type { BotContext } from '@botforge/core';
import { defineBot, fa, saveDoc, truncateText } from '../kit';

async function transcribe(ctx: BotContext, attachment: { fileId?: string; fileName?: string }, language = 'fa'): Promise<void> {
  if (!attachment.fileId) {
    await ctx.reply('فایل صوتی معتبر نیست.');
    return;
  }
  if (!ctx.services.speech.sttAvailable) {
    await ctx.reply(
      'سرویس تبدیل گفتار به متن پیکربندی نشده است.\nمدیر ربات می‌تواند کلید هوش مصنوعی (AI_API_KEY) را در پنل مدیریت تنظیم کند.',
    );
    return;
  }
  if (!(await ctx.guardRate('stt', 5, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const url = await ctx.api.getFileUrl(attachment.fileId);
  if (!url) {
    await ctx.reply('دریافت فایل صوتی از پیام‌رسان ممکن نشد.');
    return;
  }
  const text = await ctx.services.speech.transcribe(url, attachment.fileName ?? 'audio.ogg');
  if (!text.trim()) {
    await ctx.reply('متنی از این فایل استخراج نشد.');
    return;
  }
  const stored = await saveDoc(ctx.storage, ctx.bot.id, 'transcripts', `tr_${ctx.user.id}_${Date.now()}`, {
    userId: ctx.user.id,
    text: text.slice(0, 20_000),
    language,
    createdAt: new Date().toISOString(),
  });
  const chunks = text.match(/[\s\S]{1,3500}/g) ?? [text];
  for (const chunk of chunks.slice(0, 5)) {
    await ctx.reply(`<b>متن پیاده‌شده</b>\n\n${ctx.escape(chunk)}`);
  }
  await ctx.reply(
    `طول متن: ${fa(text.length)} کاراکتر | تعداد کلمات: ${fa(text.split(/\s+/).filter(Boolean).length)}`,
    {
      inline: {
        rows: [
          [{ text: 'خلاصه هوشمند', callbackData: `a:summarize:${stored.id}` }],
          [{ text: 'ترجمه', callbackData: `a:translate:${stored.id}` }],
        ],
      },
    },
  );
  await ctx.recordEvent('stt.completed', 'info', { chars: text.length });
}

export const speechToTextBot = defineBot({
  id: 'speech-to-text',
  name: 'تبدیل صدا به متن',
  category: 'C',
  summary: 'پیاده‌سازی صوتی با دقت بالا، خلاصه‌سازی و ترجمه متن',
  description:
    'ویس، فایل صوتی یا ویدیو را دریافت می‌کند و با مدل گفتار به متن آن را پیاده می‌کند. متن ذخیره می‌شود و کاربر می‌تواند خلاصه هوشمند یا ترجمه دریافت کند. محدودیت حجم، کنترل نرخ و مدیریت خطای سرویس در آن پیاده‌سازی شده است.',
  icon: 'audio-lines',
  tags: ['ai', 'media'],
  commands: [
    { command: 'transcribe', description: 'راهنمای تبدیل صدا به متن' },
    { command: 'last', description: 'آخرین متن پیاده‌شده' },
  ],
  menu: [
    { id: 'help', label: 'راهنما' },
    { id: 'last', label: 'آخرین متن' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای سرویس تبدیل گفتار به متن (Whisper).',
      required: true,
      env: 'AI_API_KEY',
    },
  ],
  defaultConfig: { language: 'fa', maxSeconds: 600 },
  actions: {
    help: async (ctx) => {
      await ctx.reply(
        '<b>تبدیل صدا به متن</b>\n\nویس یا فایل صوتی خود را ارسال کنید.\n' +
          `وضعیت سرویس: ${ctx.services.speech.sttAvailable ? 'آماده' : 'پیکربندی نشده'}\n\n` +
          'بعد از تبدیل می‌توانید خلاصه یا ترجمه متن را بگیرید.',
      );
    },
    last: async (ctx) => {
      const result = await ctx.storage.documents.list(ctx.bot.id, 'transcripts', { pageSize: 50 });
      const mine = result.items
        .map((item) => item.data as Record<string, unknown>)
        .filter((item) => item.userId === ctx.user.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const last = mine[0];
      if (!last) {
        await ctx.reply('هنوز متنی پیاده‌سازی نشده است.');
        return;
      }
      await ctx.reply(`<b>آخرین متن</b>\n\n${ctx.escape(truncateText(String(last.text ?? ''), 3000))}`);
    },
    summarize: async (ctx, param) => {
      const doc = await ctx.storage.documents.findById(ctx.bot.id, param ?? '');
      if (!doc) {
        await ctx.reply('متن پیدا نشد.');
        return;
      }
      const text = String((doc.data as Record<string, unknown>).text ?? '');
      if (!ctx.services.ai.available) {
        await ctx.reply('سرویس هوش مصنوعی پیکربندی نشده است.');
        return;
      }
      const summary = await ctx.services.ai.complete(
        `متن پیاده‌شده زیر را در چند بولت فارسی خلاصه کن:\n\n${truncateText(text, 6000)}`,
        'خلاصه‌ساز حرفه‌ای فارسی. فقط خلاصه را برگردان.',
      );
      await ctx.reply(`<b>خلاصه</b>\n\n${ctx.escape(summary)}`);
    },
    translate: async (ctx, param) => {
      const doc = await ctx.storage.documents.findById(ctx.bot.id, param ?? '');
      if (!doc) {
        await ctx.reply('متن پیدا نشد.');
        return;
      }
      const text = String((doc.data as Record<string, unknown>).text ?? '');
      if (!ctx.services.ai.available) {
        await ctx.reply('سرویس هوش مصنوعی پیکربندی نشده است.');
        return;
      }
      const translated = await ctx.services.ai.translate(truncateText(text, 5000), 'English');
      await ctx.reply(`<b>ترجمه</b>\n\n${ctx.escape(translated)}`);
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>تبدیل صدا به متن</b>\n\nویس یا فایل صوتی خود را ارسال کنید.', {
      inline: {
        rows: [
          [{ text: 'راهنما', callbackData: 'a:help' }],
          [{ text: 'آخرین متن', callbackData: 'a:last' }],
        ],
      },
    });
  },
  async onMedia(ctx, attachment) {
    if (!['voice', 'audio', 'video', 'document'].includes(attachment.type)) {
      await ctx.reply('ویس یا فایل صوتی ارسال کنید.');
      return;
    }
    const language = await ctx.getSetting<string>('language', 'fa');
    await transcribe(ctx, attachment, language);
  },
  onText: async (ctx) => {
    await ctx.reply('ویس یا فایل صوتی خود را ارسال کنید.', {
      inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'transcribe') {
      await ctx.reply('ویس خود را ارسال کنید.');
      return true;
    }
    if (command === 'last') {
      await speechToTextBot.actions.last(ctx);
      return true;
    }
    return false;
  },
});
