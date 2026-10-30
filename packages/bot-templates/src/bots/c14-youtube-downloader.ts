import type { BotContext } from '@botforge/core';
import { defineBot, fa, getDoc, saveDoc } from '../kit';

const URL_PATTERN = /(https?:\/\/[^\s]+)/i;
const CACHE = 'download_cache';

interface CachedAsset {
  url: string;
  type: 'video' | 'audio' | 'image';
  quality?: string;
  expiresAt: string;
}

async function handleLink(ctx: BotContext, link: string): Promise<void> {
  if (!/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(link)) {
    await ctx.reply('لینک یوتیوب معتبر ارسال کنید. نمونه:\n<code>https://youtu.be/xxxxxxxx</code>');
    return;
  }
  if (!ctx.services.media.available) {
    await ctx.reply(
      'سرویس دانلود پیکربندی نشده است. مدیر ربات می‌تواند آدرس سرویس (MEDIA_API_URL) را تنظیم کند یا yt-dlp را روی سرور نصب کند.',
    );
    return;
  }
  if (!(await ctx.guardRate('download', 4, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const assets = await ctx.services.media.resolve(link);
  const videos = assets.filter((asset) => asset.type === 'video').slice(0, 4);
  const audios = assets.filter((asset) => asset.type === 'audio').slice(0, 2);
  if (videos.length === 0 && audios.length === 0) {
    await ctx.reply('فایلی برای این لینک پیدا نشد.');
    return;
  }
  await saveDoc(ctx.storage, ctx.bot.id, CACHE, `cache_${ctx.user.id}`, {
    link,
    assets: [...videos, ...audios].slice(0, 6),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  videos.forEach((asset, index) => {
    rows.push([{ text: `ویدیو ${asset.quality ?? index + 1}`, callbackData: `a:pick:${index}` }]);
  });
  audios.forEach((asset, index) => {
    rows.push([{ text: `صدا ${asset.quality ?? 'MP3'}`, callbackData: `a:pick:${videos.length + index}` }]);
  });
  await ctx.reply(
    `<b>فایل‌های یافت‌شده</b>\n\n${fa(videos.length + audios.length)} گزینه موجود است. یکی را انتخاب کنید:`,
    { inline: { rows } },
  );
}

export const youtubeDownloaderBot = defineBot({
  id: 'youtube-downloader',
  name: 'دانلودر یوتیوب',
  category: 'C',
  summary: 'استخراج ویدیو و صدا از یوتیوب با انتخاب کیفیت',
  description:
    'لینک ویدیوی یوتیوب را می‌گیرد، گزینه‌های کیفیت ویدیو و صدای جداگانه را استخراج می‌کند و به کاربر اجازه انتخاب می‌دهد. لینک‌های استخراج‌شده ۳۰ دقیقه کش می‌شوند. سرویس دانلود از طریق MEDIA_API_URL یا yt-dlp نصب‌شده روی سرور کار می‌کند.',
  icon: 'youtube',
  tags: ['media', 'download'],
  commands: [
    { command: 'youtube', description: 'راهنمای دانلود یوتیوب' },
    { command: 'clear', description: 'پاک کردن کش انتخابی' },
  ],
  menu: [
    { id: 'help', label: 'راهنمای دانلود' },
    { id: 'clear', label: 'پاک‌کردن کش' },
  ],
  requirements: [
    {
      key: 'MEDIA_API_URL',
      label: 'آدرس سرویس دانلود',
      description: 'سرویس سازگار با cobalt یا نصب yt-dlp روی سرور.',
      required: true,
      env: 'MEDIA_API_URL',
    },
  ],
  defaultConfig: { maxFileSizeMb: 48 },
  actions: {
    help: async (ctx) => {
      await ctx.reply(
        '<b>دانلود از یوتیوب</b>\n\nلینک ویدیو را بفرستید، سپس کیفیت مورد نظر را انتخاب کنید.\n' +
          'برای ویدیوهای بلندتر از ۶۰ دقیقه یا حجم بیشتر از ۴۸ مگابایت، لینک مستقیم ارسال می‌شود.',
      );
    },
    clear: async (ctx) => {
      await ctx.storage.documents.deleteByKey(ctx.bot.id, CACHE, `cache_${ctx.user.id}`);
      await ctx.reply('کش دانلود پاک شد.');
    },
    pick: async (ctx, param) => {
      const index = Number(param) || 0;
      const doc = await getDoc<{ link: string; assets: CachedAsset[]; expiresAt: string }>(
        ctx.storage,
        ctx.bot.id,
        CACHE,
        `cache_${ctx.user.id}`,
      );
      if (!doc) {
        await ctx.reply('انتخاب قبلی منقضی شده است. لینک را دوباره ارسال کنید.');
        return;
      }
      if (new Date(doc.data.expiresAt).getTime() < Date.now()) {
        await ctx.reply('لینک‌های قبلی منقضی شده‌اند. لینک را دوباره ارسال کنید.');
        return;
      }
      const asset = doc.data.assets?.[index];
      if (!asset) {
        await ctx.reply('گزینه انتخابی موجود نیست.');
        return;
      }
      if (asset.type === 'audio') {
        await ctx.replyDocument(asset.url, 'audio.mp3', `صدا${asset.quality ? ` — ${asset.quality}` : ''}`);
      } else {
        await ctx.replyVideo(asset.url, `ویدیو${asset.quality ? ` — ${asset.quality}` : ''}`);
      }
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>دانلودر یوتیوب</b>\n\nلینک ویدیو را ارسال کنید.', {
      inline: {
        rows: [
          [{ text: 'راهنما', callbackData: 'a:help' }],
          [{ text: 'پاک‌کردن کش', callbackData: 'a:clear' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    const match = ctx.text.match(URL_PATTERN);
    if (!match) {
      await ctx.reply('لینک یوتیوب ارسال کنید.');
      return;
    }
    await handleLink(ctx, match[1]);
  },
});

export { handleLink as handleYouTubeLink };
