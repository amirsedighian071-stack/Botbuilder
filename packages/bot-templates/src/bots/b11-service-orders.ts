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

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  basePrice: number;
  active: boolean;
}

interface ServiceRequest {
  id: string;
  number: number;
  serviceId: string;
  serviceTitle: string;
  userId: string;
  chatId: string;
  customerName: string;
  phone: string;
  details: string;
  budget: number;
  status: 'pending' | 'in_progress' | 'done' | 'rejected' | 'cancelled';
  notes: Array<{ author: 'user' | 'admin'; text: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

const SERVICES = 'service_catalog';
const REQUESTS = 'requests';

async function catalog(ctx: BotContext): Promise<ServiceItem[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, SERVICES, 1, 100, 'asc');
  const items = result.items.map((item) => item.data as unknown as ServiceItem).filter((item) => item.active);
  if (items.length > 0) return items;
  return [
    {
      id: 'svc_consulting',
      title: 'مشاوره تخصصی',
      description: 'جلسه مشاوره آنلاین یا تلفنی',
      basePrice: 0,
      active: true,
    },
    {
      id: 'svc_design',
      title: 'طراحی و گرافیک',
      description: 'طراحی لوگو، پوستر و هویت بصری',
      basePrice: 0,
      active: true,
    },
    {
      id: 'svc_dev',
      title: 'توسعه نرم‌افزار',
      description: 'ساخت وب‌سایت، اپلیکیشن و ربات',
      basePrice: 0,
      active: true,
    },
  ];
}

async function renderCatalog(ctx: BotContext): Promise<void> {
  const items = await catalog(ctx);
  const lines = ['<b>خدمات قابل سفارش</b>', ''];
  for (const item of items) {
    lines.push(`<b>${ctx.escape(item.title)}</b>`);
    if (item.description) lines.push(ctx.escape(item.description));
    if (item.basePrice > 0) lines.push(`شروع از ${ctx.formatMoney(item.basePrice)}`);
    lines.push('');
  }
  await ctx.reply(lines.join('\n'), {
    inline: { rows: chunkButtons(items.map((item) => ({ text: truncateText(item.title, 20), data: `a:service:${item.id}` })), 2).rows },
  });
}

async function renderMyRequests(ctx: BotContext): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, REQUESTS, 1, 200);
  const requests = result.items
    .map((item) => item.data as unknown as ServiceRequest)
    .filter((request) => (ctx.isAdmin ? true : request.userId === ctx.user.id))
    .sort((a, b) => b.number - a.number);
  if (requests.length === 0) {
    await ctx.reply('درخواستی ثبت نکرده‌اید.', { inline: { rows: [[{ text: 'خدمات', callbackData: 'a:catalog' }]] } });
    return;
  }
  const lines = ['<b>درخواست‌های شما</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const request of requests.slice(0, 8)) {
    lines.push(`#${fa(request.number)} — ${ctx.escape(truncateText(request.serviceTitle, 30))} — ${statusLabel(request.status)}`);
    rows.push([{ text: `#${fa(request.number)}`, callbackData: `a:request:${request.number}` }]);
  }
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderRequest(ctx: BotContext, number: number): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, REQUESTS, 1, 300);
  const entry = result.items.find((item) => (item.data as unknown as ServiceRequest).number === number);
  if (!entry) {
    await ctx.reply('درخواست پیدا نشد.');
    return;
  }
  const request = entry.data as unknown as ServiceRequest;
  if (!ctx.isAdmin && request.userId !== ctx.user.id) {
    await ctx.reply('این درخواست به شما تعلق ندارد.');
    return;
  }
  const lines = [
    `<b>درخواست #${fa(request.number)}</b>`,
    '',
    `خدمت: ${ctx.escape(request.serviceTitle)}`,
    `وضعیت: ${statusLabel(request.status)}`,
    `نام: ${ctx.escape(request.customerName)}`,
    `تلفن: ${ctx.escape(request.phone)}`,
    `بودجه: ${request.budget > 0 ? ctx.formatMoney(request.budget) : 'توافقی'}`,
    '',
    `توضیحات: ${ctx.escape(request.details)}`,
  ];
  if (request.notes.length > 0) {
    lines.push('', '<b>گفتگو</b>');
    for (const note of request.notes.slice(-5)) {
      lines.push(`${note.author === 'admin' ? 'پشتیبانی' : 'شما'}: ${ctx.escape(note.text)}`);
    }
  }
  const rows: Array<Array<{ text: string; callbackData: string }>> = [
    [{ text: 'افزودن توضیح', callbackData: `a:note:${request.number}` }],
  ];
  if (ctx.isAdmin) {
    for (const status of ['in_progress', 'done', 'rejected'] as const) {
      rows.push([{ text: `تغییر به ${statusLabel(status)}`, callbackData: `a:setstatus:${request.number}:${status}` }]);
    }
  }
  rows.push([{ text: 'بازگشت', callbackData: 'a:myrequests' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const serviceOrdersBot = defineBot({
  id: 'service-orders',
  name: 'ثبت سفارش خدمات',
  category: 'B',
  summary: 'کاتالوگ خدمات، ثبت درخواست با جزئیات و بودجه، پیگیری وضعیت',
  description:
    'کسب‌وکارها می‌توانند کاتالوگ خدمات خود را داشته باشند و مشتری درخواست خود را با توضیحات، بودجه و اطلاعات تماس ثبت کند. هر درخواست شماره پیگیری می‌گیرد، گفتگوی دوطرفه با مدیر دارد و وضعیت آن (در انتظار، در حال انجام، انجام‌شده، ردشده) به کاربر اعلام می‌شود.',
  icon: 'clipboard-list',
  tags: ['commerce', 'services'],
  commands: [
    { command: 'services', description: 'کاتالوگ خدمات' },
    { command: 'requests', description: 'درخواست‌های من' },
    { command: 'addservice', description: 'افزودن خدمت (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'catalog', label: 'خدمات' },
    { id: 'myrequests', label: 'درخواست‌های من' },
    { id: 'addservice', label: 'افزودن خدمت', adminOnly: true },
    { id: 'allrequests', label: 'همه درخواست‌ها', adminOnly: true },
  ],
  defaultConfig: { requirePhone: true },
  actions: {
    catalog: async (ctx) => renderCatalog(ctx),
    service: async (ctx, param) => {
      const items = await catalog(ctx);
      const service = items.find((item) => item.id === param);
      if (!service) {
        await ctx.reply('خدمت پیدا نشد.');
        return;
      }
      await ctx.setFlow('request_details', { serviceId: service.id, serviceTitle: service.title });
      await ctx.reply(`خدمت «${ctx.escape(service.title)}» انتخاب شد.\nجزئیات درخواست خود را بنویسید:`);
    },
    myrequests: async (ctx) => renderMyRequests(ctx),
    allrequests: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await renderMyRequests(ctx);
    },
    request: async (ctx, param) => renderRequest(ctx, Number(param) || 0),
    note: async (ctx, param) => {
      const number = Number(param) || 0;
      if (!number) return;
      await ctx.setFlow('request_note', { number });
      await ctx.reply('توضیح خود را ارسال کنید:');
    },
    setstatus: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const [numberRaw, status] = (param ?? '').split(':');
      const number = Number(numberRaw);
      const allowed = ['in_progress', 'done', 'rejected', 'cancelled'];
      if (!allowed.includes(status)) return;
      const result = await listDocs(ctx.storage, ctx.bot.id, REQUESTS, 1, 300);
      const entry = result.items.find((item) => (item.data as unknown as ServiceRequest).number === number);
      if (!entry) {
        await ctx.reply('درخواست پیدا نشد.');
        return;
      }
      const request: ServiceRequest = {
        ...(entry.data as unknown as ServiceRequest),
        status: status as ServiceRequest['status'],
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, REQUESTS, `request_${number}`, request as unknown as Record<string, unknown>);
      await ctx.api.sendMessage(request.chatId, {
        text: `وضعیت درخواست #${fa(number)} شما به «${statusLabel(status)}» تغییر کرد.`,
        parseMode: 'HTML',
        inlineKeyboard: { rows: [[{ text: 'مشاهده درخواست', callbackData: `a:request:${number}` }]] },
      });
      await renderRequest(ctx, number);
    },
    addservice: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('service_add_title', {});
      await ctx.reply('عنوان خدمت جدید را ارسال کنید:');
    },
  },
  steps: {
    request_details: async (ctx) => {
      const details = ctx.text.trim();
      if (details.length < 10) {
        await ctx.reply('توضیحات کوتاه است. لطفاً جزئیات بیشتری بنویسید.');
        return;
      }
      await ctx.setFlow('request_budget', { ...(ctx.flow?.data ?? {}), details: details.slice(0, 1000) });
      await ctx.reply('بودجه تقریبی را به تومان وارد کنید یا کلمه «توافقی» را بفرستید:');
    },
    request_budget: async (ctx) => {
      const raw = ctx.text.trim();
      const budget = /توافق|نامشخص|negotiable/i.test(raw) ? 0 : parseNumberInput(raw);
      if (budget === null) {
        await ctx.reply('مبلغ نامعتبر است. عدد یا «توافقی» بفرستید.');
        return;
      }
      await ctx.setFlow('request_name', { ...(ctx.flow?.data ?? {}), budget });
      await ctx.reply('نام و نام خانوادگی خود را وارد کنید:');
    },
    request_name: async (ctx) => {
      await ctx.setFlow('request_phone', { ...(ctx.flow?.data ?? {}), customerName: ctx.text.trim().slice(0, 80) });
      await ctx.reply('شماره تماس خود را وارد کنید:');
    },
    request_phone: async (ctx) => {
      const phone = ctx.text.replace(/[^\d+]/g, '');
      if (phone.length < 8) {
        await ctx.reply('شماره تماس معتبر نیست.');
        return;
      }
      const data = ctx.flow?.data ?? {};
      const number = await nextSequence(ctx, 'requests');
      const request: ServiceRequest = {
        id: `r_${number}`,
        number,
        serviceId: String(data.serviceId ?? ''),
        serviceTitle: String(data.serviceTitle ?? 'خدمت'),
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        customerName: String(data.customerName ?? '-'),
        phone,
        details: String(data.details ?? ''),
        budget: Number(data.budget ?? 0),
        status: 'pending',
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, REQUESTS, `request_${number}`, request as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(
        `درخواست شما با شماره #${fa(number)} ثبت شد.\nکارشناسان به‌زودی با شما تماس می‌گیرند.`,
        { inline: { rows: [[{ text: 'پیگیری درخواست', callbackData: `a:request:${number}` }]] } },
      );
      await ctx.notifyAdmin(
        `درخواست خدمت #${fa(number)}\n${ctx.escape(request.serviceTitle)}\nبودجه: ${request.budget > 0 ? ctx.formatMoney(request.budget) : 'توافقی'}\n${ctx.escape(request.customerName)} — ${ctx.escape(phone)}`,
      );
    },
    request_note: async (ctx) => {
      const number = Number(ctx.flow?.data.number ?? 0);
      const text = ctx.text.trim();
      if (!text || !number) {
        await ctx.reply('متن توضیح خالی است.');
        return;
      }
      const result = await listDocs(ctx.storage, ctx.bot.id, REQUESTS, 1, 300);
      const entry = result.items.find((item) => (item.data as unknown as ServiceRequest).number === number);
      if (!entry) {
        await ctx.clearFlow();
        await ctx.reply('درخواست پیدا نشد.');
        return;
      }
      const request = entry.data as unknown as ServiceRequest;
      if (!ctx.isAdmin && request.userId !== ctx.user.id) {
        await ctx.reply('دسترسی ندارید.');
        return;
      }
      request.notes.push({ author: ctx.isAdmin && request.userId !== ctx.user.id ? 'admin' : 'user', text: text.slice(0, 600), at: new Date().toISOString() });
      request.updatedAt = new Date().toISOString();
      await saveDoc(ctx.storage, ctx.bot.id, REQUESTS, `request_${number}`, request as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply('توضیح ثبت شد.', {
        inline: { rows: [[{ text: 'مشاهده درخواست', callbackData: `a:request:${number}` }]] },
      });
      if (ctx.isAdmin) {
        await ctx.api.sendMessage(request.chatId, {
          text: `پیام جدید در درخواست #${fa(number)}:\n${ctx.escape(text)}`,
        });
      } else {
        await ctx.notifyAdmin(`توضیح جدید در درخواست #${fa(number)}: ${ctx.escape(text.slice(0, 300))}`);
      }
    },
    service_add_title: async (ctx) => {
      await ctx.setFlow('service_add_description', { title: ctx.text.trim().slice(0, 60) });
      await ctx.reply('توضیح خدمت را ارسال کنید:');
    },
    service_add_description: async (ctx) => {
      const id = `svc_${Date.now().toString(36)}`;
      await saveDoc(ctx.storage, ctx.bot.id, SERVICES, id, {
        id,
        title: String(ctx.flow?.data.title ?? 'خدمت'),
        description: ctx.text.trim().slice(0, 400),
        basePrice: 0,
        active: true,
      });
      await ctx.clearFlow();
      await ctx.reply('خدمت جدید به کاتالوگ اضافه شد.', {
        inline: { rows: [[{ text: 'کاتالوگ', callbackData: 'a:catalog' }]] },
      });
    },
  },
  async onCommand(ctx, command) {
    if (command === 'services') {
      await renderCatalog(ctx);
      return true;
    }
    if (command === 'requests') {
      await renderMyRequests(ctx);
      return true;
    }
    if (command === 'addservice') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('service_add_title', {});
      await ctx.reply('عنوان خدمت جدید را ارسال کنید:');
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await ctx.reply('<b>سفارش خدمات</b>\n\nخدمت مورد نظر را انتخاب کنید یا درخواست خود را ثبت کنید.', {
      inline: {
        rows: [
          [{ text: 'کاتالوگ خدمات', callbackData: 'a:catalog' }],
          [{ text: 'درخواست‌های من', callbackData: 'a:myrequests' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    await ctx.reply('برای ثبت سفارش از منوی خدمات استفاده کنید.', {
      inline: { rows: [[{ text: 'خدمات', callbackData: 'a:catalog' }]] },
    });
  },
});

export type { ServiceRequest };
export { getDoc as getRequestDoc };
