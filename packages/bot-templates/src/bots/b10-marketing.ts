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
  statusLabel,
  truncateText,
} from '../kit';

interface Campaign {
  id: string;
  title: string;
  text: string;
  audience: 'all' | 'admins' | 'active7d' | 'inactive30d';
  status: 'draft' | 'scheduled' | 'sending' | 'done' | 'cancelled';
  scheduledAt: string | null;
  createdAt: string;
  sent: number;
  failed: number;
  offset: number;
}

interface Subscriber {
  userId: string;
  chatId: string;
  topics: string[];
  subscribed: boolean;
  updatedAt: string;
}

const CAMPAIGNS = 'campaigns';
const SUBSCRIBERS = 'subscribers';
const TOPICS = [
  { id: 'offers', label: 'پیشنهادهای ویژه' },
  { id: 'news', label: 'اخبار و محصولات جدید' },
  { id: 'tips', label: 'آموزش و نکات' },
];

const AUDIENCE_LABELS: Record<Campaign['audience'], string> = {
  all: 'همه کاربران',
  admins: 'فقط مدیران',
  active7d: 'فعال در ۷ روز گذشته',
  inactive30d: 'غیرفعال بیش از ۳۰ روز',
};

async function getSubscriber(ctx: BotContext, userId: string): Promise<Subscriber | null> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, SUBSCRIBERS, `sub_${userId}`);
  return doc ? (doc.data as unknown as Subscriber) : null;
}

async function renderPreferences(ctx: BotContext): Promise<void> {
  const subscriber = await getSubscriber(ctx, ctx.user.id);
  const topics = subscriber?.topics ?? ['offers', 'news'];
  const lines = [
    '<b>تنظیمات اطلاع‌رسانی</b>',
    '',
    `وضعیت دریافت: ${subscriber?.subscribed === false ? 'غیرفعال' : 'فعال'}`,
    '',
    'موضوع‌هایی که می‌خواهید دریافت کنید:',
  ];
  for (const topic of TOPICS) {
    lines.push(`${topics.includes(topic.id) ? '✓' : '○'} ${topic.label}`);
  }
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const topic of TOPICS) {
    rows.push([
      {
        text: `${topics.includes(topic.id) ? 'غیرفعال‌سازی' : 'فعال‌سازی'} ${truncateText(topic.label, 16)}`,
        callbackData: `a:topic:${topic.id}`,
      },
    ]);
  }
  rows.push([
    {
      text: subscriber?.subscribed === false ? 'فعال‌سازی دریافت' : 'توقف دریافت',
      callbackData: 'a:toggle',
    },
  ]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderCampaigns(ctx: BotContext): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const result = await listDocs(ctx.storage, ctx.bot.id, CAMPAIGNS, 1, 100);
  const campaigns = result.items.map((item) => ({ key: item.key, campaign: item.data as unknown as Campaign }));
  if (campaigns.length === 0) {
    await ctx.reply('کمپینی ثبت نشده است.', { inline: { rows: [[{ text: 'کمپین جدید', callbackData: 'a:newcampaign' }]] } });
    return;
  }
  const lines = ['<b>کمپین‌ها</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const entry of campaigns.slice(0, 8)) {
    const campaign = entry.campaign;
    lines.push(
      `${ctx.escape(truncateText(campaign.title, 30))} — ${statusLabel(campaign.status)}\n` +
        `مخاطب: ${AUDIENCE_LABELS[campaign.audience]} | ارسال: ${fa(campaign.sent)} | ناموفق: ${fa(campaign.failed)}`,
    );
    rows.push([{ text: `جزئیات ${truncateText(campaign.title, 12)}`, callbackData: `a:campaign:${campaign.id}` }]);
  }
  rows.push([{ text: 'کمپین جدید', callbackData: 'a:newcampaign' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderCampaign(ctx: BotContext, id: string): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${id}`);
  if (!doc) {
    await ctx.reply('کمپین پیدا نشد.');
    return;
  }
  const campaign = doc.data as unknown as Campaign;
  const lines = [
    `<b>کمپین ${ctx.escape(campaign.title)}</b>`,
    '',
    `وضعیت: ${statusLabel(campaign.status)}`,
    `مخاطب: ${AUDIENCE_LABELS[campaign.audience]}`,
    campaign.scheduledAt ? `زمان ارسال: ${ctx.formatDateTime(campaign.scheduledAt)}` : 'ارسال فوری',
    `ارسال‌شده: ${fa(campaign.sent)} | ناموفق: ${fa(campaign.failed)}`,
    '',
    'متن:',
    ctx.escape(campaign.text.slice(0, 800)),
  ];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  if (campaign.status === 'draft' || campaign.status === 'scheduled') {
    rows.push([{ text: 'ارسال آزمایشی به من', callbackData: `a:testcampaign:${campaign.id}` }]);
    rows.push([{ text: 'ارسال به مخاطبان', callbackData: `a:sendcampaign:${campaign.id}` }]);
    rows.push([{ text: 'لغو کمپین', callbackData: `a:cancelcampaign:${campaign.id}` }]);
  }
  rows.push([{ text: 'بازگشت', callbackData: 'a:campaigns' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const marketingBot = defineBot({
  id: 'marketing',
  name: 'بازاریابی و اطلاع‌رسانی',
  category: 'B',
  summary: 'کمپین پیام‌رسانی با بخش‌بندی مخاطب، زمان‌بندی و کنترل نرخ ارسال',
  description:
    'مدیر کمپین می‌سازد، متن را تعیین می‌کند و مخاطب را بر اساس فعالیت و نقش بخش‌بندی می‌کند. ارسال به‌صورت دسته‌ای و با محدودیت نرخ انجام می‌شود تا محدودیت پیام‌رسان رعایت شود؛ پیشرفت ارسال ذخیره و قابل پیگیری است. کاربران می‌توانند موضوع‌های اطلاع‌رسانی را مدیریت یا دریافت را متوقف کنند.',
  icon: 'megaphone',
  tags: ['marketing', 'commerce'],
  commands: [
    { command: 'campaigns', description: 'کمپین‌ها (مدیر)', adminOnly: true },
    { command: 'newcampaign', description: 'کمپین جدید (مدیر)', adminOnly: true },
    { command: 'preferences', description: 'تنظیمات اطلاع‌رسانی' },
  ],
  menu: [
    { id: 'preferences', label: 'تنظیمات اطلاع‌رسانی' },
    { id: 'campaigns', label: 'کمپین‌ها', adminOnly: true },
    { id: 'newcampaign', label: 'کمپین جدید', adminOnly: true },
  ],
  defaultConfig: { batchSize: 20, ratePerSecond: 5 },
  actions: {
    preferences: async (ctx) => renderPreferences(ctx),
    topic: async (ctx, param) => {
      if (!param) return;
      const existing = await getSubscriber(ctx, ctx.user.id);
      const topics = new Set(existing?.topics ?? ['offers', 'news']);
      if (topics.has(param)) topics.delete(param);
      else topics.add(param);
      const subscriber: Subscriber = {
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        topics: [...topics],
        subscribed: existing?.subscribed ?? true,
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, SUBSCRIBERS, `sub_${ctx.user.id}`, subscriber as unknown as Record<string, unknown>);
      await renderPreferences(ctx);
    },
    toggle: async (ctx) => {
      const existing = await getSubscriber(ctx, ctx.user.id);
      const subscriber: Subscriber = {
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        topics: existing?.topics ?? ['offers', 'news'],
        subscribed: existing ? !existing.subscribed : false,
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, SUBSCRIBERS, `sub_${ctx.user.id}`, subscriber as unknown as Record<string, unknown>);
      await renderPreferences(ctx);
    },
    campaigns: async (ctx) => renderCampaigns(ctx),
    campaign: async (ctx, param) => {
      if (param) await renderCampaign(ctx, param);
    },
    newcampaign: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('campaign_title', {});
      await ctx.reply('عنوان کمپین (برای مدیریت داخلی) را ارسال کنید:');
    },
    audience: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('campaign_schedule', { ...(ctx.flow?.data ?? {}), audience: param ?? 'all' });
      await ctx.reply('زمان ارسال را وارد کنید. نمونه: <code>0</code> برای ارسال فوری، <code>2h</code> برای دو ساعت بعد، <code>1d</code> برای فردا');
    },
    testcampaign: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${param}`);
      if (!doc) return;
      const campaign = doc.data as unknown as Campaign;
      await ctx.reply(`<b>پیش‌نمایش کمپین</b>\n\n${ctx.escape(campaign.text)}`);
    },
    sendcampaign: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${param}`);
      if (!doc) return;
      const campaign = doc.data as unknown as Campaign;
      await saveDoc(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${param}`, {
        ...(doc.data as Record<string, unknown>),
        status: 'sending',
        offset: 0,
        sent: 0,
        failed: 0,
      });
      await ctx.enqueue('campaign.send', { campaignId: campaign.id });
      await ctx.reply('ارسال کمپین آغاز شد. پیشرفت در بخش کمپین‌ها قابل مشاهده است.');
    },
    cancelcampaign: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${param}`);
      if (!doc) return;
      await saveDoc(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${param}`, {
        ...(doc.data as Record<string, unknown>),
        status: 'cancelled',
      });
      await ctx.reply('کمپین لغو شد.');
    },
  },
  steps: {
    campaign_title: async (ctx) => {
      await ctx.setFlow('campaign_text', { title: ctx.text.trim().slice(0, 80) });
      await ctx.reply('متن پیام کمپین را ارسال کنید (حداکثر ۴۰۰۰ کاراکتر):');
    },
    campaign_text: async (ctx) => {
      const text = ctx.text.trim();
      if (text.length < 3) {
        await ctx.reply('متن کوتاه است.');
        return;
      }
      await ctx.setFlow('campaign_audience', { ...(ctx.flow?.data ?? {}), text: text.slice(0, 4000) });
      await ctx.reply('مخاطب کمپین را انتخاب کنید:', {
        inline: {
          rows: chunkButtons(
            Object.entries(AUDIENCE_LABELS).map(([id, label]) => ({ text: label, data: `a:audience:${id}` })),
            2,
          ).rows,
        },
      });
    },
    campaign_schedule: async (ctx) => {
      const delay = parseDuration(ctx.text);
      const data = ctx.flow?.data ?? {};
      const id = `c_${Date.now().toString(36)}`;
      const scheduledAt = delay && delay > 0 ? new Date(Date.now() + delay).toISOString() : null;
      const campaign: Campaign = {
        id,
        title: String(data.title ?? 'کمپین'),
        text: String(data.text ?? ''),
        audience: (data.audience as Campaign['audience']) ?? 'all',
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduledAt,
        createdAt: new Date().toISOString(),
        sent: 0,
        failed: 0,
        offset: 0,
      };
      await saveDoc(ctx.storage, ctx.bot.id, CAMPAIGNS, `campaign_${id}`, campaign as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(
        `کمپین «${ctx.escape(campaign.title)}» ذخیره شد.` +
          (scheduledAt ? `\nارسال در ${ctx.formatDateTime(scheduledAt)}` : '\nبرای ارسال، وارد جزئیات کمپین شوید.'),
        { inline: { rows: [[{ text: 'جزئیات کمپین', callbackData: `a:campaign:${id}` }]] } },
      );
      if (scheduledAt) {
        await ctx.enqueue('campaign.send', { campaignId: id }, new Date(scheduledAt));
      }
    },
  },
  jobs: {
    'campaign.send': async (job) => {
      const campaignId = String(job.payload.campaignId ?? '');
      if (!campaignId) return;
      const doc = await job.storage.documents.findByKey(job.bot.id, CAMPAIGNS, `campaign_${campaignId}`);
      if (!doc) return;
      const campaign = doc.data as unknown as Campaign;
      if (campaign.status === 'cancelled' || campaign.status === 'done') return;

      const pageSize = Number(await job.getSetting<number>('batchSize', 20));
      const users = await job.storage.users.listAll(job.bot.id, pageSize, campaign.offset);
      if (users.length === 0) {
        await job.storage.documents.update(job.bot.id, doc.id, {
          ...(doc.data as Record<string, unknown>),
          status: 'done',
        });
        await job.notifyAdmin(`کمپین «${campaign.title}» کامل شد. ارسال: ${campaign.sent} — ناموفق: ${campaign.failed}`);
        return;
      }

      const now = Date.now();
      const target = users.filter((user) => {
        if (user.isBlocked) return false;
        if (campaign.audience === 'admins') return user.role === 'admin' || user.role === 'owner';
        if (campaign.audience === 'active7d') return now - new Date(user.lastSeenAt).getTime() < 7 * 86_400_000;
        if (campaign.audience === 'inactive30d') return now - new Date(user.lastSeenAt).getTime() > 30 * 86_400_000;
        return true;
      });

      let sent = campaign.sent;
      let failed = campaign.failed;
      const rate = Math.max(1, Number(await job.getSetting<number>('ratePerSecond', 5)));
      for (const user of target) {
        const result = await job.api.sendMessage(user.chatId, {
          text: campaign.text,
          parseMode: 'HTML',
          disablePreview: true,
        });
        if (result.ok) sent += 1;
        else failed += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.ceil(1000 / rate)));
      }

      const nextOffset = campaign.offset + users.length;
      const done = users.length < pageSize;
      await job.storage.documents.update(job.bot.id, doc.id, {
        ...(doc.data as Record<string, unknown>),
        status: done ? 'done' : 'sending',
        sent,
        failed,
        offset: nextOffset,
      });
      if (!done) {
        await job.enqueue('campaign.send', { campaignId }, new Date(Date.now() + 1000));
      } else {
        await job.notifyAdmin(`کمپین «${campaign.title}» کامل شد. ارسال: ${sent} — ناموفق: ${failed}`);
      }
    },
  },
  async onCommand(ctx, command) {
    if (command === 'campaigns') {
      await renderCampaigns(ctx);
      return true;
    }
    if (command === 'newcampaign') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('campaign_title', {});
      await ctx.reply('عنوان کمپین را ارسال کنید:');
      return true;
    }
    if (command === 'preferences') {
      await renderPreferences(ctx);
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    const subscriber = await getSubscriber(ctx, ctx.user.id);
    if (!subscriber) {
      await saveDoc(ctx.storage, ctx.bot.id, SUBSCRIBERS, `sub_${ctx.user.id}`, {
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        topics: ['offers', 'news'],
        subscribed: true,
        updatedAt: new Date().toISOString(),
      } satisfies Record<string, unknown>);
    }
    await ctx.reply('<b>اطلاع‌رسانی</b>\n\nمی‌توانید موضوع‌های دریافتی را مدیریت کنید.', {
      inline: { rows: [[{ text: 'تنظیمات من', callbackData: 'a:preferences' }]] },
    });
  },
  onText: async (ctx) => {
    void parseNumberInput(ctx.text);
    await ctx.reply('برای مدیریت اطلاع‌رسانی از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'تنظیمات', callbackData: 'a:preferences' }]] },
    });
  },
});

export { AUDIENCE_LABELS, TOPICS as MARKETING_TOPICS };
