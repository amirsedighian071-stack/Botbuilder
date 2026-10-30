import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  parseDuration,
  parseNumberInput,
  requireAdmin,
  saveDoc,
  truncateText,
} from '../kit';

interface Customer {
  id: string;
  name: string;
  phone: string;
  telegramId: string;
  tags: string[];
  stage: 'lead' | 'active' | 'vip' | 'lost';
  note: string;
  totalValue: number;
  createdAt: string;
  lastContactAt: string;
}

interface FollowUp {
  id: string;
  customerId: string;
  title: string;
  dueAt: string;
  done: boolean;
  createdAt: string;
}

const CUSTOMERS = 'customers';
const FOLLOWUPS = 'followups';

const STAGE_LABELS: Record<Customer['stage'], string> = {
  lead: 'سرنخ',
  active: 'مشتری فعال',
  vip: 'مشتری ویژه',
  lost: 'از دست‌رفته',
};

async function allCustomers(ctx: BotContext): Promise<Array<{ key: string; customer: Customer }>> {
  const result = await listDocs(ctx.storage, ctx.bot.id, CUSTOMERS, 1, 300);
  return result.items.map((item) => ({ key: item.key, customer: item.data as unknown as Customer }));
}

async function renderList(ctx: BotContext, page = 1, search = ''): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  let entries = await allCustomers(ctx);
  if (search) {
    const needle = search.toLowerCase();
    entries = entries.filter(
      (entry) =>
        entry.customer.name.toLowerCase().includes(needle) ||
        entry.customer.phone.includes(needle) ||
        entry.customer.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
  }
  entries.sort((a, b) => b.customer.createdAt.localeCompare(a.customer.createdAt));
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = entries.slice((current - 1) * pageSize, current * pageSize);
  const lines = [
    '<b>مدیریت مشتریان</b>',
    '',
    `کل مشتریان: ${fa(entries.length)}${search ? ` | جست‌وجو: ${ctx.escape(search)}` : ''}`,
    '',
  ];
  for (const entry of slice) {
    lines.push(
      `<b>${ctx.escape(truncateText(entry.customer.name, 30))}</b> — ${STAGE_LABELS[entry.customer.stage]}\n` +
        `${ctx.escape(entry.customer.phone)} | ارزش: ${ctx.formatMoney(entry.customer.totalValue)}` +
        (entry.customer.tags.length > 0 ? `\nبرچسب‌ها: ${ctx.escape(entry.customer.tags.join('، '))}` : ''),
    );
  }
  const rows = chunkButtons(
    slice.map((entry) => ({ text: truncateText(entry.customer.name, 16), data: `a:customer:${entry.customer.id}` })),
    2,
  ).rows;
  const nav: Array<{ text: string; callbackData: string }> = [];
  if (current > 1) nav.push({ text: 'قبلی', callbackData: `a:list:${current - 1}` });
  if (current < pages) nav.push({ text: 'بعدی', callbackData: `a:list:${current + 1}` });
  if (nav.length > 0) rows.push(nav);
  rows.push([
    { text: 'افزودن مشتری', callbackData: 'a:add' },
    { text: 'جست‌وجو', callbackData: 'a:search' },
  ]);
  rows.push([{ text: 'کارهای پیگیری', callbackData: 'a:followups' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderCustomer(ctx: BotContext, id: string): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`);
  if (!doc) {
    await ctx.reply('مشتری پیدا نشد.');
    return;
  }
  const customer = doc.data as unknown as Customer;
  const followups = await listDocs(ctx.storage, ctx.bot.id, FOLLOWUPS, 1, 100);
  const tasks = followups.items
    .map((item) => item.data as unknown as FollowUp)
    .filter((task) => task.customerId === id && !task.done);
  const lines = [
    `<b>${ctx.escape(customer.name)}</b>`,
    '',
    `تلفن: ${ctx.escape(customer.phone)}`,
    customer.telegramId ? `شناسه پیام‌رسان: <code>${ctx.escape(customer.telegramId)}</code>` : '',
    `مرحله: ${STAGE_LABELS[customer.stage]}`,
    `ارزش کل: ${ctx.formatMoney(customer.totalValue)}`,
    customer.tags.length > 0 ? `برچسب‌ها: ${ctx.escape(customer.tags.join('، '))}` : '',
    `آخرین تماس: ${ctx.formatDateTime(customer.lastContactAt)}`,
    customer.note ? `\nیادداشت: ${ctx.escape(customer.note)}` : '',
    '',
    tasks.length > 0 ? '<b>پیگیری‌های باز</b>' : 'پیگیری بازی وجود ندارد.',
    ...tasks.map((task) => `• ${ctx.escape(task.title)} — ${ctx.formatDateTime(task.dueAt)}`),
  ].filter(Boolean);
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [
          { text: 'افزودن یادداشت', callbackData: `a:note:${id}` },
          { text: 'پیگیری جدید', callbackData: `a:followup:${id}` },
        ],
        [
          { text: 'تغییر مرحله', callbackData: `a:stage:${id}` },
          { text: 'افزودن خرید', callbackData: `a:value:${id}` },
        ],
        [{ text: 'بازگشت', callbackData: 'a:list:1' }],
      ],
    },
  });
}

export const crmBot = defineBot({
  id: 'crm',
  name: 'مدیریت مشتریان',
  category: 'B',
  summary: 'CRM سبک: پرونده مشتری، برچسب، مرحله فروش، ارزش و پیگیری زمان‌دار',
  description:
    'این ربات یک CRM کامل و سبک برای کسب‌وکارهای کوچک است: ثبت مشتری با تلفن و برچسب، مرحله قیف فروش (سرنخ، فعال، ویژه، از دست‌رفته)، ثبت ارزش خرید، یادداشت و پیگیری زمان‌دار با یادآوری خودکار. جست‌وجو بر اساس نام، تلفن یا برچسب انجام می‌شود.',
  icon: 'users',
  tags: ['crm', 'commerce'],
  commands: [
    { command: 'customers', description: 'فهرست مشتریان (مدیر)', adminOnly: true },
    { command: 'addcustomer', description: 'افزودن مشتری (مدیر)', adminOnly: true },
    { command: 'tasks', description: 'کارهای پیگیری (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'list', label: 'مشتریان', adminOnly: true },
    { id: 'add', label: 'افزودن مشتری', adminOnly: true },
    { id: 'followups', label: 'پیگیری‌ها', adminOnly: true },
  ],
  defaultConfig: { remindBeforeMinutes: 30 },
  actions: {
    list: async (ctx, param) => renderList(ctx, Number(param) || 1),
    customer: async (ctx, param) => {
      if (param) await renderCustomer(ctx, param);
    },
    add: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('customer_name', {});
      await ctx.reply('نام مشتری را ارسال کنید:');
    },
    search: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('customer_search', {});
      await ctx.reply('عبارت جست‌وجو (نام، تلفن یا برچسب) را ارسال کنید:');
    },
    note: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('customer_note', { id: param });
      await ctx.reply('یادداشت جدید را ارسال کنید:');
    },
    stage: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.reply('مرحله جدید را انتخاب کنید:', {
        inline: {
          rows: chunkButtons(
            Object.entries(STAGE_LABELS).map(([id, label]) => ({ text: label, data: `a:setstage:${param}:${id}` })),
            2,
          ).rows,
        },
      });
    },
    setstage: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const [id, stage] = (param ?? '').split(':');
      if (!id || !stage) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`);
      if (!doc) return;
      await saveDoc(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`, {
        ...(doc.data as Record<string, unknown>),
        stage,
      });
      await ctx.reply(`مرحله مشتری به «${STAGE_LABELS[stage as Customer['stage']] ?? stage}» تغییر کرد.`);
      await renderCustomer(ctx, id);
    },
    value: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('customer_value', { id: param });
      await ctx.reply('مبلغ خرید جدید را به تومان وارد کنید:');
    },
    followup: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('followup_title', { id: param });
      await ctx.reply('عنوان پیگیری را ارسال کنید. نمونه: تماس برای پیشنهاد تخفیف');
    },
    followups: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const result = await listDocs(ctx.storage, ctx.bot.id, FOLLOWUPS, 1, 200);
      const tasks = result.items.map((item) => item.data as unknown as FollowUp).filter((task) => !task.done);
      if (tasks.length === 0) {
        await ctx.reply('پیگیری بازی وجود ندارد.');
        return;
      }
      tasks.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      const lines = ['<b>پیگیری‌های باز</b>', ''];
      const rows: Array<Array<{ text: string; callbackData: string }>> = [];
      for (const task of tasks.slice(0, 10)) {
        lines.push(`${ctx.escape(truncateText(task.title, 40))} — ${ctx.formatDateTime(task.dueAt)}`);
        rows.push([{ text: `انجام شد: ${truncateText(task.title, 14)}`, callbackData: `a:taskdone:${task.id}` }]);
      }
      await ctx.reply(lines.join('\n'), { inline: { rows } });
    },
    taskdone: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FOLLOWUPS, `task_${param}`);
      if (doc) {
        await saveDoc(ctx.storage, ctx.bot.id, FOLLOWUPS, `task_${param}`, {
          ...(doc.data as Record<string, unknown>),
          done: true,
        });
      }
      await ctx.reply('پیگیری انجام‌شده ثبت شد.');
    },
  },
  steps: {
    customer_name: async (ctx) => {
      await ctx.setFlow('customer_phone', { name: ctx.text.trim().slice(0, 80) });
      await ctx.reply('شماره تلفن مشتری را وارد کنید:');
    },
    customer_phone: async (ctx) => {
      const phone = ctx.text.replace(/[^\d+]/g, '');
      if (phone.length < 8) {
        await ctx.reply('شماره تلفن معتبر نیست.');
        return;
      }
      await ctx.setFlow('customer_tags', { ...(ctx.flow?.data ?? {}), phone });
      await ctx.reply('برچسب‌ها را با کاما جدا کنید (یا «نه»):');
    },
    customer_tags: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const tags = /^(نه|no|-)$/i.test(ctx.text.trim())
        ? []
        : ctx.text
            .split(/[,،]/)
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 5);
      const id = `c_${Date.now().toString(36)}`;
      const customer: Customer = {
        id,
        name: String(data.name ?? 'مشتری'),
        phone: String(data.phone ?? ''),
        telegramId: ctx.user.platformUserId,
        tags,
        stage: 'lead',
        note: '',
        totalValue: 0,
        createdAt: new Date().toISOString(),
        lastContactAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`, customer as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`مشتری «${ctx.escape(customer.name)}» ثبت شد.`, {
        inline: { rows: [[{ text: 'مشاهده پروفایل', callbackData: `a:customer:${id}` }]] },
      });
    },
    customer_search: async (ctx) => {
      const query = ctx.text.trim();
      await ctx.clearFlow();
      await renderList(ctx, 1, query);
    },
    customer_note: async (ctx) => {
      const id = String(ctx.flow?.data.id ?? '');
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`);
      if (!doc) {
        await ctx.clearFlow();
        await ctx.reply('مشتری پیدا نشد.');
        return;
      }
      await saveDoc(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`, {
        ...(doc.data as Record<string, unknown>),
        note: ctx.text.trim().slice(0, 800),
        lastContactAt: new Date().toISOString(),
      });
      await ctx.clearFlow();
      await ctx.reply('یادداشت ذخیره شد.');
      await renderCustomer(ctx, id);
    },
    customer_value: async (ctx) => {
      const id = String(ctx.flow?.data.id ?? '');
      const value = parseNumberInput(ctx.text);
      if (value === null) {
        await ctx.reply('مبلغ نامعتبر است.');
        return;
      }
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`);
      if (!doc) {
        await ctx.clearFlow();
        await ctx.reply('مشتری پیدا نشد.');
        return;
      }
      const customer = doc.data as unknown as Customer;
      await saveDoc(ctx.storage, ctx.bot.id, CUSTOMERS, `customer_${id}`, {
        ...(doc.data as Record<string, unknown>),
        totalValue: customer.totalValue + value,
        lastContactAt: new Date().toISOString(),
      });
      await ctx.clearFlow();
      await ctx.reply(`ارزش مشتری به ${ctx.formatMoney(customer.totalValue + value)} رسید.`);
      await renderCustomer(ctx, id);
    },
    followup_title: async (ctx) => {
      await ctx.setFlow('followup_delay', { ...(ctx.flow?.data ?? {}), title: ctx.text.trim().slice(0, 100) });
      await ctx.reply('زمان یادآوری را ارسال کنید. نمونه: <code>2h</code> یا <code>1d</code>');
    },
    followup_delay: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const delay = parseDuration(ctx.text) ?? 3_600_000;
      const id = `t_${Date.now().toString(36)}`;
      const dueAt = new Date(Date.now() + delay).toISOString();
      const task: FollowUp = {
        id,
        customerId: String(data.id ?? ''),
        title: String(data.title ?? 'پیگیری'),
        dueAt,
        done: false,
        createdAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, FOLLOWUPS, `task_${id}`, task as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`پیگیری برای ${ctx.formatDateTime(dueAt)} ثبت شد.`);
      await ctx.enqueue('crm.remind', { taskId: id }, new Date(dueAt));
      await renderCustomer(ctx, String(data.id ?? ''));
    },
  },
  jobs: {
    'crm.remind': async (job) => {
      const taskId = String(job.payload.taskId ?? '');
      if (!taskId) return;
      const doc = await job.storage.documents.findByKey(job.bot.id, FOLLOWUPS, `task_${taskId}`);
      if (!doc) return;
      const task = doc.data as unknown as FollowUp;
      if (task.done) return;
      const customer = await job.storage.documents.findByKey(job.bot.id, CUSTOMERS, `customer_${task.customerId}`);
      const name = customer ? (customer.data as unknown as Customer).name : 'مشتری';
      await job.notifyAdmin(`یادآوری پیگیری\n${task.title}\nمشتری: ${name}`);
    },
  },
  async onCommand(ctx, command) {
    if (command === 'customers') {
      await renderList(ctx, 1);
      return true;
    }
    if (command === 'addcustomer') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('customer_name', {});
      await ctx.reply('نام مشتری را ارسال کنید:');
      return true;
    }
    if (command === 'tasks') {
      if (!(await requireAdmin(ctx))) return true;
      await crmBot.actions.followups(ctx);
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    if (!ctx.isAdmin) {
      await ctx.reply('این ربات برای مدیریت مشتریان کسب‌وکار طراحی شده است. برای ثبت اطلاعات خود با مدیر تماس بگیرید.');
      return;
    }
    await renderList(ctx, 1);
  },
  onText: async (ctx) => {
    if (ctx.isAdmin) {
      await renderList(ctx, 1, ctx.text.trim());
      return;
    }
    await ctx.reply('برای ارتباط با مدیر پیام خود را ارسال کنید.', {
      inline: { rows: [[{ text: 'درخواست تماس', callbackData: 'a:list' }]] },
    });
  },
});

export type { Customer };
export { parseNumberInput as parseCrmNumber };
