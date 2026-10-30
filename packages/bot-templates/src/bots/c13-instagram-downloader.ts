import type { BotContext } from '@botforge/core';
import { defineBot, fa, getDoc, saveDoc } from '../kit';

const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

async function handleLink(ctx: BotContext, link: string): Promise<void> {
  if (!link || !URL_PATTERN.test(link)) {
    await ctx.reply('لینک اینستاگرام را ارسال کنید. نمونه:\n<code>https://www.instagram.com/reel/...</code>');
    return;
  }
  if (!ctx.services.media.available) {
    await ctx.reply(
      'سرویس دانلود هنوز پیکربندی نشده است.\n' +
        'مدیر ربات می‌تواند آدرس سرویس دانلود (MEDIA_API_URL) را در پنل مدیریت تنظیم کند یا ابزار yt-dlp را روی سرور نصب کند.',
    );
    return;
  }
  if (!/instagram\.com|instagr\.am/i.test(link)) {
    await ctx.reply('این لینک مربوط به اینستاگرام نیست. لینک صحیح اینستاگرام را ارسال کنید.');
    return;
  }
  if (!(await ctx.guardRate('download', 5, 60_000))) {
    await ctx.reply('تعداد درخواست‌های دانلود زیاد است. یک دقیقه بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const assets = await ctx.services.media.resolve(link);
  const media = assets.filter((asset) => asset.type === 'video' || asset.type === 'image');
  if (media.length === 0) {
    await ctx.reply('فایل قابل دانلودی در این لینک پیدا نشد. ممکن است پست خصوصی باشد.');
    return;
  }
  const primary = media[0];
  const caption = `فایل از اینستاگرام${primary.quality ? ` — کیفیت ${primary.quality}` : ''}`;
  if (primary.type === 'video') {
    await ctx.replyVideo(primary.url, caption);
  } else {
    await ctx.replyPhoto(primary.url, caption);
  }
  await saveDoc(ctx.storage, ctx.bot.id, 'media', `media_${ctx.user.id}`, {
    assets: media.slice(0, 8).map((asset) => ({ url: asset.url, type: asset.type, quality: asset.quality ?? null })),
    savedAt: new Date().toISOString(),
  });
  if (media.length > 1) {
    const rows = media.slice(0, 6).map((asset, index) => [
      { text: `فایل ${index + 1}${asset.quality ? ` — ${asset.quality}` : ''}`, callbackData: `a:dl:${index}` },
    ]);
    await ctx.reply('فایل‌های دیگر این پست:', { inline: { rows } });
  }
  await ctx.recordEvent('download.instagram', 'info', { count: media.length });
}

export const instagramDownloaderBot = defineBot({
  id: 'instagram-downloader',
  name: 'دانلودر اینستاگرام',
  category: 'C',
  summary: 'دانلود ریلز، پست و عکس اینستاگرام با لینک مستقیم',
  description:
    'لینک پست یا ریل اینستاگرام را دریافت می‌کند و فایل تصویری یا ویدیویی را از طریق سرویس دانلود پیکربندی‌شده (سرویس سازگار با cobalt یا yt-dlp) برمی‌گرداند. محدودیت نرخ، اعتبارسنجی دامنه و مدیریت خطای سرویس در آن پیاده‌سازی شده است.',
  icon: 'instagram',
  tags: ['media', 'download'],
  commands: [
    { command: 'instagram', description: 'راهنمای دانلود اینستاگرام' },
    { command: 'status', description: 'وضعیت سرویس دانلود' },
  ],
  menu: [
    { id: 'help', label: 'راهنمای دانلود' },
    { id: 'status', label: 'وضعیت سرویس' },
  ],
  requirements: [
    {
      key: 'MEDIA_API_URL',
      label: 'آدرس سرویس دانلود',
      description: 'آدرس سرویس سازگار با cobalt یا yt-dlp برای استخراج لینک رسانه.',
      required: true,
      env: 'MEDIA_API_URL',
    },
    {
      key: 'MEDIA_API_KEY',
      label: 'کلید سرویس دانلود',
      description: 'در صورت نیاز سرویس به احراز هویت.',
      required: false,
      env: 'MEDIA_API_KEY',
    },
  ],
  defaultConfig: { maxFileSizeMb: 48 },
  actions: {
    help: async (ctx) => {
      await ctx.reply(
        '<b>دانلود از اینستاگرام</b>\n\nکافی است لینک پست، ریل یا IGTV را برای ربات ارسال کنید.\n\n' +
          'نکته‌ها:\n• پست‌های خصوصی قابل دانلود نیستند.\n• حداکثر حجم فایل برای ارسال از پیام‌رسان محدود است.\n• برای فایل‌های بزرگ، لینک مستقیم ارسال می‌شود.',
        { inline: { rows: [[{ text: 'وضعیت سرویس', callbackData: 'a:status' }]] } },
      );
    },
    status: async (ctx) => {
      const ready = ctx.services.media.available;
      await ctx.reply(
        `<b>وضعیت سرویس دانلود</b>\n\n${ready ? 'سرویس آماده استفاده است.' : 'سرویس پیکربندی نشده است.'}\n` +
          `کلید MEDIA_API_URL: ${ctx.services.isConfigured('MEDIA_API_URL') ? 'تنظیم‌شده' : 'تنظیم‌نشده'}`,
      );
    },
    dl: async (ctx, param) => {
      const index = Number(param);
      const doc = await getDoc<{ assets?: Array<{ url: string; type: string; quality: string | null }> }>(
        ctx.storage,
        ctx.bot.id,
        'media',
        `media_${ctx.user.id}`,
      );
      const asset = doc?.data.assets?.[Number.isFinite(index) ? index : -1];
      if (!asset || !/^https?:\/\//i.test(asset.url)) {
        await ctx.reply('لینک فایل منقضی شده است. لطفاً لینک پست را دوباره ارسال کنید.');
        return;
      }
      if (asset.type === 'image') {
        await ctx.replyPhoto(asset.url, 'فایل انتخابی');
      } else {
        await ctx.replyVideo(asset.url, 'فایل انتخابی');
      }
    },
  },
  async onStart(ctx) {
    await ctx.reply(
      '<b>دانلودر اینستاگرام</b>\n\nلینک ریل یا پست اینستاگرام را برای من بفرستید.',
      { inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] } },
    );
  },
  onText: async (ctx) => {
    const match = ctx.text.match(URL_PATTERN);
    if (!match) {
      await ctx.reply('لینک معتبر اینستاگرام ارسال کنید.');
      return;
    }
    await handleLink(ctx, match[1]);
  },
});

export { handleLink as handleInstagramLink, fa as instaFa };
