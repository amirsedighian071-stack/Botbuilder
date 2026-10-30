import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  parseNumberInput,
  requireAdmin,
  saveDoc,
  statusLabel,
  truncateText,
} from '../kit';

interface Plan {
  id: string;
  title: string;
  days: number;
  price: number;
  features: string;
  active: boolean;
}

interface Subscription {
  userId: string;
  chatId: string;
  planId: string;
  planTitle: string;
  status: 'pending' | 'active' | 'expired' | 'rejected';
  startedAt: string | null;
  expiresAt: string | null;
  lastReminderAt: string | null;
  requestedAt: string;
}

const PLANS = 'plans';
const SUBS = 'subscriptions';

function defaultPlans(): Plan[] {
  return [
    { id: 'plan_basic', title: 'پایه — یک ماهه', days: 30, price: 99000, features: 'دسترسی کامل به امکانات پایه', active: true },
    { id: 'plan_pro', title: 'حرفه‌ای — سه ماهه', days: 90, price: 249000, features: 'دسترسی کامل + پشتیبانی سریع', active: true },
  ];
}

async function getPlans(ctx: BotContext): Promise<Plan[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, PLANS, 1, 100, 'asc');
  const plans = result.items.map((item) => item.data as unknown as Plan).filter((plan) => plan.active);
  return plans.length > 0 ? plans : defaultPlans();
}

async function getSubscription(ctx: BotContext, userId: string): Promise<Subscription | null> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, SUBS, `sub_${userId}`);
  return doc ? (doc.data as unknown as Subscription) : null;
}

function daysLeft(subscription: Subscription): number {
  if (!subscription.expiresAt) return 0;
  return Math.ceil((new Date(subscription.expiresAt).getTime() - Date.now()) / 86_400_000);
}

async function renderPlans(ctx: BotContext): Promise<void> {
  const plans = await getPlans(ctx);
  const lines = ['<b>طرح‌های اشتراک</b>', ''];
  for (const plan of plans) {
    lines.push(`<b>${ctx.escape(plan.title)}</b>`);
    lines.push(`${ctx.formatMoney(plan.price)} — ${fa(plan.days)} روز`);
    if (plan.features) lines.push(ctx.escape(plan.features));
    lines.push('');
  }
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        ...chunkButtons(plans.map((plan) => ({ text: truncateText(plan.title, 20), data: `a:plan:${plan.id}` })), 2).rows,
        [{ text: 'وضعیت اشتراک من', callbackData: 'a:status' }],
      ],
    },
  });
}

async function renderStatus(ctx: BotContext): Promise<void> {
  const subscription = await getSubscription(ctx, ctx.user.id);
  if (!subscription) {
    await ctx.reply('اشتراک فعالی ندارید.', {
      inline: { rows: [[{ text: 'مشاهده طرح‌ها', callbackData: 'a:plans' }]] },
    });
    return;
  }
  const remaining = daysLeft(subscription);
  const lines = [
    '<b>وضعیت اشتراک</b>',
    '',
    `طرح: ${ctx.escape(subscription.planTitle)}`,
    `وضعیت: ${statusLabel(subscription.status)}`,
    subscription.startedAt ? `شروع: ${ctx.formatDate(subscription.startedAt)}` : '',
    subscription.expiresAt ? `انقضا: ${ctx.formatDate(subscription.expiresAt)}` : '',
    subscription.status === 'active' ? `روزهای باقی‌مانده: ${fa(Math.max(0, remaining))}` : '',
    subscription.status === 'pending' ? 'در انتظار تأیید مدیر' : '',
  ].filter(Boolean);
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [{ text: 'تمدید اشتراک', callbackData: 'a:plans' }],
        [{ text: 'منوی اصلی', callbackData: 'a:__menu' }],
      ],
    },
  });
}

async function renderPending(ctx: BotContext): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const result = await listDocs(ctx.storage, ctx.bot.id, SUBS, 1, 200);
  const pending = result.items
    .map((item) => ({ key: item.key, sub: item.data as unknown as Subscription }))
    .filter((entry) => entry.sub.status === 'pending');
  if (pending.length === 0) {
    await ctx.reply('درخواست در انتظاری وجود ندارد.');
    return;
  }
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  const lines = ['<b>درخواست‌های اشتراک</b>', ''];
  for (const entry of pending.slice(0, 10)) {
    lines.push(`${truncateText(entry.sub.planTitle, 30)} — ${ctx.escape(entry.sub.userId)}`);
    rows.push([
      { text: `تأیید ${truncateText(entry.sub.planTitle, 10)}`, callbackData: `a:approve:${entry.sub.userId}` },
      { text: 'رد', callbackData: `a:reject:${entry.sub.userId}` },
    ]);
  }
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const subscriptionBot = defineBot({
  id: 'subscription',
  name: 'مدیریت اشتراک',
  category: 'B',
  summary: 'طرح‌های اشتراک، درخواست، تأیید مدیر، تمدید و یادآوری انقضا',
  description:
    'مدیر طرح‌های اشتراک را با مدت و قیمت تعریف می‌کند. کاربر طرح را انتخاب می‌کند و درخواست ثبت می‌شود؛ پس از تأیید مدیر، اشتراک فعال می‌شود. سه روز پیش از انقضا یادآوری ارسال می‌گردد و اشتراک‌های منقضی به‌طور خودکار به‌روزرسانی می‌شوند.',
  icon: 'credit-card',
  tags: ['commerce', 'subscription'],
  commands: [
    { command: 'plans', description: 'طرح‌های اشتراک' },
    { command: 'mysub', description: 'وضعیت اشتراک من' },
    { command: 'pending', description: 'درخواست‌های در انتظار (مدیر)', adminOnly: true },
    { command: 'addplan', description: 'تعریف طرح جدید (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'plans', label: 'طرح‌های اشتراک' },
    { id: 'status', label: 'اشتراک من' },
    { id: 'pending', label: 'درخواست‌ها', adminOnly: true },
    { id: 'addplan', label: 'تعریف طرح', adminOnly: true },
  ],
  defaultConfig: { remindDaysBefore: 3, autoApprove: false },
  actions: {
    plans: async (ctx) => renderPlans(ctx),
    status: async (ctx) => renderStatus(ctx),
    plan: async (ctx, param) => {
      if (!param) return;
      const plans = await getPlans(ctx);
      const plan = plans.find((item) => item.id === param);
      if (!plan) {
        await ctx.reply('طرح پیدا نشد.');
        return;
      }
      const existing = await getSubscription(ctx, ctx.user.id);
      if (existing && existing.status === 'active' && daysLeft(existing) > 0) {
        await ctx.reply(
          `شما اشتراک فعال دارید تا ${ctx.formatDate(existing.expiresAt ?? '')}.\nبرای تمدید، همین طرح را دوباره انتخاب کنید.`,
        );
      }
      if (await ctx.getSetting<boolean>('autoApprove', false)) {
        await activate(ctx, plan, ctx.user.id, ctx.message.chatId);
        return;
      }
      const subscription: Subscription = {
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        planId: plan.id,
        planTitle: plan.title,
        status: 'pending',
        startedAt: null,
        expiresAt: null,
        lastReminderAt: null,
        requestedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, SUBS, `sub_${ctx.user.id}`, subscription as unknown as Record<string, unknown>);
      await ctx.reply(
        `درخواست اشتراک «${ctx.escape(plan.title)}» ثبت شد.\nمبلغ: ${ctx.formatMoney(plan.price)}\n\n` +
          'پس از تأیید پرداخت توسط مدیر، اشتراک شما فعال می‌شود.',
        { inline: { rows: [[{ text: 'وضعیت اشتراک', callbackData: 'a:status' }]] } },
      );
      await ctx.notifyAdmin(
        `درخواست اشتراک جدید\nطرح: ${ctx.escape(plan.title)}\nمبلغ: ${ctx.formatMoney(plan.price)}\nکاربر: <code>${ctx.user.platformUserId}</code>`,
      );
    },
    pending: async (ctx) => renderPending(ctx),
    approve: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      if (!param) return;
      const newDoc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, SUBS, `sub_${param}`);
      if (!newDoc) {
        await ctx.reply('درخواست پیدا نشد.');
        return;
      }
      const subscription = newDoc.data as unknown as Subscription;
      const plans = await getPlans(ctx);
      const plan = plans.find((item) => item.id === subscription.planId);
      await activate(ctx, plan ?? null, subscription.userId, subscription.chatId, subscription);
      await ctx.reply('اشتراک تأیید شد.');
    },
    reject: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, SUBS, `sub_${param}`);
      if (!doc) {
        await ctx.reply('درخواست پیدا نشد.');
        return;
      }
      const subscription = doc.data as unknown as Subscription;
      await saveDoc(ctx.storage, ctx.bot.id, SUBS, `sub_${param}`, {
        ...(doc.data as Record<string, unknown>),
        status: 'rejected',
      });
      await ctx.api.sendMessage(subscription.chatId, {
        text: 'درخواست اشتراک شما تأیید نشد. برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.',
        parseMode: 'HTML',
      });
      await ctx.reply('درخواست رد شد.');
    },
    addplan: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('plan_title', {});
      await ctx.reply('عنوان طرح را ارسال کنید:');
    },
  },
  steps: {
    plan_title: async (ctx) => {
      await ctx.setFlow('plan_days', { title: ctx.text.trim().slice(0, 60) });
      await ctx.reply('مدت طرح را به روز وارد کنید. نمونه: <code>30</code>');
    },
    plan_days: async (ctx) => {
      const days = parseNumberInput(ctx.text);
      if (days === null || days < 1) {
        await ctx.reply('مدت نامعتبر است.');
        return;
      }
      await ctx.setFlow('plan_price', { ...(ctx.flow?.data ?? {}), days });
      await ctx.reply('قیمت طرح را به تومان وارد کنید:');
    },
    plan_price: async (ctx) => {
      const price = parseNumberInput(ctx.text);
      if (price === null) {
        await ctx.reply('قیمت نامعتبر است.');
        return;
      }
      const id = `plan_${Date.now().toString(36)}`;
      const plan: Plan = {
        id,
        title: String(ctx.flow?.data.title ?? 'طرح'),
        days: Number(ctx.flow?.data.days ?? 30),
        price,
        features: '',
        active: true,
      };
      await saveDoc(ctx.storage, ctx.bot.id, PLANS, id, plan as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`طرح «${ctx.escape(plan.title)}» تعریف شد.`, {
        inline: { rows: [[{ text: 'طرح‌ها', callbackData: 'a:plans' }]] },
      });
    },
  },
  jobs: {
    'subscription.remind': async (job) => {
      const result = await job.storage.documents.list(job.bot.id, SUBS, { pageSize: 500 });
      const remindDays = Number(await job.getSetting<number>('remindDaysBefore', 3));
      for (const item of result.items) {
        const subscription = item.data as unknown as Subscription;
        if (subscription.status !== 'active' || !subscription.expiresAt) continue;
        const left = Math.ceil((new Date(subscription.expiresAt).getTime() - Date.now()) / 86_400_000);
        if (left <= 0) {
          await job.storage.documents.update(job.bot.id, item.id, {
            ...(item.data as Record<string, unknown>),
            status: 'expired',
          });
          await job.send(subscription.chatId, 'اشتراک شما منقضی شد. برای ادامه استفاده، اشتراک را تمدید کنید.', {
            rows: [[{ text: 'تمدید', callbackData: 'a:plans' }]],
          });
          continue;
        }
        if (left <= remindDays && !subscription.lastReminderAt) {
          await job.send(
            subscription.chatId,
            `اشتراک «${subscription.planTitle}» شما ${left} روز دیگر منقضی می‌شود.`,
            { rows: [[{ text: 'تمدید اشتراک', callbackData: 'a:plans' }]] },
          );
          await job.storage.documents.update(job.bot.id, item.id, {
            ...(item.data as Record<string, unknown>),
            lastReminderAt: new Date().toISOString(),
          });
        }
      }
      await job.enqueue('subscription.remind', {}, new Date(Date.now() + 6 * 3_600_000));
    },
  },
  async onCommand(ctx, command) {
    if (command === 'plans') {
      await renderPlans(ctx);
      return true;
    }
    if (command === 'mysub') {
      await renderStatus(ctx);
      return true;
    }
    if (command === 'pending') {
      await renderPending(ctx);
      return true;
    }
    if (command === 'addplan') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('plan_title', {});
      await ctx.reply('عنوان طرح را ارسال کنید:');
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await renderStatus(ctx);
    await ctx.enqueue('subscription.remind', {}, new Date(Date.now() + 5 * 60_000));
  },
  onText: async (ctx) => {
    await ctx.reply('برای مدیریت اشتراک از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'طرح‌ها', callbackData: 'a:plans' }]] },
    });
  },
});

async function activate(
  ctx: BotContext,
  plan: Plan | null,
  userId: string,
  chatId: string,
  existing?: Subscription,
): Promise<void> {
  const days = plan?.days ?? 30;
  const now = Date.now();
  const base = existing?.expiresAt && new Date(existing.expiresAt).getTime() > now ? new Date(existing.expiresAt).getTime() : now;
  const subscription: Subscription = {
    userId,
    chatId,
    planId: plan?.id ?? existing?.planId ?? 'unknown',
    planTitle: plan?.title ?? existing?.planTitle ?? 'اشتراک',
    status: 'active',
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(base + days * 86_400_000).toISOString(),
    lastReminderAt: null,
    requestedAt: existing?.requestedAt ?? new Date(now).toISOString(),
  };
  await saveDoc(ctx.storage, ctx.bot.id, SUBS, `sub_${userId}`, subscription as unknown as Record<string, unknown>);
  await ctx.api.sendMessage(chatId, {
    text: `<b>اشتراک فعال شد</b>\n\nطرح: ${subscription.planTitle}\nانقضا: ${new Intl.DateTimeFormat('fa-IR', { calendar: 'persian', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(subscription.expiresAt ?? now))}`,
    parseMode: 'HTML',
  });
  await ctx.reply('اشتراک برای کاربر فعال شد.', {
    inline: { rows: [[{ text: 'درخواست‌ها', callbackData: 'a:pending' }]] },
  });
}
