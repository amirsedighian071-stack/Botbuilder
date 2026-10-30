import {
  formatBytes,
  formatDateTime,
  formatNumber,
  relativeTime,
  toPersianDigits,
  type BotContext,
  type BotRecord,
  type BotServices,
  type BotStatus,
  type InlineKeyboard,
  type Logger,
  type MessengerApi,
  type OutgoingMessage,
  type Storage,
} from '@botforge/core';
import type { BroadcastService } from './broadcast';
import { isSensitiveKey, maskSecret, type BotSettingsStore } from '../runtime/settings';

export interface AdminBridge {
  bot: BotRecord;
  storage: Storage;
  api: MessengerApi;
  settings: BotSettingsStore;
  services(): Promise<BotServices>;
  logger: Logger;
  broadcast: BroadcastService;
  updateStatus(status: BotStatus): Promise<void>;
  templateName(): string;
  templateMenu(): Array<{ id: string; label: string; adminOnly?: boolean }>;
  requirements(): Array<{ key: string; label: string; configured: boolean; required: boolean }>;
}

const STATUS_LABELS: Record<BotStatus, string> = {
  active: 'فعال',
  paused: 'متوقف موقت',
  maintenance: 'حالت تعمیر',
  disabled: 'غیرفعال',
};

const PAGE_SIZE = 6;
const SETTINGS_PAGE = 8;

function button(text: string, data: string): { text: string; callbackData: string } {
  return { text, callbackData: data };
}

function chunkRows(items: Array<{ text: string; callbackData: string }>, perRow = 2): InlineKeyboard {
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (let index = 0; index < items.length; index += perRow) rows.push(items.slice(index, index + perRow));
  return { rows };
}

async function guardAdmin(ctx: BotContext): Promise<boolean> {
  if (ctx.isAdmin) return true;
  await ctx.reply('این بخش فقط برای مدیران ربات در دسترس است.');
  return false;
}

export async function renderAdminHome(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  if (!(await guardAdmin(ctx))) return;
  const bot = bridge.bot;
  const [users, admins, messagesToday, pendingJobs] = await Promise.all([
    bridge.storage.users.count(bot.id),
    bridge.storage.users.countAdmins(bot.id),
    bridge.storage.messages.countSince(bot.id, startOfDay()),
    bridge.storage.jobs.countPending(bot.id),
  ]);

  const text = [
    '<b>پنل مدیریت ربات</b>',
    '',
    `ربات: ${bot.name}`,
    `قالب: ${bridge.templateName()}`,
    `پلتفرم: ${bot.platform}`,
    `شناسه: <code>${bot.id}</code>`,
    `وضعیت: ${STATUS_LABELS[bot.status]}`,
    '',
    `کاربران: ${toPersianDigits(formatNumber(users, 'fa'))}`,
    `مدیران: ${toPersianDigits(formatNumber(admins, 'fa'))}`,
    `پیام‌های امروز: ${toPersianDigits(formatNumber(messagesToday, 'fa'))}`,
    `کارهای در صف: ${toPersianDigits(formatNumber(pendingJobs, 'fa'))}`,
    '',
    'یکی از گزینه‌ها را انتخاب کنید:',
  ].join('\n');

  const keyboard = chunkRows([
    button('آمار زنده', 'adm:stats'),
    button('کاربران', 'adm:users:0'),
    button('پیام همگانی', 'adm:broadcast'),
    button('وضعیت ربات', 'adm:status'),
    button('تنظیمات', 'adm:settings'),
    button('کلیدهای سرویس', 'adm:reqs'),
    button('گزارش رخدادها', 'adm:logs'),
    button('صف کارها', 'adm:jobs'),
    button('راهنمای مدیر', 'adm:help'),
  ]);
  await ctx.reply(text, { inline: keyboard });
}

async function renderStats(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const bot = bridge.bot;
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const [users, newUsers, messagesToday, messagesTotal, errors, pending, admins] = await Promise.all([
    bridge.storage.users.count(bot.id),
    bridge.storage.users.countSince(bot.id, since24h),
    bridge.storage.messages.countSince(bot.id, startOfDay()),
    bridge.storage.messages.countTotal(bot.id),
    bridge.storage.events.countSince(bot.id, since24h, 'error'),
    bridge.storage.jobs.countPending(bot.id),
    bridge.storage.users.countAdmins(bot.id),
  ]);
  const recent = await bridge.storage.messages.recent(bot.id, 5);
  const services = await bridge.services();
  const capabilities = ctx.api.capabilities;

  const lines = [
    '<b>آمار زنده</b>',
    '',
    `کاربران کل: ${toPersianDigits(formatNumber(users, 'fa'))}`,
    `کاربران جدید (۲۴ ساعت): ${toPersianDigits(formatNumber(newUsers, 'fa'))}`,
    `مدیران: ${toPersianDigits(formatNumber(admins, 'fa'))}`,
    `پیام‌های امروز: ${toPersianDigits(formatNumber(messagesToday, 'fa'))}`,
    `پیام‌ها از ابتدا: ${toPersianDigits(formatNumber(messagesTotal, 'fa'))}`,
    `خطاهای ۲۴ ساعت: ${toPersianDigits(formatNumber(errors, 'fa'))}`,
    `کارهای در صف: ${toPersianDigits(formatNumber(pending, 'fa'))}`,
    '',
    '<b>امکانات پلتفرم</b>',
    `دکمه‌های شیشه‌ای: ${capabilities.inlineKeyboard ? 'بله' : 'خیر'}`,
    `ویرایش پیام: ${capabilities.editMessage ? 'بله' : 'خیر'}`,
    `ارسال فایل: ${capabilities.files ? 'بله' : 'خیر'}`,
    '',
    '<b>سرویس‌های متصل</b>',
    `هوش مصنوعی: ${services.ai.available ? 'متصل' : 'تنظیم نشده'}`,
    `تبدیل متن به گفتار: ${services.speech.ttsAvailable ? 'متصل' : 'تنظیم نشده'}`,
    `تبدیل گفتار به متن: ${services.speech.sttAvailable ? 'متصل' : 'تنظیم نشده'}`,
    `سرویس دانلود: ${services.media.available ? 'متصل' : 'تنظیم نشده'}`,
  ];

  if (recent.length > 0) {
    lines.push('', '<b>آخرین پیام‌ها</b>');
    for (const item of recent) {
      const arrow = item.direction === 'in' ? '←' : '→';
      lines.push(`${arrow} ${relativeTime(item.createdAt, 'fa')}: ${truncate(item.text, 60)}`);
    }
  }

  await ctx.reply(lines.join('\n'), { inline: chunkRows([button('بازگشت', 'adm:home'), button('صف کارها', 'adm:jobs')]) });
}

async function renderUsers(ctx: BotContext, bridge: AdminBridge, page: number): Promise<void> {
  const result = await bridge.storage.users.list(bridge.bot.id, { page, pageSize: PAGE_SIZE });
  const items = result.items.map((user) =>
    button(
      `${truncate(user.firstName ?? user.username ?? user.platformUserId, 18)}${user.isBlocked ? ' [مسدود]' : ''}`,
      `adm:user:${user.id}`,
    ),
  );
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const nav: Array<{ text: string; callbackData: string }> = [];
  if (page > 1) nav.push(button('صفحه قبل', `adm:users:${page - 1}`));
  if (page < pages) nav.push(button('صفحه بعد', `adm:users:${page + 1}`));
  nav.push(button('بازگشت', 'adm:home'));

  const rows = [
    ...chunkRows(items).rows,
    ...chunkRows(nav).rows,
  ];
  await ctx.reply(
    `<b>مدیریت کاربران</b>\n\nمجموع: ${toPersianDigits(formatNumber(result.total, 'fa'))} | صفحه ${toPersianDigits(page)} از ${toPersianDigits(pages)}`,
    { inline: { rows } },
  );
}

async function renderUser(ctx: BotContext, bridge: AdminBridge, userId: string): Promise<void> {
  const user = await bridge.storage.users.findById(userId);
  if (!user || user.botId !== bridge.bot.id) {
    await ctx.reply('کاربر پیدا نشد.', { inline: chunkRows([button('بازگشت', 'adm:users:0')]) });
    return;
  }
  const text = [
    '<b>پروفایل کاربر</b>',
    '',
    `نام: ${user.firstName ?? '-'}`,
    `نام کاربری: ${user.username ? `@${user.username}` : '-'}`,
    `شناسه پلتفرم: <code>${user.platformUserId}</code>`,
    `شناسه داخلی: <code>${user.id}</code>`,
    `نقش: ${user.role}`,
    `مسدود: ${user.isBlocked ? 'بله' : 'خیر'}`,
    `تعداد پیام: ${toPersianDigits(formatNumber(user.messageCount, 'fa'))}`,
    `اولین بازدید: ${formatDateTime(user.firstSeenAt, 'fa')}`,
    `آخرین بازدید: ${formatDateTime(user.lastSeenAt, 'fa')}`,
    user.notes ? `یادداشت: ${user.notes}` : '',
  ].filter(Boolean).join('\n');

  const keyboard = chunkRows([
    button(user.isBlocked ? 'رفع مسدودی' : 'مسدودسازی', `adm:${user.isBlocked ? 'unblock' : 'block'}:${user.id}`),
    button(user.role === 'user' ? 'ارتقا به مدیر' : 'حذف نقش مدیریت', `adm:role:${user.id}`),
    button('یادداشت', `adm:note:${user.id}`),
    button('بازگشت', 'adm:users:0'),
  ]);
  await ctx.reply(text, { inline: keyboard });
}

async function renderStatus(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const status = bridge.bot.status;
  const text = [
    '<b>وضعیت ربات</b>',
    '',
    `وضعیت فعلی: ${STATUS_LABELS[status]}`,
    '',
    'فعال: ربات به همه پیام‌ها پاسخ می‌دهد.',
    'متوقف موقت: فقط مدیران پاسخ می‌گیرند.',
    'حالت تعمیر: پیام نگهداری برای کاربران ارسال می‌شود.',
    'غیرفعال: هیچ پاسخی ارسال نمی‌شود.',
  ].join('\n');
  const items = (Object.keys(STATUS_LABELS) as BotStatus[]).map((item) =>
    button(`${item === status ? '✓ ' : ''}${STATUS_LABELS[item]}`, `adm:setstatus:${item}`),
  );
  items.push(button('بازگشت', 'adm:home'));
  await ctx.reply(text, { inline: chunkRows(items, 2) });
}

async function renderSettings(ctx: BotContext, bridge: AdminBridge, page: number): Promise<void> {
  const all = await bridge.settings.masked();
  if (all.length === 0) {
    await ctx.reply('تنظیماتی ثبت نشده است.', { inline: chunkRows([button('بازگشت', 'adm:home')]) });
    return;
  }
  const pages = Math.max(1, Math.ceil(all.length / SETTINGS_PAGE));
  const slice = all.slice((page - 1) * SETTINGS_PAGE, page * SETTINGS_PAGE);
  const lines = ['<b>تنظیمات ربات</b>', ''];
  for (const item of slice) {
    lines.push(`<code>${item.key}</code> = ${item.value || '—'}`);
  }
  lines.push('', 'برای ویرایش یک کلید را انتخاب کنید:');
  const items = slice.map((item) => button(truncate(item.key, 22), `adm:set:${item.key}`));
  const nav: Array<{ text: string; callbackData: string }> = [];
  if (page > 1) nav.push(button('قبل', `adm:settings:${page - 1}`));
  if (page < pages) nav.push(button('بعد', `adm:settings:${page + 1}`));
  nav.push(button('بازگشت', 'adm:home'));
  await ctx.reply(lines.join('\n'), { inline: { rows: [...chunkRows(items).rows, ...chunkRows(nav).rows] } });
}

async function renderRequirements(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const requirements = bridge.requirements();
  if (requirements.length === 0) {
    await ctx.reply('این ربات به کلید خارجی نیاز ندارد.', { inline: chunkRows([button('بازگشت', 'adm:home')]) });
    return;
  }
  const lines = ['<b>وضعیت کلیدها و سرویس‌ها</b>', ''];
  for (const requirement of requirements) {
    lines.push(`${requirement.configured ? '✓' : '✗'} ${requirement.label} (${requirement.key})`);
  }
  lines.push('', 'برای تنظیم هر کلید، دکمه مربوطه را بزنید:');
  const items = requirements.map((requirement) => button(truncate(requirement.label, 20), `adm:set:${requirement.key}`));
  items.push(button('بازگشت', 'adm:home'));
  await ctx.reply(lines.join('\n'), { inline: chunkRows(items) });
}

async function renderLogs(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const [messages, events] = await Promise.all([
    bridge.storage.messages.recent(bridge.bot.id, 8),
    bridge.storage.events.list(bridge.bot.id, { pageSize: 6 }),
  ]);
  const lines = ['<b>گزارش رخدادها</b>', '', '<b>پیام‌های اخیر</b>'];
  if (messages.length === 0) lines.push('پیامی ثبت نشده است.');
  for (const message of messages) {
    const arrow = message.direction === 'in' ? '←' : '→';
    lines.push(`${arrow} ${formatDateTime(message.createdAt, 'fa')} — ${truncate(message.text, 70)}`);
  }
  lines.push('', '<b>رخدادهای سیستمی</b>');
  if (events.items.length === 0) lines.push('رخدادی ثبت نشده است.');
  for (const event of events.items) {
    lines.push(`[${event.level}] ${truncate(event.type, 40)} — ${relativeTime(event.createdAt, 'fa')}`);
  }
  await ctx.reply(lines.join('\n'), {
    inline: chunkRows([button('بازگشت', 'adm:home'), button('صف کارها', 'adm:jobs')]),
  });
}

async function renderJobs(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const [pending, failed, list] = await Promise.all([
    bridge.storage.jobs.countPending(bridge.bot.id),
    bridge.storage.jobs.list(bridge.bot.id, { status: 'failed', pageSize: 5 }),
    bridge.storage.jobs.list(bridge.bot.id, { pageSize: 5 }),
  ]);
  const lines = [
    '<b>صف کارها</b>',
    '',
    `در انتظار: ${toPersianDigits(formatNumber(pending, 'fa'))}`,
    `ناموفق: ${toPersianDigits(formatNumber(failed.total, 'fa'))}`,
    '',
    '<b>آخرین کارها</b>',
  ];
  for (const job of list.items) {
    lines.push(`${job.type} — ${job.status} — ${relativeTime(job.updatedAt, 'fa')}`);
    if (job.lastError) lines.push(`  خطا: ${truncate(job.lastError, 80)}`);
  }
  await ctx.reply(lines.join('\n'), {
    inline: chunkRows([button('تلاش مجدد ناموفق‌ها', 'adm:jobs_retry'), button('بازگشت', 'adm:home')]),
  });
}

async function renderHelp(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const lines = [
    '<b>راهنمای مدیر</b>',
    '',
    '/admin — پنل مدیریت',
    '/stats — آمار زنده',
    '/users — فهرست کاربران',
    '/broadcast متن — ارسال همگانی',
    '/block شناسه — مسدودسازی کاربر',
    '/unblock شناسه — رفع مسدودی',
    '/status — وضعیت ربات',
    '/settings — تنظیمات',
    '/ping — بررسی سلامت',
    '',
    'پیام همگانی با محدودیت نرخ ارسال می‌شود و برای هر کاربر یک بار ارسال خواهد شد.',
    'کلیدهای سرویس به صورت رمزنگاری‌شده ذخیره می‌شوند و فقط به شکل ماسک‌شده نمایش داده می‌شوند.',
  ];
  await ctx.reply(lines.join('\n'), { inline: chunkRows([button('بازگشت', 'adm:home')]) });
}

export async function renderBroadcastForm(ctx: BotContext, bridge: AdminBridge): Promise<void> {
  const progress = await bridge.broadcast.progress();
  const lines = ['<b>پیام همگانی</b>', ''];
  if (progress?.active) {
    lines.push(
      'یک ارسال همگانی در حال اجراست:',
      `ارسال‌شده: ${toPersianDigits(formatNumber(progress.sent, 'fa'))} از ${toPersianDigits(formatNumber(progress.total, 'fa'))}`,
      `ناموفق: ${toPersianDigits(formatNumber(progress.failed, 'fa'))}`,
      '',
      'برای لغو، دکمه زیر را بزنید.',
    );
    await ctx.reply(lines.join('\n'), { inline: chunkRows([button('لغو ارسال', 'adm:broadcast_cancel'), button('بازگشت', 'adm:home')]) });
    return;
  }
  if (progress && progress.finishedAt) {
    lines.push(
      'آخرین ارسال:',
      `ارسال‌شده: ${toPersianDigits(formatNumber(progress.sent, 'fa'))} از ${toPersianDigits(formatNumber(progress.total, 'fa'))}`,
      `ناموفق: ${toPersianDigits(formatNumber(progress.failed, 'fa'))}`,
      `پایان: ${formatDateTime(progress.finishedAt, 'fa')}`,
      '',
    );
  }
  lines.push('متن پیام همگانی را در پاسخ بعدی ارسال کنید.');
  await ctx.setFlow('__admin:broadcast', {});
  await ctx.reply(lines.join('\n'), { inline: chunkRows([button('انصراف', 'adm:home')]) });
}

export interface PendingBroadcast {
  text: string;
}

export async function handleAdminFlow(
  ctx: BotContext,
  bridge: AdminBridge,
  state: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (state === '__admin:broadcast') {
    const text = ctx.text.trim();
    if (text.length < 2) {
      await ctx.reply('متن پیام بسیار کوتاه است. لطفاً متن کامل را ارسال کنید.');
      return true;
    }
    await ctx.updateFlow({ text });
    await ctx.reply(`<b>پیش‌نمایش پیام</b>\n\n${text}\n\nارسال به همه کاربران انجام شود؟`, {
      inline: chunkRows([button('تأیید و ارسال', 'adm:broadcast_yes'), button('انصراف', 'adm:home')]),
    });
    return true;
  }
  if (state.startsWith('__admin:set:')) {
    const key = state.slice('__admin:set:'.length);
    const value = ctx.text.trim();
    if (value === '-') {
      await bridge.settings.delete(key);
      await ctx.reply(`کلید ${key} حذف شد.`, { inline: chunkRows([button('بازگشت', 'adm:settings')]) });
      await ctx.clearFlow();
      return true;
    }
    if (isSensitiveKey(key) && value.includes(' ')) {
      await ctx.reply('کلید نباید فاصله داشته باشد. دوباره ارسال کنید.');
      return true;
    }
    await bridge.settings.set(key, value);
    await ctx.reply(`مقدار ${key} به‌روزرسانی شد${isSensitiveKey(key) ? ' (رمزنگاری‌شده)' : ''}.`, {
      inline: chunkRows([button('تنظیمات', 'adm:settings'), button('پنل', 'adm:home')]),
    });
    await ctx.clearFlow();
    return true;
  }
  if (state.startsWith('__admin:note:')) {
    const userId = state.slice('__admin:note:'.length);
    await bridge.storage.users.updateNotes(bridge.bot.id, userId, ctx.text.trim().slice(0, 500));
    await ctx.reply('یادداشت ذخیره شد.', { inline: chunkRows([button('پروفایل', `adm:user:${userId}`)]) });
    await ctx.clearFlow();
    return true;
  }
  return false;
}

export async function handleAdminAction(
  ctx: BotContext,
  bridge: AdminBridge,
  action: string,
  args: string[],
): Promise<boolean> {
  if (!(await guardAdmin(ctx))) return true;
  const arg = args[0] ?? '';

  switch (action) {
    case 'home':
      await renderAdminHome(ctx, bridge);
      return true;
    case 'stats':
      await renderStats(ctx, bridge);
      return true;
    case 'users':
      await renderUsers(ctx, bridge, Math.max(1, Number(arg) || 1));
      return true;
    case 'user':
      await renderUser(ctx, bridge, arg);
      return true;
    case 'block':
    case 'unblock': {
      const blocked = action === 'block';
      await bridge.storage.users.setBlocked(bridge.bot.id, arg, blocked);
      await bridge.storage.audits.log({
        actorId: ctx.user.id,
        actorType: 'admin',
        action: blocked ? 'user.block' : 'user.unblock',
        target: arg,
        meta: {},
        ip: '',
      });
      await ctx.reply(blocked ? 'کاربر مسدود شد.' : 'مسدودی کاربر برداشته شد.', {
        inline: chunkRows([button('پروفایل', `adm:user:${arg}`), button('کاربران', 'adm:users:0')]),
      });
      return true;
    }
    case 'role': {
      const user = await bridge.storage.users.findById(arg);
      if (!user) {
        await ctx.reply('کاربر پیدا نشد.');
        return true;
      }
      const nextRole = user.role === 'user' ? 'admin' : 'user';
      await bridge.storage.users.setRole(bridge.bot.id, arg, nextRole);
      await bridge.storage.audits.log({
        actorId: ctx.user.id,
        actorType: 'admin',
        action: 'user.role',
        target: arg,
        meta: { role: nextRole },
        ip: '',
      });
      await ctx.reply(`نقش کاربر به ${nextRole} تغییر کرد.`, {
        inline: chunkRows([button('پروفایل', `adm:user:${arg}`)]),
      });
      return true;
    }
    case 'note':
      await ctx.setFlow(`__admin:note:${arg}`, {});
      await ctx.reply('یادداشت جدید را ارسال کنید (حداکثر ۵۰۰ کاراکتر).');
      return true;
    case 'status':
      await renderStatus(ctx, bridge);
      return true;
    case 'setstatus': {
      const status = arg as BotStatus;
      if (!Object.keys(STATUS_LABELS).includes(status)) {
        await ctx.reply('وضعیت نامعتبر است.');
        return true;
      }
      await bridge.updateStatus(status);
      await ctx.reply(`وضعیت ربات به «${STATUS_LABELS[status]}» تغییر کرد.`, {
        inline: chunkRows([button('وضعیت', 'adm:status'), button('پنل', 'adm:home')]),
      });
      return true;
    }
    case 'settings':
      await renderSettings(ctx, bridge, Math.max(1, Number(arg) || 1));
      return true;
    case 'set':
      await ctx.setFlow(`__admin:set:${arg}`, {});
      await ctx.reply(
        `مقدار جدید برای <code>${arg}</code> را ارسال کنید.\nبرای حذف مقدار، یک خط تیره «-» بفرستید.`,
        { inline: chunkRows([button('انصراف', 'adm:settings')]) },
      );
      return true;
    case 'reqs':
      await renderRequirements(ctx, bridge);
      return true;
    case 'logs':
      await renderLogs(ctx, bridge);
      return true;
    case 'jobs':
      await renderJobs(ctx, bridge);
      return true;
    case 'jobs_retry': {
      const failed = await bridge.storage.jobs.list(bridge.bot.id, { status: 'failed', pageSize: 50 });
      for (const job of failed.items) {
        await bridge.storage.jobs.reschedule(job.id, new Date().toISOString());
      }
      await ctx.reply(`${toPersianDigits(failed.items.length)} کار برای اجرای مجدد در صف قرار گرفت.`, {
        inline: chunkRows([button('صف کارها', 'adm:jobs')]),
      });
      return true;
    }
    case 'broadcast':
      await renderBroadcastForm(ctx, bridge);
      return true;
    case 'broadcast_yes': {
      const text = String(ctx.flow?.data.text ?? '');
      if (!text) {
        await ctx.reply('متنی برای ارسال وجود ندارد.', { inline: chunkRows([button('بازگشت', 'adm:home')]) });
        return true;
      }
      try {
        const result = await bridge.broadcast.start(text);
        await ctx.clearFlow();
        await ctx.reply(
          `ارسال همگانی آغاز شد.\nگیرندگان: ${toPersianDigits(formatNumber(result.total, 'fa'))}\nوضعیت پیشرفت در بخش پیام همگانی قابل مشاهده است.`,
          { inline: chunkRows([button('وضعیت ارسال', 'adm:broadcast'), button('پنل', 'adm:home')]) },
        );
      } catch (error) {
        await ctx.reply(`ارسال همگانی ناموفق بود: ${(error as Error).message}`);
      }
      return true;
    }
    case 'broadcast_cancel':
      await bridge.broadcast.cancel();
      await ctx.reply('درخواست لغو ارسال همگانی ثبت شد.', { inline: chunkRows([button('بازگشت', 'adm:home')]) });
      return true;
    case 'help':
      await renderHelp(ctx, bridge);
      return true;
    default:
      await ctx.reply('گزینه ناشناخته.', { inline: chunkRows([button('بازگشت', 'adm:home')]) });
      return true;
  }
}

export interface AdminCommandResult {
  handled: boolean;
}

export async function handleAdminCommand(
  ctx: BotContext,
  bridge: AdminBridge,
  command: string,
): Promise<AdminCommandResult> {
  const adminCommands = new Set(['admin', 'stats', 'users', 'broadcast', 'block', 'unblock', 'status', 'settings', 'ping']);
  if (!adminCommands.has(command)) return { handled: false };
  if (!(await guardAdmin(ctx))) return { handled: true };

  switch (command) {
    case 'admin':
      await renderAdminHome(ctx, bridge);
      return { handled: true };
    case 'stats':
      await renderStats(ctx, bridge);
      return { handled: true };
    case 'users':
      await renderUsers(ctx, bridge, 1);
      return { handled: true };
    case 'status':
      await renderStatus(ctx, bridge);
      return { handled: true };
    case 'settings':
      await renderSettings(ctx, bridge, 1);
      return { handled: true };
    case 'ping': {
      const start = Date.now();
      const healthy = await bridge.storage.ping();
      await ctx.reply(
        `پاسخ سامانه: ${healthy ? 'سالم' : 'مشکل در پایگاه داده'}\nزمان پاسخ: ${toPersianDigits(Date.now() - start)} میلی‌ثانیه`,
        { inline: chunkRows([button('پنل', 'adm:home')]) },
      );
      return { handled: true };
    }
    case 'block':
    case 'unblock': {
      const target = ctx.params[0];
      if (!target) {
        await ctx.reply(`شناسه پلتفرم کاربر را وارد کنید: /${command} 123456789`);
        return { handled: true };
      }
      const user = await bridge.storage.users.findByPlatformId(bridge.bot.id, target);
      if (!user) {
        await ctx.reply('کاربری با این شناسه یافت نشد.');
        return { handled: true };
      }
      await bridge.storage.users.setBlocked(bridge.bot.id, user.id, command === 'block');
      await ctx.reply(command === 'block' ? 'کاربر مسدود شد.' : 'مسدودی برداشته شد.');
      return { handled: true };
    }
    case 'broadcast': {
      const inlineText = ctx.params.join(' ');
      if (inlineText.length >= 2) {
        try {
          const result = await bridge.broadcast.start(inlineText);
          await ctx.reply(`ارسال همگانی آغاز شد. گیرندگان: ${toPersianDigits(formatNumber(result.total, 'fa'))}`);
        } catch (error) {
          await ctx.reply(`ارسال ناموفق: ${(error as Error).message}`);
        }
        return { handled: true };
      }
      await renderBroadcastForm(ctx, bridge);
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

export const ADMIN_HELP_TEXT = [
  '<b>دستورهای مدیریتی</b>',
  '/admin — پنل مدیریت',
  '/stats — آمار',
  '/users — کاربران',
  '/broadcast متن — پیام همگانی',
  '/block شناسه — مسدودسازی',
  '/unblock شناسه — رفع مسدودی',
  '/status — وضعیت ربات',
  '/settings — تنظیمات',
  '/ping — سلامت',
].join('\n');

function startOfDay(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function truncate(input: string, max: number): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

export function describeSettingsSummary(entries: Array<{ key: string; value: string; sensitive: boolean }>): string {
  if (entries.length === 0) return 'بدون تنظیمات';
  return entries
    .slice(0, 10)
    .map((entry) => `${entry.key}: ${entry.sensitive ? maskSecret(entry.value) : entry.value}`)
    .join('\n');
}

export type { OutgoingMessage, Logger, Storage };
export { formatBytes };
