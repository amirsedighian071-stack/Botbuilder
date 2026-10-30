import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  formatBytes,
  getDoc,
  listDocs,
  paginationRow,
  saveDoc,
  truncateText,
} from '../kit';
import { formatBytes as coreFormatBytes } from '@botforge/core';

interface StoredFile {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  fileId: string;
  kind: string;
  shareCode: string | null;
  createdAt: string;
}

const FILES = 'files';
const MAX_FILES_PER_USER = 50;

function fileKey(id: string): string {
  return `file_${id}`;
}

function shareCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function userFiles(ctx: BotContext): Promise<Array<{ key: string; file: StoredFile }>> {
  const result = await listDocs(ctx.storage, ctx.bot.id, FILES, 1, 400);
  return result.items
    .map((item) => ({ key: item.key, file: item.data as unknown as StoredFile }))
    .filter((entry) => entry.file.ownerId === ctx.user.id);
}

async function renderFiles(ctx: BotContext, page = 1): Promise<void> {
  const entries = (await userFiles(ctx)).sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt));
  if (entries.length === 0) {
    await ctx.reply('فایلی ذخیره نکرده‌اید. هر فایلی ارسال کنید تا ذخیره شود.', {
      inline: { rows: [[{ text: 'راهنما', callbackData: 'a:help' }]] },
    });
    return;
  }
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = entries.slice((current - 1) * pageSize, current * pageSize);
  const totalSize = entries.reduce((sum, entry) => sum + (entry.file.size ?? 0), 0);
  const lines = [
    '<b>فایل‌های شما</b>',
    '',
    `تعداد: ${fa(entries.length)} از ${fa(MAX_FILES_PER_USER)} | حجم کل: ${coreFormatBytes(totalSize, 'fa')}`,
    '',
  ];
  for (const entry of slice) {
    lines.push(
      `${ctx.escape(truncateText(entry.file.name, 40))}\n${entry.file.mimeType || entry.file.kind} — ${formatBytes(entry.file.size)}` +
        (entry.file.shareCode ? ` — کد اشتراک: <code>${entry.file.shareCode}</code>` : ''),
    );
  }
  const rows = chunkButtons(
    slice.map((entry) => ({ text: truncateText(entry.file.name, 14), data: `a:file:${entry.file.id}` })),
    2,
  ).rows;
  rows.push(paginationRow('a:files', current, pages));
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderFile(ctx: BotContext, id: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FILES, fileKey(id));
  if (!doc) {
    await ctx.reply('فایل پیدا نشد.');
    return;
  }
  const file = doc.data as unknown as StoredFile;
  if (file.ownerId !== ctx.user.id) {
    await ctx.reply('این فایل متعلق به شما نیست.');
    return;
  }
  const lines = [
    `<b>${ctx.escape(file.name)}</b>`,
    '',
    `نوع: ${ctx.escape(file.mimeType || file.kind)}`,
    `حجم: ${formatBytes(file.size)}`,
    `تاریخ ذخیره: ${ctx.formatDateTime(file.createdAt)}`,
    file.shareCode ? `کد اشتراک: <code>${file.shareCode}</code>` : 'اشتراک‌گذاری فعال نیست',
  ];
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [{ text: 'دریافت فایل', callbackData: `a:send:${file.id}` }],
        [
          { text: file.shareCode ? 'غیرفعال‌سازی اشتراک' : 'ساخت کد اشتراک', callbackData: `a:share:${file.id}` },
          { text: 'حذف', callbackData: `a:del:${file.id}` },
        ],
        [{ text: 'بازگشت', callbackData: 'a:files' }],
      ],
    },
  });
}

export const fileManagerBot = defineBot({
  id: 'file-manager',
  name: 'آپلودر و مدیریت فایل',
  category: 'C',
  summary: 'آرشیو فایل در پیام‌رسان با فهرست، ارسال مجدد و کد اشتراک',
  description:
    'هر فایل، عکس، ویدیو یا داکیومنت ارسالی به ربات در آرشیو شخصی کاربر ذخیره می‌شود. کاربر می‌تواند فایل‌ها را فهرست کند، دوباره دریافت کند، کد اشتراک بسازد یا فایل را حذف کند. سهمیه هر کاربر ۵۰ فایل و ارسال مجدد از طریق شناسه فایل پلتفرم انجام می‌شود.',
  icon: 'folder',
  tags: ['files', 'utility'],
  commands: [
    { command: 'files', description: 'فهرست فایل‌ها' },
    { command: 'get', description: 'دریافت فایل با کد اشتراک' },
  ],
  menu: [
    { id: 'files', label: 'فایل‌های من' },
    { id: 'help', label: 'راهنما' },
  ],
  defaultConfig: { maxFiles: 50 },
  actions: {
    files: async (ctx, param) => renderFiles(ctx, Number(param) || 1),
    file: async (ctx, param) => {
      if (param) await renderFile(ctx, param);
    },
    help: async (ctx) => {
      await ctx.reply(
        '<b>مدیریت فایل</b>\n\nهر فایل، عکس یا ویدیویی که ارسال کنید ذخیره می‌شود.\n' +
          '• برای دریافت مجدد: از فهرست فایل‌ها اقدام کنید.\n• برای اشتراک‌گذاری: کد ۶ رقمی بسازید و به مخاطب بدهید.\n' +
          '• سهمیه: ۵۰ فایل برای هر کاربر.\n\nدریافت فایل با کد: <code>/get CODE</code>',
      );
    },
    send: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FILES, fileKey(param));
      if (!doc) {
        await ctx.reply('فایل پیدا نشد.');
        return;
      }
      const file = doc.data as unknown as StoredFile;
      if (file.ownerId !== ctx.user.id) {
        await ctx.reply('این فایل متعلق به شما نیست.');
        return;
      }
      await sendStoredFile(ctx, file);
    },
    share: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FILES, fileKey(param));
      if (!doc) return;
      const file = doc.data as unknown as StoredFile;
      if (file.ownerId !== ctx.user.id) return;
      const code = file.shareCode ? null : shareCode();
      await saveDoc(ctx.storage, ctx.bot.id, FILES, fileKey(param), {
        ...(doc.data as Record<string, unknown>),
        shareCode: code,
      });
      if (code) {
        await ctx.reply(`کد اشتراک ساخته شد: <code>${code}</code>\nمخاطب می‌تواند با <code>/get ${code}</code> فایل را دریافت کند.`);
      } else {
        await ctx.reply('اشتراک‌گذاری غیرفعال شد.');
      }
      await renderFile(ctx, param);
    },
    del: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FILES, fileKey(param));
      if (!doc) return;
      const file = doc.data as unknown as StoredFile;
      if (file.ownerId !== ctx.user.id) return;
      await ctx.storage.documents.deleteByKey(ctx.bot.id, FILES, fileKey(param));
      await ctx.reply('فایل حذف شد.', { inline: { rows: [[{ text: 'فهرست فایل‌ها', callbackData: 'a:files' }]] } });
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>مدیریت فایل</b>\n\nفایل خود را ارسال کنید یا فهرست را ببینید.', {
      inline: {
        rows: [
          [{ text: 'فایل‌های من', callbackData: 'a:files' }],
          [{ text: 'راهنما', callbackData: 'a:help' }],
        ],
      },
    });
  },
  async onMedia(ctx, attachment) {
    if (!attachment.fileId) {
      await ctx.reply('این نوع فایل پشتیبانی نمی‌شود.');
      return;
    }
    const entries = await userFiles(ctx);
    const limit = await ctx.getSetting<number>('maxFiles', MAX_FILES_PER_USER);
    if (entries.length >= Number(limit)) {
      await ctx.reply('سهمیه فایل شما پر شده است. ابتدا چند فایل را حذف کنید.');
      return;
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file: StoredFile = {
      id,
      ownerId: ctx.user.id,
      name: attachment.fileName ?? `${attachment.type}-${id}`,
      mimeType: attachment.mimeType ?? '',
      size: attachment.size ?? 0,
      fileId: attachment.fileId,
      kind: attachment.type,
      shareCode: null,
      createdAt: new Date().toISOString(),
    };
    await saveDoc(ctx.storage, ctx.bot.id, FILES, fileKey(id), file as unknown as Record<string, unknown>);
    await ctx.reply(`فایل «${ctx.escape(truncateText(file.name, 40))}» ذخیره شد.`, {
      inline: { rows: [[{ text: 'مدیریت فایل', callbackData: `a:file:${id}` }]] },
    });
  },
  onText: async (ctx) => {
    await ctx.reply('فایل خود را ارسال کنید یا از فهرست استفاده کنید.', {
      inline: { rows: [[{ text: 'فایل‌های من', callbackData: 'a:files' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'files') {
      await renderFiles(ctx, 1);
      return true;
    }
    if (command === 'get') {
      const code = ctx.params[0]?.toUpperCase();
      if (!code) {
        await ctx.reply('کد اشتراک را وارد کنید: /get CODE');
        return true;
      }
      const result = await listDocs(ctx.storage, ctx.bot.id, FILES, 1, 400);
      const entry = result.items.find((item) => (item.data as unknown as StoredFile).shareCode === code);
      if (!entry) {
        await ctx.reply('کدی با این مقدار پیدا نشد.');
        return true;
      }
      await sendStoredFile(ctx, entry.data as unknown as StoredFile);
      return true;
    }
    return false;
  },
});

async function sendStoredFile(ctx: BotContext, file: StoredFile): Promise<void> {
  if (file.kind === 'photo') {
    const result = await ctx.api.sendPhoto(ctx.message.chatId, file.fileId, file.name);
    if (!result.ok) await ctx.reply('ارسال فایل ممکن نشد؛ ممکن است فایل منقضی شده باشد.');
    return;
  }
  const result = await ctx.api.sendDocument(ctx.message.chatId, file.fileId, file.name, 'فایل شما');
  if (!result.ok) await ctx.reply('ارسال فایل ممکن نشد؛ ممکن است فایل منقضی شده باشد.');
}

export type { StoredFile };
