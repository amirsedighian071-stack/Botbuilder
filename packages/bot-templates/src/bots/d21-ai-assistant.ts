import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, saveDoc, truncateText } from '../kit';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

const MODES = [
  { id: 'general', label: 'دستیار عمومی', system: 'تو یک دستیار هوشمند فارسی‌زبان، دقیق و مختصر هستی. پاسخ‌ها را ساختارمند بده.' },
  { id: 'code', label: 'برنامه‌نویسی', system: 'تو یک مهندس نرم‌افزار ارشد هستی. کد کامل، امن و قابل اجرا بده و توضیح کوتاه فارسی اضافه کن.' },
  { id: 'business', label: 'کسب‌وکار', system: 'تو یک مشاور کسب‌وکار هستی. پاسخ‌ها را با بولت، عدد و پیشنهاد عملی بده.' },
  { id: 'creative', label: 'نویسندگی خلاق', system: 'تو یک نویسنده خلاق فارسی‌زبان هستی. متن زیبا، روان و بدون کلیشه بنویس.' },
];

function historyKey(ctx: BotContext): string {
  return `chat_${ctx.user.id}`;
}

async function loadHistory(ctx: BotContext): Promise<ChatTurn[]> {
  const doc = await ctx.storage.documents.findByKey(ctx.bot.id, 'ai_history', `hist_${ctx.user.id}`);
  return doc ? ((doc.data as { turns?: ChatTurn[] }).turns ?? []) : [];
}

async function saveHistory(ctx: BotContext, turns: ChatTurn[]): Promise<void> {
  await saveDoc(ctx.storage, ctx.bot.id, 'ai_history', `hist_${ctx.user.id}`, { turns: turns.slice(-20) });
}

export const aiAssistantBot = defineBot({
  id: 'ai-assistant',
  name: 'دستیار هوش مصنوعی',
  category: 'D',
  summary: 'چت هوشمند با حافظه گفتگو، حالت‌های تخصصی و بازنشانی تاریخچه',
  description:
    'دستیار هوش مصنوعی با پشتیبانی از حالت‌های تخصصی (عمومی، برنامه‌نویسی، کسب‌وکار، خلاق) و حافظه ۲۰ پیام اخیر. هر پاسخ بر اساس تاریخچه همان کاربر تولید می‌شود؛ امکان پاک‌کردن گفتگو و دیدن طول تاریخچه وجود دارد.',
  icon: 'bot',
  tags: ['ai'],
  commands: [
    { command: 'ai', description: 'شروع گفتگو با هوش مصنوعی' },
    { command: 'reset', description: 'پاک کردن تاریخچه گفتگو' },
    { command: 'mode', description: 'تغییر حالت دستیار' },
  ],
  menu: [
    { id: 'chat', label: 'شروع گفتگو' },
    { id: 'mode', label: 'حالت دستیار' },
    { id: 'reset', label: 'پاک‌کردن گفتگو' },
    { id: 'usage', label: 'وضعیت سرویس' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'کلید سرویس سازگار با OpenAI برای تولید پاسخ.',
      required: true,
      env: 'AI_API_KEY',
    },
    {
      key: 'AI_MODEL',
      label: 'مدل',
      description: 'نام مدل، مثلاً gpt-4o-mini',
      required: false,
      env: 'AI_MODEL',
    },
  ],
  defaultConfig: { mode: 'general', maxTokens: 900, historyLimit: 20 },
  actions: {
    chat: async (ctx) => {
      await ctx.setFlow('ai_chat', { mode: await ctx.getSetting<string>('mode', 'general') });
      await ctx.reply('سؤال یا درخواست خود را بنویسید. برای پایان گفتگو /reset را بزنید.');
    },
    mode: async (ctx) => {
      const current = await ctx.getSetting<string>('mode', 'general');
      await ctx.reply(`حالت فعلی: ${MODES.find((mode) => mode.id === current)?.label ?? current}`, {
        inline: { rows: chunkButtons(MODES.map((mode) => ({ text: mode.label, data: `a:setmode:${mode.id}` })), 2).rows },
      });
    },
    setmode: async (ctx, param) => {
      const mode = MODES.find((item) => item.id === param);
      if (!mode) return;
      await ctx.setSetting('mode', mode.id);
      await ctx.reply(`حالت دستیار به «${mode.label}» تغییر کرد.`);
    },
    reset: async (ctx) => {
      await ctx.storage.documents.deleteByKey(ctx.bot.id, 'ai_history', `hist_${ctx.user.id}`);
      await ctx.clearFlow();
      await ctx.reply('تاریخچه گفتگو پاک شد.');
    },
    usage: async (ctx) => {
      const history = await loadHistory(ctx);
      await ctx.reply(
        `<b>وضعیت دستیار</b>\n\nسرویس: ${ctx.services.ai.available ? 'متصل' : 'پیکربندی نشده'}\n` +
          `مدل: ${await ctx.getSetting<string>('AI_MODEL', ctx.config.AI_MODEL)}\n` +
          `پیام‌های ذخیره‌شده: ${fa(history.length)} از ${fa(ctx.setting('historyLimit', 20))}`,
      );
    },
  },
  steps: {
    ai_chat: async (ctx, input) => {
      const prompt = String(input ?? ctx.text).trim();
      if (prompt.length < 2) {
        await ctx.reply('متن درخواست خیلی کوتاه است.');
        return;
      }
      if (!ctx.services.ai.available) {
        await ctx.reply('سرویس هوش مصنوعی پیکربندی نشده است. مدیر ربات باید AI_API_KEY را تنظیم کند.');
        return;
      }
      if (!(await ctx.guardRate('ai', 12, 60_000))) {
        await ctx.reply('تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید.');
        return;
      }
      await ctx.typing();
      const modeId = String(ctx.flow?.data.mode ?? (await ctx.getSetting<string>('mode', 'general')));
      const mode = MODES.find((item) => item.id === modeId) ?? MODES[0];
      const history = await loadHistory(ctx);
      const messages = [
        { role: 'system' as const, content: mode.system },
        ...history.slice(-10).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user' as const, content: prompt },
      ];
      const answer = await ctx.services.ai.chat(messages, {
        maxTokens: Number(await ctx.getSetting<number>('maxTokens', 900)),
      });
      const turns: ChatTurn[] = [
        ...history,
        { role: 'user', content: prompt.slice(0, 2000), at: new Date().toISOString() },
        { role: 'assistant', content: answer.slice(0, 4000), at: new Date().toISOString() },
      ];
      await saveHistory(ctx, turns);
      const chunks = answer.match(/[\s\S]{1,3500}/g) ?? [answer];
      for (const chunk of chunks.slice(0, 4)) {
        await ctx.reply(ctx.escape(chunk));
      }
      await ctx.reply('ادامه گفتگو یا پایان:', {
        inline: {
          rows: [
            [
              { text: 'ادامه', callbackData: 'a:chat' },
              { text: 'پایان', callbackData: 'a:reset' },
            ],
          ],
        },
      });
    },
  },
  async onStart(ctx) {
    await ctx.reply(
      '<b>دستیار هوش مصنوعی</b>\n\nسؤال خود را بپرسید یا حالت تخصصی انتخاب کنید.\n' +
        `وضعیت سرویس: ${ctx.services.ai.available ? 'متصل' : 'نیازمند کلید API'}`,
      {
        inline: {
          rows: [
            [{ text: 'شروع گفتگو', callbackData: 'a:chat' }],
            [{ text: 'حالت دستیار', callbackData: 'a:mode' }],
          ],
        },
      },
    );
  },
  onText: async (ctx) => {
    await ctx.setFlow('ai_chat', { mode: await ctx.getSetting<string>('mode', 'general') });
    await aiAssistantBot.steps?.ai_chat?.(ctx, ctx.text);
  },
  async onCommand(ctx, command) {
    if (command === 'ai') {
      const prompt = ctx.params.join(' ');
      if (prompt) {
        await ctx.setFlow('ai_chat', { mode: await ctx.getSetting<string>('mode', 'general') });
        await aiAssistantBot.steps?.ai_chat?.(ctx, prompt);
        return true;
      }
      await ctx.setFlow('ai_chat', {});
      await ctx.reply('سؤال خود را بنویسید:');
      return true;
    }
    if (command === 'reset') {
      await aiAssistantBot.actions.reset(ctx);
      return true;
    }
    if (command === 'mode') {
      await aiAssistantBot.actions.mode(ctx);
      return true;
    }
    return false;
  },
});

export { MODES as AI_MODES, truncateText as aiTruncate };
