import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  nextSequence,
  parseNumberInput,
  requireAdmin,
  saveDoc,
  statusLabel,
  truncateText,
} from '../kit';

interface TicketMessage {
  from: 'user' | 'admin';
  text: string;
  at: string;
  authorName: string;
}

interface Ticket {
  id: string;
  number: number;
  userId: string;
  chatId: string;
  subject: string;
  category: string;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'answered' | 'closed';
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
}

const TICKETS = 'tickets';

const PRIORITY_LABELS: Record<Ticket['priority'], string> = { low: 'کم', normal: 'معمولی', high: 'فوری' };
const CATEGORIES = ['مالی', 'فنی', 'سفارش', 'پیشنهاد', 'سایر'];

async function allTickets(ctx: BotContext): Promise<Array<{ key: string; ticket: Ticket }>> {
  const result = await listDocs(ctx.storage, ctx.bot.id, TICKETS, 1, 300);
  return result.items
    .map((item) => ({ key: item.key, ticket: item.data as unknown as Ticket }))
    .filter((entry) => Boolean(entry.ticket?.number));
}

async function renderTicket(ctx: BotContext, number: number): Promise<void> {
  const entries = await allTickets(ctx);
  const found = entries.find((entry) => entry.ticket.number === number);
  if (!found || (!ctx.isAdmin && found.ticket.userId !== ctx.user.id)) {
    await ctx.reply('تیکت پیدا نشد.');
    return;
  }
  const ticket = found.ticket;
  const lines = [
    `<b>تیکت #${fa(ticket.number)}</b>`,
    '',
    `موضوع: ${ctx.escape(ticket.subject)}`,
    `دسته: ${ctx.escape(ticket.category)} | اولویت: ${PRIORITY_LABELS[ticket.priority]}`,
    `وضعیت: ${statusLabel(ticket.status)}`,
    '',
    ...ticket.messages.map(
      (message) =>
        `<b>${message.from === 'admin' ? 'پشتیبانی' : 'شما'}</b> — ${ctx.formatDateTime(message.at)}\n${ctx.escape(message.text)}`,
    ),
  ];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [
    [{ text: 'پاسخ', callbackData: `a:reply:${ticket.number}` }],
  ];
  if (ctx.isAdmin) {
    rows.push([{ text: 'بستن تیکت', callbackData: `a:close:${ticket.number}` }]);
  }
  rows.push([{ text: 'بازگشت', callbackData: ctx.isAdmin ? 'a:inbox:1' : 'a:mine:1' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderMine(ctx: BotContext, page = 1): Promise<void> {
  const entries = (await allTickets(ctx)).filter((entry) => entry.ticket.userId === ctx.user.id);
  if (entries.length === 0) {
    await ctx.reply('تیکتی ثبت نکرده‌اید.', {
      inline: { rows: [[{ text: 'ثبت تیکت', callbackData: 'a:new' }]] },
    });
    return;
  }
  entries.sort((a, b) => b.ticket.number - a.ticket.number);
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = entries.slice((current - 1) * pageSize, current * pageSize);
  const lines = ['<b>تیکت‌های شما</b>', ''];
  for (const entry of slice) {
    lines.push(`#${fa(entry.ticket.number)} — ${ctx.escape(truncateText(entry.ticket.subject, 40))} — ${statusLabel(entry.ticket.status)}`);
  }
  const rows = chunkButtons(
    slice.map((entry) => ({ text: `#${fa(entry.ticket.number)}`, data: `a:ticket:${entry.ticket.number}` })),
    3,
  ).rows;
  rows.push([{ text: 'ثبت تیکت جدید', callbackData: 'a:new' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderInbox(ctx: BotContext, page = 1): Promise<void> {
  const entries = await allTickets(ctx);
  const open = entries.filter((entry) => entry.ticket.status !== 'closed');
  const lines = [`<b>صندوق تیکت‌ها</b>`, '', `باز: ${fa(open.length)} | کل: ${fa(entries.length)}`, ''];
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(open.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = open.slice((current - 1) * pageSize, current * pageSize);
  for (const entry of slice) {
    lines.push(`#${fa(entry.ticket.number)} — ${ctx.escape(truncateText(entry.ticket.subject, 40))} — ${statusLabel(entry.ticket.status)}`);
  }
  const rows = chunkButtons(
    slice.map((entry) => ({ text: `#${fa(entry.ticket.number)}`, data: `a:ticket:${entry.ticket.number}` })),
    3,
  ).rows;
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const supportBot = defineBot({
  id: 'support',
  name: 'پشتیبانی مشتریان',
  category: 'B',
  summary: 'سیستم تیکت کامل با دسته‌بندی، اولویت، پاسخ و بستن تیکت',
  description:
    'کاربران تیکت ثبت می‌کنند، دسته و اولویت انتخاب می‌کنند و گفتگو را ادامه می‌دهند. مدیر ربات صندوق تیکت‌ها را می‌بیند، پاسخ می‌دهد و تیکت را می‌بندد. هر پاسخ به‌صورت خودکار به کاربر اطلاع داده می‌شود.',
  icon: 'headset',
  tags: ['support', 'commerce'],
  commands: [
    { command: 'ticket', description: 'ثبت تیکت جدید' },
    { command: 'mytickets', description: 'تیکت‌های من' },
    { command: 'inbox', description: 'صندوق تیکت‌ها (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'new', label: 'ثبت تیکت' },
    { id: 'mine', label: 'تیکت‌های من' },
    { id: 'inbox', label: 'صندوق پشتیبانی', adminOnly: true },
  ],
  defaultConfig: { autoReply: 'تیکت شما ثبت شد. کارشناسان در اسرع وقت پاسخ می‌دهند.' },
  actions: {
    new: async (ctx) => {
      await ctx.setFlow('ticket_subject', {});
      await ctx.reply('موضوع تیکت را در یک خط بنویسید:');
    },
    cat: async (ctx, param) => categoryChosen(ctx, Number(param) || 0),
    prio: async (ctx, param) => priorityChosen(ctx, param ?? 'normal'),
    mine: async (ctx, param) => renderMine(ctx, Number(param) || 1),
    inbox: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await renderInbox(ctx, Number(param) || 1);
    },
    ticket: async (ctx, param) => renderTicket(ctx, Number(param) || 0),
    reply: async (ctx, param) => {
      const number = Number(param) || 0;
      const entries = await allTickets(ctx);
      const found = entries.find((entry) => entry.ticket.number === number);
      if (!found || (!ctx.isAdmin && found.ticket.userId !== ctx.user.id)) {
        await ctx.reply('تیکت پیدا نشد.');
        return;
      }
      await ctx.setFlow('ticket_reply', { number });
      await ctx.reply('متن پاسخ خود را ارسال کنید:');
    },
    close: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const number = Number(param) || 0;
      const entries = await allTickets(ctx);
      const found = entries.find((entry) => entry.ticket.number === number);
      if (!found) {
        await ctx.reply('تیکت پیدا نشد.');
        return;
      }
      const ticket: Ticket = { ...found.ticket, status: 'closed', updatedAt: new Date().toISOString() };
      await saveDoc(ctx.storage, ctx.bot.id, TICKETS, found.key, ticket as unknown as Record<string, unknown>);
      await ctx.reply(`تیکت #${fa(number)} بسته شد.`);
      await ctx.api.sendMessage(ticket.chatId, {
        text: `تیکت #${fa(number)} شما بسته شد. در صورت نیاز می‌توانید تیکت جدید ثبت کنید.`,
        parseMode: 'HTML',
      });
    },
  },
  steps: {
    ticket_subject: async (ctx) => {
      const subject = ctx.text.trim().slice(0, 120);
      if (subject.length < 3) {
        await ctx.reply('موضوع کوتاه است. دوباره ارسال کنید.');
        return;
      }
      await ctx.setFlow('ticket_category', { subject });
      await ctx.reply('دسته تیکت را انتخاب کنید:', {
        inline: { rows: chunkButtons(CATEGORIES.map((item, index) => ({ text: item, data: `a:cat:${index}` })), 3).rows },
      });
    },
    ticket_message: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const text = ctx.text.trim();
      if (text.length < 5) {
        await ctx.reply('متن تیکت خیلی کوتاه است.');
        return;
      }
      const number = await nextSequence(ctx, 'tickets');
      const ticket: Ticket = {
        id: `t_${number}`,
        number,
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        subject: String(data.subject ?? 'بدون موضوع'),
        category: String(data.category ?? 'سایر'),
        priority: (data.priority as Ticket['priority']) ?? 'normal',
        status: 'open',
        messages: [
          {
            from: 'user',
            text,
            at: new Date().toISOString(),
            authorName: ctx.user.firstName ?? ctx.user.username ?? 'کاربر',
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, TICKETS, `ticket_${number}`, ticket as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(
        `${await ctx.getSetting<string>('autoReply', 'تیکت شما ثبت شد.')}\n\nشماره تیکت: #${fa(number)}`,
        { inline: { rows: [[{ text: 'مشاهده تیکت', callbackData: `a:ticket:${number}` }]] } },
      );
      await ctx.notifyAdmin(
        `تیکت جدید #${fa(number)}\nموضوع: ${ctx.escape(ticket.subject)}\nاولویت: ${PRIORITY_LABELS[ticket.priority]}\nدسته: ${ctx.escape(ticket.category)}`,
      );
    },
    ticket_reply: async (ctx) => {
      const number = Number(ctx.flow?.data.number ?? 0);
      const text = ctx.text.trim();
      if (text.length < 2) {
        await ctx.reply('متن پاسخ کوتاه است.');
        return;
      }
      const entries = await allTickets(ctx);
      const found = entries.find((entry) => entry.ticket.number === number);
      if (!found) {
        await ctx.clearFlow();
        await ctx.reply('تیکت پیدا نشد.');
        return;
      }
      const ticket = found.ticket;
      const isAdminReply = ctx.isAdmin && ticket.userId !== ctx.user.id;
      ticket.messages.push({
        from: isAdminReply ? 'admin' : 'user',
        text,
        at: new Date().toISOString(),
        authorName: isAdminReply ? 'پشتیبانی' : ctx.user.firstName ?? 'کاربر',
      });
      ticket.status = isAdminReply ? 'answered' : 'open';
      ticket.updatedAt = new Date().toISOString();
      await saveDoc(ctx.storage, ctx.bot.id, TICKETS, found.key, ticket as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply('پیام شما ثبت شد.', {
        inline: { rows: [[{ text: 'مشاهده تیکت', callbackData: `a:ticket:${number}` }]] },
      });
      if (isAdminReply) {
        await ctx.api.sendMessage(ticket.chatId, {
          text: `<b>پاسخ پشتیبانی به تیکت #${fa(number)}</b>\n\n${ctx.escape(text)}`,
          parseMode: 'HTML',
          inlineKeyboard: { rows: [[{ text: 'ادامه گفتگو', callbackData: `a:ticket:${number}` }]] },
        });
      } else {
        await ctx.notifyAdmin(`پیام جدید در تیکت #${fa(number)}\n${ctx.escape(text.slice(0, 300))}`);
      }
    },
    ticket_priority: async (ctx) => {
      void parseNumberInput(ctx.text);
      await ctx.reply('اولویت را انتخاب کنید:');
    },
  },
  async onCommand(ctx, command) {
    if (command === 'ticket') {
      await ctx.setFlow('ticket_subject', {});
      await ctx.reply('موضوع تیکت را در یک خط بنویسید:');
      return true;
    }
    if (command === 'mytickets') {
      await renderMine(ctx, 1);
      return true;
    }
    if (command === 'inbox') {
      if (!(await requireAdmin(ctx))) return true;
      await renderInbox(ctx, 1);
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await ctx.reply('<b>پشتیبانی</b>\n\nبرای ثبت درخواست، تیکت جدید بسازید.', {
      inline: {
        rows: [
          [{ text: 'ثبت تیکت', callbackData: 'a:new' }],
          [{ text: 'تیکت‌های من', callbackData: 'a:mine:1' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    await ctx.reply('برای ارتباط با پشتیبانی، تیکت جدید ثبت کنید.', {
      inline: { rows: [[{ text: 'ثبت تیکت', callbackData: 'a:new' }]] },
    });
  },
});

export const SUPPORT_CATEGORIES = CATEGORIES;
export type { Ticket };
export async function categoryChosen(ctx: BotContext, index: number): Promise<void> {
  const category = CATEGORIES[index] ?? 'سایر';
  await ctx.setFlow('ticket_priority', { ...(ctx.flow?.data ?? {}), category });
  await ctx.reply('اولویت تیکت را انتخاب کنید:', {
    inline: {
      rows: [
        [
          { text: 'کم', callbackData: 'a:prio:low' },
          { text: 'معمولی', callbackData: 'a:prio:normal' },
          { text: 'فوری', callbackData: 'a:prio:high' },
        ],
      ],
    },
  });
}

export async function priorityChosen(ctx: BotContext, priority: string): Promise<void> {
  await ctx.setFlow('ticket_message', { ...(ctx.flow?.data ?? {}), priority });
  await ctx.reply('متن تیکت خود را بنویسید:');
}

export async function findTicket(ctx: BotContext, key: string): Promise<Ticket | null> {
  const doc = await getDoc(ctx.storage, ctx.bot.id, TICKETS, key);
  return doc ? (doc.data as unknown as Ticket) : null;
}
