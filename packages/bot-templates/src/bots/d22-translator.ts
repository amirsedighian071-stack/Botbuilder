import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, saveDoc, truncateText } from '../kit';

const LANGUAGES = [
  { id: 'fa', label: 'فارسی' },
  { id: 'en', label: 'انگلیسی' },
  { id: 'ar', label: 'عربی' },
  { id: 'tr', label: 'ترکی' },
  { id: 'de', label: 'آلمانی' },
  { id: 'fr', label: 'فرانسوی' },
  { id: 'ru', label: 'روسی' },
  { id: 'zh', label: 'چینی' },
  { id: 'es', label: 'اسپانیایی' },
  { id: 'hi', label: 'هندی' },
];

const NAMES: Record<string, string> = {
  fa: 'فارسی',
  en: 'English',
  ar: 'العربية',
  tr: 'Türkçe',
  de: 'Deutsch',
  fr: 'Français',
  ru: 'Русский',
  zh: '中文',
  es: 'Español',
  hi: 'हिन्दी',
};

async function translateText(ctx: BotContext, text: string): Promise<void> {
  if (!ctx.services.ai.available) {
    await ctx.reply('سرویس ترجمه پیکربندی نشده است. مدیر ربات باید AI_API_KEY را تنظیم کند.');
    return;
  }
  if (text.trim().length < 1) {
    await ctx.reply('متنی برای ترجمه ارسال کنید.');
    return;
  }
  if (text.length > 5000) {
    await ctx.reply(`متن طولانی است (${fa(text.length)} کاراکتر). حداکثر ۵۰۰۰ کاراکتر مجاز است.`);
    return;
  }
  if (!(await ctx.guardRate('translate', 10, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const target = await ctx.getSetting<string>('targetLanguage', 'en');
  const targetName = NAMES[target] ?? target;
  const translated = await ctx.services.ai.translate(text, targetName);
  const detected = detectLanguage(text);
  await ctx.reply(
    `<b>ترجمه به ${NAMES[target] ?? target}</b>\n\n${ctx.escape(translated)}\n\n` +
      `<i>زبان مبدأ تشخیص‌داده‌شده: ${NAMES[detected] ?? 'نامشخص'}</i>`,
    {
      inline: {
        rows: [
          [
            { text: 'تغییر زبان مقصد', callbackData: 'a:languages' },
            { text: 'ترجمه معکوس', callbackData: 'a:reverse' },
          ],
        ],
      },
    },
  );
  await saveDoc(ctx.storage, ctx.bot.id, 'translations', `tr_${ctx.user.id}_${Date.now()}`, {
    userId: ctx.user.id,
    source: text.slice(0, 2000),
    target,
    translated: translated.slice(0, 4000),
    createdAt: new Date().toISOString(),
  });
}

function detectLanguage(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) {
    if (/[پچژگ]/.test(text)) return 'fa';
    return 'ar';
  }
  if (/[а-яА-Я]/.test(text)) return 'ru';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[ğışİĞŞ]/.test(text)) return 'tr';
  if (/[äöüß]/i.test(text)) return 'de';
  return 'en';
}

export const translatorBot = defineBot({
  id: 'translator',
  name: 'مترجم هوشمند',
  category: 'D',
  summary: 'ترجمه روان بین ۱۰ زبان با تشخیص خودکار زبان مبدأ',
  description:
    'متن را به زبان مقصد انتخاب‌شده ترجمه می‌کند و زبان مبدأ را به‌صورت خودکار تشخیص می‌دهد. زبان مقصد در تنظیمات کاربر ذخیره می‌شود، امکان ترجمه معکوس وجود دارد و تاریخچه ترجمه‌ها نگه‌داری می‌شود.',
  icon: 'languages',
  tags: ['ai', 'utility'],
  commands: [
    { command: 'translate', description: 'ترجمه متن' },
    { command: 'lang', description: 'انتخاب زبان مقصد' },
  ],
  menu: [
    { id: 'languages', label: 'انتخاب زبان' },
    { id: 'reverse', label: 'ترجمه معکوس' },
    { id: 'history', label: 'تاریخچه ترجمه' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای ترجمه با کیفیت بالا.',
      required: true,
      env: 'AI_API_KEY',
    },
  ],
  defaultConfig: { targetLanguage: 'en' },
  actions: {
    languages: async (ctx) => {
      const current = await ctx.getSetting<string>('targetLanguage', 'en');
      await ctx.reply(`زبان مقصد فعلی: ${NAMES[current] ?? current}\nزبان جدید را انتخاب کنید:`, {
        inline: { rows: chunkButtons(LANGUAGES.map((language) => ({ text: language.label, data: `a:setlang:${language.id}` })), 3).rows },
      });
    },
    setlang: async (ctx, param) => {
      const language = LANGUAGES.find((item) => item.id === param);
      if (!language) return;
      await ctx.setSetting('targetLanguage', language.id);
      await ctx.reply(`زبان مقصد به «${language.label}» تغییر کرد. متن خود را ارسال کنید.`, {
        inline: { rows: [[{ text: 'ارسال متن', callbackData: 'a:__menu' }]] },
      });
    },
    reverse: async (ctx) => {
      const last = await ctx.storage.documents.findByKey(ctx.bot.id, 'translations', `last_${ctx.user.id}`);
      if (!last) {
        await ctx.reply('ترجمه قبلی‌ای وجود ندارد.');
        return;
      }
      const data = last.data as { source?: string; translated?: string; target?: string };
      const sourceLanguage = detectLanguage(String(data.source ?? ''));
      await ctx.setSetting('targetLanguage', sourceLanguage);
      await translateText(ctx, String(data.translated ?? ''));
    },
    history: async (ctx) => {
      const result = await ctx.storage.documents.list(ctx.bot.id, 'translations', { pageSize: 100 });
      const mine = result.items
        .map((item) => item.data as Record<string, unknown>)
        .filter((item) => item.userId === ctx.user.id)
        .slice(0, 5);
      if (mine.length === 0) {
        await ctx.reply('تاریخچه‌ای وجود ندارد.');
        return;
      }
      const lines = ['<b>آخرین ترجمه‌ها</b>', ''];
      for (const item of mine) {
        lines.push(`→ ${NAMES[String(item.target)] ?? item.target}: ${ctx.escape(truncateText(String(item.translated ?? ''), 120))}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  },
  async onStart(ctx) {
    const target = await ctx.getSetting<string>('targetLanguage', 'en');
    await ctx.reply(
      `<b>مترجم هوشمند</b>\n\nزبان مقصد: ${NAMES[target] ?? target}\nمتن خود را ارسال کنید تا ترجمه شود.`,
      {
        inline: {
          rows: [
            [{ text: 'تغییر زبان', callbackData: 'a:languages' }],
            [{ text: 'تاریخچه', callbackData: 'a:history' }],
          ],
        },
      },
    );
  },
  onText: async (ctx) => {
    await translateText(ctx, ctx.text);
  },
  async onCommand(ctx, command) {
    if (command === 'translate') {
      const text = ctx.params.join(' ');
      if (text) {
        await translateText(ctx, text);
        return true;
      }
      await ctx.reply('متن مورد نظر را ارسال کنید.');
      return true;
    }
    if (command === 'lang') {
      await translatorBot.actions.languages(ctx);
      return true;
    }
    return false;
  },
});

export { LANGUAGES as TRANSLATOR_LANGUAGES, detectLanguage };
