import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  detectExtension,
  fetchAttachmentFile,
  ffmpegConvert,
  hasFfmpeg,
  mediaConfig,
  publishTempMedia,
  saveDoc,
} from '../kit';

interface ConverterJob {
  fileId: string;
  fileName: string;
  mimeType: string;
  extension: string;
  category: 'audio' | 'video' | 'image' | 'unknown';
  createdAt: string;
}

const TARGETS: Record<ConverterJob['category'], Array<{ ext: string; label: string; args: string[] }>> = {
  audio: [
    { ext: 'mp3', label: 'MP3', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
    { ext: 'ogg', label: 'OGG (Opus)', args: ['-vn', '-c:a', 'libopus', '-b:a', '64k'] },
    { ext: 'wav', label: 'WAV', args: ['-vn', '-c:a', 'pcm_s16le'] },
    { ext: 'm4a', label: 'M4A', args: ['-vn', '-c:a', 'aac', '-b:a', '160k'] },
  ],
  video: [
    { ext: 'mp4', label: 'MP4 (H.264)', args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac'] },
    { ext: 'webm', label: 'WEBM', args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus'] },
    { ext: 'mp3', label: 'استخراج صدا (MP3)', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  ],
  image: [
    { ext: 'jpg', label: 'JPG', args: ['-q:v', '3'] },
    { ext: 'png', label: 'PNG', args: [] },
    { ext: 'webp', label: 'WEBP', args: ['-quality', '85'] },
  ],
  unknown: [
    { ext: 'mp3', label: 'MP3', args: ['-vn', '-c:a', 'libmp3lame'] },
    { ext: 'mp4', label: 'MP4', args: ['-c:v', 'libx264', '-c:a', 'aac'] },
  ],
};

function categorize(mime: string, extension: string): ConverterJob['category'] {
  if (mime.startsWith('audio/') || ['mp3', 'ogg', 'wav', 'm4a', 'opus', 'flac'].includes(extension)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(extension)) return 'video';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(extension)) return 'image';
  return 'unknown';
}

async function startConversion(ctx: BotContext, attachment: { fileId?: string; fileName?: string; mimeType?: string }): Promise<void> {
  const extension = detectExtension(attachment.fileName, attachment.mimeType);
  const category = categorize(attachment.mimeType ?? '', extension);
  const job: ConverterJob = {
    fileId: String(attachment.fileId ?? ''),
    fileName: attachment.fileName ?? `file.${extension}`,
    mimeType: attachment.mimeType ?? '',
    extension,
    category,
    createdAt: new Date().toISOString(),
  };
  await saveDoc(ctx.storage, ctx.bot.id, 'converter', `job_${ctx.user.id}`, job as unknown as Record<string, unknown>);
  const targets = TARGETS[category].filter((target) => target.ext !== extension);
  await ctx.reply(
    `<b>فایل دریافت شد</b>\nنوع تشخیص‌داده‌شده: ${category === 'audio' ? 'صوتی' : category === 'video' ? 'ویدیویی' : category === 'image' ? 'تصویری' : 'نامشخص'}\n\nفرمت خروجی را انتخاب کنید:`,
    {
      inline: {
        rows: [
          ...chunkButtons(targets.map((target) => ({ text: target.label, data: `a:convert:${target.ext}` })), 2).rows,
          [{ text: 'انصراف', callbackData: 'a:__menu' }],
        ],
      },
    },
  );
}

export const fileConverterBot = defineBot({
  id: 'file-converter',
  name: 'تبدیل فایل',
  category: 'C',
  summary: 'تبدیل صدا، ویدیو و تصویر به فرمت‌های مختلف با ffmpeg',
  description:
    'نوع فایل ارسالی را تشخیص می‌دهد و فرمت‌های خروجی مناسب را پیشنهاد می‌دهد: تبدیل صدا به MP3/OGG/WAV/M4A، ویدیو به MP4/WEBM یا استخراج صدا، و تصویر به JPG/PNG/WEBP. تبدیل با ffmpeg روی سرور انجام می‌شود و فایل خروجی با لینک امن موقت ارسال می‌گردد.',
  icon: 'file-cog',
  tags: ['files', 'convert'],
  commands: [{ command: 'convert', description: 'راهنمای تبدیل فایل' }],
  menu: [{ id: 'help', label: 'راهنمای تبدیل' }],
  defaultConfig: { maxSizeMb: 48 },
  actions: {
    help: async (ctx) => {
      const ready = await hasFfmpeg();
      await ctx.reply(
        '<b>تبدیل فایل</b>\n\nفایل خود را ارسال کنید؛ سپس فرمت خروجی را انتخاب کنید.\n' +
          '• صدا: MP3، OGG، WAV، M4A\n• ویدیو: MP4، WEBM، استخراج صدا\n• تصویر: JPG، PNG، WEBP\n\n' +
          `وضعیت ابزار تبدیل روی سرور: ${ready ? 'آماده' : 'نصب نشده (ffmpeg)'}`,
      );
    },
    convert: async (ctx, param) => {
      if (!param) return;
      const doc = await ctx.storage.documents.findByKey(ctx.bot.id, 'converter', `job_${ctx.user.id}`);
      if (!doc) {
        await ctx.reply('فایلی برای تبدیل وجود ندارد. ابتدا فایل را ارسال کنید.');
        return;
      }
      const job = doc.data as unknown as ConverterJob;
      const target = TARGETS[job.category].find((item) => item.ext === param);
      if (!target) {
        await ctx.reply('فرمت خروجی پشتیبانی نمی‌شود.');
        return;
      }
      if (!(await ctx.guardRate('convert', 3, 60_000))) {
        await ctx.reply('تعداد درخواست‌های تبدیل زیاد است. کمی بعد تلاش کنید.');
        return;
      }
      await ctx.typing('upload_document');
      const source = await fetchAttachmentFile(ctx, {
        fileId: job.fileId,
        fileName: job.fileName,
        mimeType: job.mimeType,
      });
      if (!source) {
        await ctx.reply('فایل منبع در دسترس نیست. لطفاً فایل را دوباره ارسال کنید.');
        return;
      }
      const output = await ffmpegConvert({
        data: source.data,
        inputExtension: job.extension,
        outputExtension: target.ext,
        args: target.args,
      });
      const media = await publishTempMedia(output, target.ext, mediaConfig(ctx));
      const baseName = job.fileName.replace(/\.[^.]+$/, '') || 'converted';
      const result = await ctx.api.sendDocument(
        ctx.message.chatId,
        media.url,
        `${baseName}.${target.ext}`,
        `تبدیل‌شده به ${target.label}`,
      );
      if (!result.ok) {
        await ctx.reply(`فایل آماده شد اما ارسال آن ممکن نشد: ${media.url}`);
      }
      await ctx.recordEvent('convert.file', 'info', { from: job.extension, to: target.ext });
    },
    dl: async (ctx) => {
      await ctx.reply('فایل خود را ارسال کنید تا تبدیل شود.');
    },
  },
  async onStart(ctx) {
    const ready = await hasFfmpeg();
    await ctx.reply(
      `<b>تبدیل فایل</b>\n\nفایل خود را ارسال کنید.\nوضعیت ffmpeg: ${ready ? 'آماده' : 'نصب نشده'}`,
      { inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] } },
    );
  },
  async onMedia(ctx, attachment) {
    if (!attachment.fileId) {
      await ctx.reply('این فایل پشتیبانی نمی‌شود.');
      return;
    }
    await startConversion(ctx, attachment);
  },
  onText: async (ctx) => {
    await ctx.reply('فایل خود را ارسال کنید تا فرمت‌های تبدیل نمایش داده شود.');
  },
});

export { TARGETS as CONVERTER_TARGETS };
