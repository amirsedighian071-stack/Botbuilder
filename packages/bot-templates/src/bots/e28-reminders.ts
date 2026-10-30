import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  paginationRow,
  parseDuration,
  parseJalaliDate,
  parseTimeOfDay,
  saveDoc,
  truncateText,
} from '../kit';

interface Reminder {
  id: string;
  userId: string;
  chatId: string;
  text: string;
  dueAt: string;
  done: boolean;
  repeat: 'none' | 'daily' | 'weekly';
  createdAt: string;
  firedAt: string | null;
}

const REMINDERS = 'reminders';

function key(id: string): string {
  return `rem_${id}`;
}

export function parseWhen(input: string): Date | null {
  const raw = input.trim();
  const duration = parseDuration(raw);
  if (duration && duration > 0) return new Date(Date.now() + duration);
  const jDate = parseJalaliDate(raw.split(/\s+/)[0] ?? '');
  const time = parseTimeOfDay(raw.split(/\s+/)[1] ?? '');
  if (jDate && time) {
    return new Date(jDate.getTime() + time.hour * 3_600_000 + time.minute * 60_000);
  }
  const timeOnly = parseTimeOfDay(raw);
  if (timeOnly) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(timeOnly.hour, timeOnly.minute, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target;
  }
  return null;
}

async function renderList(ctx: BotContext, page = 1): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, REMINDERS, 1, 400);
  const reminders = result.items
    .map((item) => item.data as unknown as Reminder)
    .filter((reminder) => reminder.userId === ctx.user.id && !reminder.done)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  if (reminders.length === 0) {
    await ctx.reply('یادآوری فعالی ندارید.', { inline: { rows: [[{ text: 'یادآوری جدید', callbackData: 'a:add' }]] } });
    return;
  }
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(reminders.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = reminders.slice((current - 1) * pageSize, current * pageSize);
  const lines = ['<b>یادآوری‌های شما</b>', ''];
  for (const reminder of slice) {
    lines.push(`• ${ctx.escape(truncateText(reminder.text, 60))}\n  ${ctx.formatDateTime(reminder.dueAt)}${reminder.repeat !== 'none' ? ` — تکرار ${reminder.repeat === 'daily' ? 'روزانه' : 'هفتگی'}` : ''}`);
  }
  const rows = chunkButtons(
    slice.map((reminder) => ({ text: `انجام شد: ${truncateText(reminder.text, 14)}`, data: `a:done:${reminder.id}` })),
    2,
  ).rows;
  rows.push(paginationRow('a:list', current, pages));
  rows.push([{ text: 'یادآوری جدید', callbackData: 'a:add' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const reminderBot = defineBot({
  id: 'reminders',
  name: 'یادآور و مدیریت کارها',
  category: 'E',
  summary: 'یادآوری زمان‌دار با پشتیبانی از مدت، تاریخ شمسی و تکرار روزانه/هفتگی',
  description:
    'یادآوری و کار با زمان دقیق ثبت می‌کند: «2h» برای دو ساعت بعد، «14:30» برای امروز یا فردا و «1404-08-15 09:00» برای تاریخ شمسی. زمان‌بند موتور مرکزی پیام یادآوری را دقیقاً در موعد ارسال می‌کند و تکرار روزانه و هفتگی پشتیبانی می‌شود.',
  icon: 'alarm-clock',
  tags: ['productivity', 'utility'],
  commands: [
    { command: 'remind', description: 'ثبت یادآوری' },
    { command: 'reminders', description: 'فهرست یادآوری‌ها' },
    { command: 'today', description: 'کارهای امروز' },
  ],
  menu: [
    { id: 'add', label: 'یادآوری جدید' },
    { id: 'list', label: 'یادآوری‌ها' },
    { id: 'today', label: 'کارهای امروز' },
  ],
  defaultConfig: { maxReminders: 100, defaultRepeat: 'none' },
  actions: {
    add: async (ctx) => {
      await ctx.setFlow('reminder_text', {});
      await ctx.reply('متن یادآوری را ارسال کنید. نمونه: پرداخت قبض');
    },
    list: async (ctx, param) => renderList(ctx, Number(param) || 1),
    done: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, REMINDERS, key(param));
      if (!doc) return;
      const reminder = doc.data as unknown as Reminder;
      if (reminder.userId !== ctx.user.id) return;
      await saveDoc(ctx.storage, ctx.bot.id, REMINDERS, key(param), {
        ...(doc.data as Record<string, unknown>),
        done: true,
      });
      await ctx.reply('یادآوری انجام‌شده ثبت شد.');
      await renderList(ctx);
    },
    del: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, REMINDERS, key(param));
      if (!doc) return;
      const reminder = doc.data as unknown as Reminder;
      if (reminder.userId !== ctx.user.id) return;
      await ctx.storage.documents.deleteByKey(ctx.bot.id, REMINDERS, key(param));
      await ctx.reply('یادآوری حذف شد.');
      await renderList(ctx);
    },
    repeat: async (ctx, param) => {
      await ctx.updateFlow({ repeat: param });
      await finishReminder(ctx);
    },
    today: async (ctx) => {
      const result = await listDocs(ctx.storage, ctx.bot.id, REMINDERS, 1, 400);
      const today = new Date();
      const items = result.items
        .map((item) => item.data as unknown as Reminder)
        .filter((reminder) => {
          if (reminder.userId !== ctx.user.id || reminder.done) return false;
          const due = new Date(reminder.dueAt);
          return due.toDateString() === today.toDateString() || due.getTime() < today.getTime();
        });
      if (items.length === 0) {
        await ctx.reply('برای امروز کاری ثبت نشده است.');
        return;
      }
      const lines = ['<b>کارهای امروز</b>', ''];
      for (const item of items) lines.push(`• ${ctx.escape(truncateText(item.text, 70))} — ${ctx.formatDateTime(item.dueAt)}`);
      await ctx.reply(lines.join('\n'));
    },
  },
  steps: {
    reminder_repeat: async (ctx) => {
      const input = ctx.text.trim();
      const mapped = /روز|daily/i.test(input) ? 'daily' : /هفت|weekly/i.test(input) ? 'weekly' : /بدون|none/i.test(input) ? 'none' : null;
      if (!mapped) {
        await ctx.reply('یکی از گزینه‌های بدون تکرار، روزانه یا هفتگی را انتخاب کنید.', {
          inline: {
            rows: [
              [
                { text: 'بدون تکرار', callbackData: 'a:repeat:none' },
                { text: 'روزانه', callbackData: 'a:repeat:daily' },
                { text: 'هفتگی', callbackData: 'a:repeat:weekly' },
              ],
            ],
          },
        });
        return;
      }
      await ctx.updateFlow({ repeat: mapped });
      await finishReminder(ctx);
    },
    reminder_text: async (ctx) => {
      const text = ctx.text.trim();
      if (text.length < 2) {
        await ctx.reply('متن یادآوری خیلی کوتاه است.');
        return;
      }
      await ctx.setFlow('reminder_when', { text: text.slice(0, 300) });
      await ctx.reply(
        'چه زمانی یادآوری شود؟\n• <code>2h</code> دو ساعت بعد\n• <code>14:30</code> امروز یا فردا\n• <code>1404-08-15 09:00</code> تاریخ شمسی',
      );
    },
    reminder_when: async (ctx) => {
      const due = parseWhen(ctx.text);
      if (!due) {
        await ctx.reply('زمان قابل تشخیص نیست. نمونه‌ها: <code>2h</code> یا <code>14:30</code> یا <code>1404-08-15 09:00</code>');
        return;
      }
      if (due.getTime() < Date.now() - 60_000) {
        await ctx.reply('زمان انتخاب‌شده در گذشته است.');
        return;
      }
      await ctx.setFlow('reminder_repeat', { ...(ctx.flow?.data ?? {}), dueAt: due.toISOString() });
      await ctx.reply('تکرار یادآوری:', {
        inline: {
          rows: [
            [
              { text: 'بدون تکرار', callbackData: 'a:repeat:none' },
              { text: 'روزانه', callbackData: 'a:repeat:daily' },
              { text: 'هفتگی', callbackData: 'a:repeat:weekly' },
            ],
          ],
        },
      });
    },
  },
  jobs: {
    'reminder.fire': async (job) => {
      const id = String(job.payload.reminderId ?? '');
      if (!id) return;
      const doc = await job.storage.documents.findByKey(job.bot.id, REMINDERS, key(id));
      if (!doc) return;
      const reminder = doc.data as unknown as Reminder;
      if (reminder.done) return;
      await job.send(
        reminder.chatId,
        `<b>یادآوری</b>\n\n${reminder.text}\n\n<i>${new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(reminder.dueAt))}</i>`,
        {
          rows: [
            [{ text: 'انجام شد', callbackData: `a:done:${id}` }],
            [{ text: 'لیست یادآوری‌ها', callbackData: 'a:list' }],
          ],
        },
      );
      if (reminder.repeat === 'none') {
        await job.storage.documents.update(job.bot.id, doc.id, {
          ...(doc.data as Record<string, unknown>),
          firedAt: new Date().toISOString(),
          done: true,
        });
        return;
      }
      const nextDue = new Date(
        new Date(reminder.dueAt).getTime() + (reminder.repeat === 'daily' ? 86_400_000 : 7 * 86_400_000),
      );
      await job.storage.documents.update(job.bot.id, doc.id, {
        ...(doc.data as Record<string, unknown>),
        dueAt: nextDue.toISOString(),
        firedAt: new Date().toISOString(),
      });
      await job.enqueue('reminder.fire', { reminderId: id }, nextDue);
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>یادآور</b>\n\nیادآوری بسازید یا فهرست خود را ببینید.', {
      inline: {
        rows: [
          [{ text: 'یادآوری جدید', callbackData: 'a:add' }],
          [
            { text: 'یادآوری‌ها', callbackData: 'a:list' },
            { text: 'امروز', callbackData: 'a:today' },
          ],
        ],
      },
    });
  },
  onText: async (ctx) => {
    const when = parseWhen(ctx.text);
    if (when) {
      await ctx.reply(`زمان «${ctx.text.trim()}» را برای یادآوری درک کردم. ابتدا متن یادآوری را ارسال کنید یا از منو استفاده کنید.`, {
        inline: { rows: [[{ text: 'یادآوری جدید', callbackData: 'a:add' }]] },
      });
      return;
    }
    await ctx.reply('برای ثبت یادآوری از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'یادآوری جدید', callbackData: 'a:add' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'reminders') {
      await renderList(ctx, 1);
      return true;
    }
    if (command === 'remind') {
      const rawArgs = ctx.text.replace(/^\/remind(@[A-Za-z0-9_]+)?\s*/i, '').split('|').map((part) => part.trim()).filter(Boolean);
      const parts = rawArgs;
      if (parts.length >= 2) {
        const due = parseWhen(parts[1]);
        if (due) {
          const id = Date.now().toString(36);
          await saveDoc(ctx.storage, ctx.bot.id, REMINDERS, key(id), {
            id,
            userId: ctx.user.id,
            chatId: ctx.message.chatId,
            text: parts[0].slice(0, 300),
            dueAt: due.toISOString(),
            done: false,
            repeat: 'none',
            createdAt: new Date().toISOString(),
            firedAt: null,
          });
          await ctx.enqueue('reminder.fire', { reminderId: id }, due);
          await ctx.reply(`یادآوری برای ${ctx.formatDateTime(due)} ثبت شد.`);
          return true;
        }
      }
      await ctx.setFlow('reminder_text', {});
      await ctx.reply('متن یادآوری را ارسال کنید. نمونه: پرداخت قبض');
      return true;
    }
    if (command === 'today') {
      await reminderBot.actions.today(ctx);
      return true;
    }
    return false;
  },
});

async function finishReminder(ctx: BotContext): Promise<void> {
  const data = ctx.flow?.data ?? {};
  const dueAt = String(data.dueAt ?? '');
  const text = String(data.text ?? '');
  if (!dueAt || !text) {
    await ctx.clearFlow();
    await ctx.reply('اطلاعات یادآوری ناقص است.');
    return;
  }
  const id = Date.now().toString(36);
  const reminder: Reminder = {
    id,
    userId: ctx.user.id,
    chatId: ctx.message.chatId,
    text,
    dueAt,
    done: false,
    repeat: (data.repeat as Reminder['repeat']) ?? 'none',
    createdAt: new Date().toISOString(),
    firedAt: null,
  };
  await saveDoc(ctx.storage, ctx.bot.id, REMINDERS, key(id), reminder as unknown as Record<string, unknown>);
  await ctx.clearFlow();
  await ctx.reply(`یادآوری ثبت شد.\nزمان: ${ctx.formatDateTime(dueAt)}`, {
    inline: {
      rows: [
        [
          { text: 'فهرست', callbackData: 'a:list' },
          { text: 'یادآوری جدید', callbackData: 'a:add' },
        ],
      ],
    },
  });
  await ctx.enqueue('reminder.fire', { reminderId: id }, new Date(dueAt));
  void fa;
}

export type { Reminder };
