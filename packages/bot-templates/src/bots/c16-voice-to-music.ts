import type { BotContext } from '@botforge/core';
import { defineBot, ffmpegConvert, fetchAttachmentFile, mediaConfig, publishTempMedia } from '../kit';

export const voiceToMusicBot = defineBot({
  id: 'voice-to-music',
  name: 'تبدیل ویس به موسیقی',
  category: 'C',
  summary: 'تبدیل پیام صوتی به فایل موسیقی با کیفیت بالا و متادیتای دلخواه',
  description:
    'پیام صوتی (ویس) را دریافت می‌کند و با ffmpeg به فایل MP3 با نرخ ۱۹۲ کیلوبیت تبدیل می‌کند. کاربر می‌تواند عنوان و نام هنرمند وارد کند تا متادیتای فایل تنظیم شود؛ فایل نهایی به‌صورت داکیومنت قابل ذخیره ارسال می‌شود.',
  icon: 'music',
  tags: ['media', 'convert'],
  commands: [{ command: 'musicify', description: 'تبدیل ویس به موسیقی' }],
  menu: [{ id: 'help', label: 'راهنما' }],
  defaultConfig: { bitrate: '192k' },
  actions: {
    help: async (ctx) => {
      await ctx.reply(
        '<b>تبدیل ویس به موسیقی</b>\n\nیک پیام صوتی ارسال کنید؛ فایل MP3 با کیفیت بالا دریافت می‌کنید.\n' +
          'پس از ارسال ویس، می‌توانید عنوان و نام هنرمند را وارد کنید.',
      );
    },
    convert: async (ctx) => {
      await ctx.ask('عنوان فایل موسیقی را وارد کنید (یا «-» برای عنوان پیش‌فرض):', 'music_title');
    },
  },
  steps: {
    music_title: async (ctx) => {
      const title = ctx.text.trim() === '-' ? 'صدای ضبط‌شده' : ctx.text.trim().slice(0, 80);
      await ctx.setFlow('music_artist', { title });
      await ctx.reply('نام هنرمند را وارد کنید (یا «-»):');
    },
    music_artist: async (ctx) => {
      const artist = ctx.text.trim() === '-' ? 'کاربر' : ctx.text.trim().slice(0, 80);
      const data = ctx.flow?.data ?? {};
      const source = await fetchAttachmentFile(ctx, {
        fileId: String(data.fileId ?? ''),
        fileName: data.fileName ? String(data.fileName) : undefined,
        mimeType: data.mimeType ? String(data.mimeType) : undefined,
      });
      await ctx.clearFlow();
      if (!source) {
        await ctx.reply('فایل صوتی پیدا نشد. لطفاً ویس را دوباره ارسال کنید.');
        return;
      }
      await ctx.typing('upload_document');
      const bitrate = await ctx.getSetting<string>('bitrate', '192k');
      const converted = await ffmpegConvert({
        data: source.data,
        inputExtension: source.extension,
        outputExtension: 'mp3',
        args: [
          '-vn',
          '-c:a',
          'libmp3lame',
          '-b:a',
          bitrate,
          '-metadata',
          `title=${String(data.title ?? 'صدا')}`,
          '-metadata',
          `artist=${artist}`,
        ],
      });
      const media = await publishTempMedia(converted, 'mp3', mediaConfig(ctx));
      const fileName = `${String(data.title ?? 'audio').replace(/[^\p{L}\p{N}\s_-]/gu, '').slice(0, 40) || 'audio'}.mp3`;
      const result = await ctx.api.sendDocument(ctx.message.chatId, media.url, fileName, `${String(data.title ?? '')} — ${artist}`);
      if (!result.ok) {
        await ctx.reply(`فایل آماده شد اما ارسال آن ممکن نشد: ${media.url}`);
        return;
      }
      await ctx.recordEvent('convert.voice_to_music', 'info', { bytes: converted.byteLength });
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>تبدیل ویس به موسیقی</b>\n\nویس خود را ارسال کنید.', {
      inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] },
    });
  },
  async onText(ctx) {
    await ctx.reply('برای تبدیل، یک پیام صوتی ارسال کنید.');
  },
  async onMedia(ctx, attachment) {
    if (!['voice', 'audio', 'document', 'video'].includes(attachment.type)) {
      await ctx.reply('ویس یا فایل صوتی ارسال کنید.');
      return;
    }
    await ctx.setFlow('music_title', {
      fileId: attachment.fileId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    });
    await ctx.reply('عنوان موسیقی را وارد کنید (یا «-»):');
  },
  async onCommand(ctx, command) {
    if (command === 'musicify') {
      await ctx.reply('ویس خود را ارسال کنید تا به فایل موسیقی تبدیل شود.');
      return true;
    }
    return false;
  },
});

export async function convertVoiceToMusic(ctx: BotContext): Promise<void> {
  const attachment = ctx.message.attachments[0];
  if (!attachment?.fileId) {
    await ctx.reply('ویس ارسال کنید.');
    return;
  }
  await ctx.setFlow('music_title', {
    fileId: attachment.fileId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
  });
  await ctx.reply('عنوان موسیقی را وارد کنید (یا «-»):');
}
