import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, mediaConfig, publishTempMedia, requireAdmin } from '../kit';

const VOICES = [
  { id: 'alloy', label: 'همه‌کاره' },
  { id: 'nova', label: 'روشن' },
  { id: 'shimmer', label: 'نرم' },
  { id: 'onyx', label: 'عمیق' },
];

async function synthesize(ctx: BotContext, text: string): Promise<void> {
  if (!ctx.services.speech.ttsAvailable) {
    await ctx.reply(
      'سرویس تبدیل متن به گفتار پیکربندی نشده است.\nمدیر ربات می‌تواند AI_API_KEY یا SPEECH_TTS_URL را در پنل تنظیم کند.',
    );
    return;
  }
  const clean = text.trim();
  if (clean.length < 1) {
    await ctx.reply('متنی برای تبدیل وجود ندارد.');
    return;
  }
  if (clean.length > 4000) {
    await ctx.reply(`متن طولانی است (${fa(clean.length)} کاراکتر). حداکثر ۴۰۰۰ کاراکتر مجاز است.`);
    return;
  }
  if (!(await ctx.guardRate('tts', 5, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing('record_voice');
  const voice = await ctx.getSetting<string>('voice', 'alloy');
  const audio = await ctx.services.speech.synthesize(clean, voice);
  if (!audio) {
    await ctx.reply('تولید فایل صوتی ممکن نشد.');
    return;
  }
  const extension = audio.mime.includes('wav') ? 'wav' : audio.mime.includes('ogg') ? 'ogg' : 'mp3';
  const media = await publishTempMedia(audio.data, extension, mediaConfig(ctx));
  const asVoice = extension === 'ogg' || extension === 'mp3';
  if (asVoice) {
    const result = await ctx.api.sendVoice(ctx.message.chatId, media.url, `صدا — ${voice}`);
    if (result.ok) {
      await ctx.recordEvent('tts.completed', 'info', { chars: clean.length });
      return;
    }
  }
  const fallback = await ctx.api.sendDocument(ctx.message.chatId, media.url, `speech.${extension}`, 'فایل صوتی تولیدشده');
  if (!fallback.ok) {
    await ctx.reply(`فایل تولید شد اما ارسال آن ممکن نشد: ${media.url}`);
    return;
  }
  await ctx.recordEvent('tts.completed', 'info', { chars: clean.length });
}

export const textToSpeechBot = defineBot({
  id: 'text-to-speech',
  name: 'تبدیل متن به گفتار',
  category: 'C',
  summary: 'تبدیل متن فارسی به پیام صوتی با انتخاب صدا و کنترل طول',
  description:
    'متن ارسالی را به فایل صوتی تبدیل می‌کند و به‌صورت پیام صوتی می‌فرستد. کاربر می‌تواند صدای گوینده را انتخاب کند؛ حداقل و حداکثر طول متن، کنترل نرخ درخواست و ارسال از طریق لینک امن موقت پیاده‌سازی شده است.',
  icon: 'volume-2',
  tags: ['ai', 'media'],
  commands: [
    { command: 'speak', description: 'تبدیل متن به صدا' },
    { command: 'voice', description: 'انتخاب صدای گوینده' },
  ],
  menu: [
    { id: 'voices', label: 'انتخاب صدا' },
    { id: 'help', label: 'راهنما' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای سرویس تبدیل متن به گفتار.',
      required: true,
      env: 'AI_API_KEY',
    },
    {
      key: 'SPEECH_TTS_URL',
      label: 'آدرس سرویس گفتار اختصاصی',
      description: 'اختیاری؛ سرویس جایگزین تبدیل متن به گفتار.',
      required: false,
      env: 'SPEECH_TTS_URL',
    },
  ],
  defaultConfig: { voice: 'alloy', maxCharacters: 4000 },
  actions: {
    voices: async (ctx) => {
      const current = await ctx.getSetting<string>('voice', 'alloy');
      await ctx.reply(`صدای فعلی: ${current}\nیک صدا انتخاب کنید:`, {
        inline: { rows: chunkButtons(VOICES.map((voice) => ({ text: voice.label, data: `a:pick:${voice.id}` })), 2).rows },
      });
    },
    pick: async (ctx, param) => {
      const voice = VOICES.find((item) => item.id === param);
      if (!voice) return;
      await ctx.setSetting('voice', voice.id);
      await ctx.reply(`صدا به «${voice.label}» تغییر کرد.`, {
        inline: { rows: [[{ text: 'ارسال متن', callbackData: 'a:__menu' }]] },
      });
    },
    help: async (ctx) => {
      await ctx.reply(
        '<b>تبدیل متن به گفتار</b>\n\nمتن خود را بفرستید تا به پیام صوتی تبدیل شود.\n' +
          '• حداکثر ۴۰۰۰ کاراکتر در هر درخواست\n• انتخاب صدا از منو\n• پشتیبانی از سرویس اختصاصی با SPEECH_TTS_URL\n\n' +
          `وضعیت سرویس: ${ctx.services.speech.ttsAvailable ? 'آماده' : 'پیکربندی نشده'}`,
      );
    },
    admin_config: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.reply(
        'برای تنظیم سرویس گفتار، کلید AI_API_KEY یا SPEECH_TTS_URL را از پنل مدیریت وارد کنید.',
      );
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>تبدیل متن به گفتار</b>\n\nمتن خود را ارسال کنید.', {
      inline: {
        rows: [
          [{ text: 'انتخاب صدا', callbackData: 'a:voices' }],
          [{ text: 'راهنما', callbackData: 'a:help' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    await synthesize(ctx, ctx.text);
  },
  async onCommand(ctx, command) {
    if (command === 'speak') {
      const text = ctx.params.join(' ');
      if (text) {
        await synthesize(ctx, text);
        return true;
      }
      await ctx.reply('متن مورد نظر را بعد از دستور یا در پیام بعدی ارسال کنید.');
      return true;
    }
    if (command === 'voice') {
      await textToSpeechBot.actions.voices(ctx);
      return true;
    }
    return false;
  },
});
