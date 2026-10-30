import type { BotContext } from '@botforge/core';
import { defineBot, ffmpegConvert, fetchAttachmentFile, mediaConfig, publishTempMedia } from '../kit';

export const musicToVoiceBot = defineBot({
  id: 'music-to-voice',
  name: 'تبدیل موسیقی به ویس',
  category: 'C',
  summary: 'تبدیل فایل صوتی یا موسیقی به پیام صوتی (ویس) با کیفیت مناسب',
  description:
    'فایل صوتی ارسالی (MP3، M4A، WAV، OGG، ویدیو یا فایل) را دریافت و با ffmpeg به فرمت Opus/OGG تبدیل می‌کند تا به‌صورت پیام صوتی در پیام‌رسان قابل پخش باشد. محدودیت حجم، اعتبارسنجی نوع فایل و مدیریت خطای تبدیل در آن پیاده‌سازی شده است.',
  icon: 'mic',
  tags: ['media', 'convert'],
  commands: [{ command: 'voicify', description: 'راهنمای تبدیل موسیقی به ویس' }],
  menu: [{ id: 'help', label: 'راهنما' }],
  requirements: [],
  defaultConfig: { maxDurationSeconds: 600 },
  actions: {
    help: async (ctx) => {
      await ctx.reply(
        '<b>تبدیل موسیقی به ویس</b>\n\nفایل صوتی یا ویدیویی خود را (حداکثر ۴۸ مگابایت) ارسال کنید تا به پیام صوتی تبدیل شود.\n' +
          'برای فایل‌های طولانی‌تر از ۱۰ دقیقه، بهتر است فایل کوتاه‌تری ارسال کنید.',
      );
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>تبدیل موسیقی به ویس</b>\n\nفایل صوتی خود را ارسال کنید.', {
      inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] },
    });
  },
  async onText(ctx) {
    await ctx.reply('فایل صوتی خود را به‌صورت داکیومنت یا audio ارسال کنید.');
  },
  async onMedia(ctx, attachment) {
    if (!['audio', 'document', 'video', 'voice'].includes(attachment.type)) {
      await ctx.reply('فایل صوتی یا ویدیویی ارسال کنید.');
      return;
    }
    await convertMusicToVoice(ctx, attachment);
  },
  async onCommand(ctx, command) {
    if (command === 'voicify') {
      await ctx.reply('فایل صوتی را ارسال کنید تا به ویس تبدیل شود.');
      return true;
    }
    return false;
  },
  jobs: {},
});

export async function convertMusicToVoice(
  ctx: BotContext,
  attachment?: { fileId?: string; fileName?: string; mimeType?: string },
): Promise<void> {
  const meta = attachment ?? ctx.message.attachments[0];
  const source = await fetchAttachmentFile(ctx, meta ?? {});
  if (!source) {
    await ctx.reply('فایلی پیدا نشد. فایل صوتی خود را ارسال کنید.');
    return;
  }
  if (!(await ctx.guardRate('convert', 3, 60_000))) {
    await ctx.reply('تعداد درخواست‌های تبدیل زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing('record_voice');
  const converted = await ffmpegConvert({
    data: source.data,
    inputExtension: source.extension,
    outputExtension: 'ogg',
    args: ['-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1'],
  });
  const media = await publishTempMedia(converted, 'ogg', mediaConfig(ctx));
  const sent = await ctx.api.sendVoice(ctx.message.chatId, media.url, 'تبدیل‌شده به ویس');
  if (!sent.ok) {
    const fallback = await ctx.api.sendDocument(ctx.message.chatId, media.url, 'voice.ogg', 'فایل صوتی تبدیل‌شده');
    if (!fallback.ok) {
      await ctx.reply('ارسال فایل ممکن نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
  }
  await ctx.recordEvent('convert.music_to_voice', 'info', { bytes: converted.byteLength });
}
