import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, saveDoc, truncateText } from '../kit';

const CONTENT_TYPES = [
  { id: 'post', label: 'پست شبکه اجتماعی', prompt: 'یک پست جذاب برای شبکه اجتماعی بنویس' },
  { id: 'article', label: 'مقاله', prompt: 'یک مقاله ساختارمند با مقدمه، بدنه و نتیجه‌گیری بنویس' },
  { id: 'caption', label: 'کپشن', prompt: 'یک کپشن کوتاه و تأثیرگذار با هشتگ مناسب بنویس' },
  { id: 'email', label: 'ایمیل', prompt: 'یک ایمیل حرفه‌ای با موضوع، متن و امضای مناسب بنویس' },
  { id: 'ad', label: 'تبلیغات', prompt: 'یک متن تبلیغاتی متقاعدکننده با چند نسخه بنویس' },
  { id: 'script', label: 'اسکریپت ویدیو', prompt: 'یک اسکریپت ویدیوی کوتاه با قلاب، بدنه و فراخوان اقدام بنویس' },
];

const TONES = [
  { id: 'professional', label: 'حرفه‌ای' },
  { id: 'friendly', label: 'دوستانه' },
  { id: 'funny', label: 'طنزآمیز' },
  { id: 'persuasive', label: 'ترغیبی' },
];

const LENGTHS = [
  { id: 'short', label: 'کوتاه', hint: 'حداکثر ۸۰ کلمه' },
  { id: 'medium', label: 'متوسط', hint: 'حدود ۲۰۰ کلمه' },
  { id: 'long', label: 'بلند', hint: 'حدود ۵۰۰ کلمه' },
];

const toneLabel = (id: string) => TONES.find((tone) => tone.id === id)?.label ?? id;

async function generate(ctx: BotContext): Promise<void> {
  if (!ctx.services.ai.available) {
    await ctx.reply('سرویس هوش مصنوعی پیکربندی نشده است. مدیر ربات باید AI_API_KEY را تنظیم کند.');
    return;
  }
  if (!(await ctx.guardRate('write', 8, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  const data = ctx.flow?.data ?? {};
  const type = CONTENT_TYPES.find((item) => item.id === data.type) ?? CONTENT_TYPES[0];
  const tone = toneLabel(String(data.tone ?? 'professional'));
  const length = LENGTHS.find((item) => item.id === data.length) ?? LENGTHS[1];
  const topic = String(data.topic ?? '');
  const audience = String(data.audience ?? 'مخاطب عمومی');
  await ctx.typing();
  const output = await ctx.services.ai.complete(
    `${type.prompt}.\n\nموضوع: ${topic}\nمخاطب: ${audience}\nلحن: ${tone}\nطول: ${length.hint}\n\nفقط متن نهایی را بنویس و از توضیح اضافه خودداری کن.`,
    'تو یک نویسنده محتوای حرفه‌ای فارسی‌زبان هستی. خروجی باید آماده انتشار باشد.',
    { temperature: 0.8 },
  );
  const chunks = output.match(/[\s\S]{1,3500}/g) ?? [output];
  for (const chunk of chunks.slice(0, 4)) {
    await ctx.reply(ctx.escape(chunk));
  }
  await saveDoc(ctx.storage, ctx.bot.id, 'content', `content_${ctx.user.id}_${Date.now()}`, {
    userId: ctx.user.id,
    type: type.id,
    tone,
    topic,
    output: output.slice(0, 6000),
    createdAt: new Date().toISOString(),
  });
  await ctx.clearFlow();
  await ctx.reply('خروجی را چطور تغییر دهم؟', {
    inline: {
      rows: [
        [
          { text: 'کوتاه‌تر کن', callbackData: `a:revise:shorten|${encodeURIComponent(truncateText(output, 1200))}` },
          { text: 'بازنویسی', callbackData: `a:revise:rewrite|${encodeURIComponent(truncateText(output, 1200))}` },
        ],
        [{ text: 'محتوای جدید', callbackData: 'a:start' }],
      ],
    },
  });
}

export const contentWriterBot = defineBot({
  id: 'content-writer',
  name: 'نویسنده محتوا',
  category: 'D',
  summary: 'تولید پست، مقاله، کپشن، ایمیل و متن تبلیغاتی با لحن و طول دلخواه',
  description:
    'با انتخاب نوع محتوا، لحن، طول و مخاطب، متن آماده انتشار تولید می‌کند. امکان کوتاه‌کردن یا بازنویسی خروجی وجود دارد و تاریخچه محتواها ذخیره می‌شود.',
  icon: 'pen-tool',
  tags: ['ai', 'content'],
  commands: [
    { command: 'write', description: 'ساخت محتوای جدید' },
    { command: 'history', description: 'تاریخچه محتوا' },
  ],
  menu: [
    { id: 'start', label: 'محتوای جدید' },
    { id: 'history', label: 'تاریخچه' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای تولید محتوا.',
      required: true,
      env: 'AI_API_KEY',
    },
  ],
  defaultConfig: { defaultTone: 'professional', defaultLength: 'medium' },
  actions: {
    start: async (ctx) => {
      await ctx.setFlow('content_type', {});
      await ctx.reply('نوع محتوا را انتخاب کنید:', {
        inline: { rows: chunkButtons(CONTENT_TYPES.map((type) => ({ text: type.label, data: `a:type:${type.id}` })), 2).rows },
      });
    },
    type: async (ctx, param) => {
      await ctx.setFlow('content_topic', { type: param });
      await ctx.reply('موضوع محتوا را در یک خط بنویسید:');
    },
    tone: async (ctx, param) => {
      await ctx.setFlow('content_length', { ...(ctx.flow?.data ?? {}), tone: param });
      await ctx.reply('طول محتوا را انتخاب کنید:', {
        inline: { rows: chunkButtons(LENGTHS.map((length) => ({ text: length.label, data: `a:length:${length.id}` })), 3).rows },
      });
    },
    length: async (ctx, param) => {
      await ctx.updateFlow({ length: param });
      await generate(ctx);
    },
    revise: async (ctx, param) => {
      const [mode, encoded] = (param ?? '').split('|');
      if (!encoded) {
        await ctx.reply('محتوایی برای ویرایش وجود ندارد.');
        return;
      }
      const text = decodeURIComponent(encoded);
      if (!ctx.services.ai.available) {
        await ctx.reply('سرویس هوش مصنوعی پیکربندی نشده است.');
        return;
      }
      const output = await ctx.services.ai.complete(
        mode === 'shorten'
          ? `متن زیر را حداکثر در ۶۰٪ طول اصلی و بدون از دست دادن پیام اصلی کوتاه کن:\n\n${text}`
          : `متن زیر را با ساختار و لحن بهتر بازنویسی کن:\n\n${text}`,
        'تو یک ویراستار حرفه‌ای فارسی هستی.',
      );
      await ctx.reply(ctx.escape(output));
    },
    history: async (ctx) => {
      const result = await ctx.storage.documents.list(ctx.bot.id, 'content', { pageSize: 100 });
      const mine = result.items
        .map((item) => item.data as Record<string, unknown>)
        .filter((item) => item.userId === ctx.user.id)
        .slice(0, 6);
      if (mine.length === 0) {
        await ctx.reply('تاریخچه‌ای وجود ندارد.');
        return;
      }
      const lines = ['<b>تاریخچه محتوا</b>', ''];
      for (const item of mine) {
        lines.push(`• ${CONTENT_TYPES.find((type) => type.id === item.type)?.label ?? item.type} — ${ctx.escape(truncateText(String(item.topic ?? ''), 40))}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  },
  steps: {
    content_topic: async (ctx) => {
      const topic = ctx.text.trim();
      if (topic.length < 3) {
        await ctx.reply('موضوع خیلی کوتاه است.');
        return;
      }
      await ctx.setFlow('content_audience', { ...(ctx.flow?.data ?? {}), topic: topic.slice(0, 200) });
      await ctx.reply('مخاطب هدف را بنویسید (نمونه: مدیران فروشگاه‌های اینترنتی) یا «-» بفرستید:');
    },
    content_audience: async (ctx) => {
      const audience = ctx.text.trim() === '-' ? 'مخاطب عمومی' : ctx.text.trim().slice(0, 200);
      await ctx.setFlow('content_tone', { ...(ctx.flow?.data ?? {}), audience });
      await ctx.reply('لحن متن را انتخاب کنید:', {
        inline: { rows: chunkButtons(TONES.map((tone) => ({ text: tone.label, data: `a:tone:${tone.id}` })), 2).rows },
      });
    },
    content_length: async (ctx) => {
      const parts = ctx.text.trim().split(/\s+/);
      await generate(ctx);
      void parts;
    },
  },
  async onStart(ctx) {
    await ctx.reply(
      '<b>نویسنده محتوا</b>\n\nنوع محتوا را انتخاب کنید تا متن آماده انتشار بسازم.\n' +
        `وضعیت سرویس: ${ctx.services.ai.available ? 'متصل' : 'نیازمند کلید API'}`,
      {
        inline: {
          rows: [
            ...chunkButtons(CONTENT_TYPES.map((type) => ({ text: type.label, data: `a:type:${type.id}` })), 2).rows,
            [{ text: 'تاریخچه', callbackData: 'a:history' }],
          ],
        },
      },
    );
  },
  onText: async (ctx) => {
    await ctx.reply('برای ساخت محتوا از منو شروع کنید.', {
      inline: { rows: [[{ text: 'محتوای جدید', callbackData: 'a:start' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'write') {
      await contentWriterBot.actions.start(ctx);
      return true;
    }
    if (command === 'history') {
      await contentWriterBot.actions.history(ctx);
      return true;
    }
    return false;
  },
});

export { CONTENT_TYPES, TONES, LENGTHS, fa as writerFa };
