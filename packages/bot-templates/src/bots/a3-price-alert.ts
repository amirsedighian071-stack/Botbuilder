import { randomId, type BotContext, type BotServices } from '@botforge/core';
import { defineBot, deleteDoc, getDoc, listDocs, parseNumberInput, saveDoc } from '../kit';

interface PriceAlert {
  id: string;
  ownerId: string;
  chatId: string;
  asset: 'gold18' | 'gold24' | 'ounce' | 'usdt' | 'btc' | 'eth' | 'ton' | 'USD' | 'EUR';
  direction: 'above' | 'below';
  threshold: number;
  createdAt: string;
  triggeredAt: string | null;
  lastValue: number | null;
  active: boolean;
}

export const PRICE_ALERT_ASSETS: Array<{ id: PriceAlert['asset']; label: string; unit: string }> = [
  { id: 'gold18', label: 'گرم طلای ۱۸ عیار', unit: 'تومان' },
  { id: 'gold24', label: 'گرم طلای ۲۴ عیار', unit: 'تومان' },
  { id: 'ounce', label: 'انس جهانی طلا', unit: 'دلار' },
  { id: 'usdt', label: 'تتر', unit: 'تومان' },
  { id: 'btc', label: 'بیت‌کوین', unit: 'دلار' },
  { id: 'eth', label: 'اتریوم', unit: 'دلار' },
  { id: 'ton', label: 'تون', unit: 'دلار' },
  { id: 'USD', label: 'دلار آمریکا', unit: 'تومان' },
  { id: 'EUR', label: 'یورو', unit: 'تومان' },
];

const alertKey = (id: string) => `alert_${id}`;

export async function priceFor(services: BotServices, asset: PriceAlert['asset']): Promise<number | null> {
  try {
    if (asset === 'gold18' || asset === 'gold24' || asset === 'ounce') {
      const gold = await services.market.goldPrice();
      if (asset === 'gold18') return gold.gram18;
      if (asset === 'gold24') return gold.gram24;
      return gold.ounceUsd;
    }
    if (asset === 'usdt') {
      const rates = await services.market.currencyRates('USD', ['IRR']);
      return rates.IRR ? rates.IRR / 10 : null;
    }
    if (asset === 'btc' || asset === 'eth' || asset === 'ton') {
      const crypto = await services.market.crypto([asset.toUpperCase()]);
      return crypto[asset.toUpperCase()]?.usd ?? null;
    }
    const rates = await services.market.currencyRates('USD', [asset, 'IRR']);
    if (!rates[asset] || !rates.IRR) return null;
    return rates.IRR / 10 / rates[asset];
  } catch {
    return null;
  }
}

async function ownAlerts(ctx: BotContext): Promise<PriceAlert[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, 'alerts', 1, 200);
  return result.items
    .map((item) => item.data as unknown as PriceAlert)
    .filter((alert) => alert.ownerId === ctx.user.id);
}

async function renderAlerts(ctx: BotContext): Promise<void> {
  const alerts = await ownAlerts(ctx);
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  if (alerts.length === 0) {
    await ctx.reply('هنوز هشداری ثبت نکرده‌اید.', {
      inline: { rows: [[{ text: 'افزودن هشدار', callbackData: 'a:add' }]] },
    });
    return;
  }
  const lines = ['<b>هشدارهای قیمت شما</b>', ''];
  alerts.forEach((alert, index) => {
    const asset = PRICE_ALERT_ASSETS.find((item) => item.id === alert.asset);
    const direction = alert.direction === 'above' ? 'بالاتر یا مساوی' : 'پایین‌تر یا مساوی';
    const state = alert.triggeredAt ? 'اجراشده' : alert.active ? 'فعال' : 'غیرفعال';
    lines.push(
      `${index + 1}. ${asset?.label ?? alert.asset} — ${direction} ${ctx.formatNumber(alert.threshold, 2)} ${asset?.unit ?? ''} (${state})`,
    );
    rows.push([
      { text: `حذف ${index + 1}`, callbackData: `a:del:${alert.id}` },
      { text: `وضعیت ${index + 1}`, callbackData: `a:toggle:${alert.id}` },
    ]);
  });
  rows.push([{ text: 'افزودن هشدار', callbackData: 'a:add' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const priceAlertBot = defineBot({
  id: 'price-alert',
  name: 'هشدار قیمت',
  category: 'A',
  summary: 'هشدار خودکار وقتی طلا، تتر، دلار یا رمزارز به قیمت هدف می‌رسد',
  description:
    'کاربران برای طلا (گرم ۱۸ و ۲۴ عیار و انس)، تتر، دلار، یورو و رمزارزها آستانه قیمت تعیین می‌کنند. زمان‌بند موتور مرکزی هر دقیقه قیمت‌ها را می‌خواند، شرط‌ها را ارزیابی می‌کند و در صورت رسیدن به آستانه، پیام هشدار برای همان کاربر ارسال می‌کند. هر هشدار پس از اجرا علامت‌گذاری می‌شود و دیگر تکرار نمی‌شود.',
  icon: 'bell',
  tags: ['finance', 'automation'],
  commands: [
    { command: 'alerts', description: 'فهرست هشدارها' },
    { command: 'addalert', description: 'افزودن هشدار جدید' },
  ],
  menu: [
    { id: 'list', label: 'هشدارهای من' },
    { id: 'add', label: 'افزودن هشدار' },
  ],
  defaultConfig: { checkIntervalSeconds: 60 },
  actions: {
    list: async (ctx) => renderAlerts(ctx),
    add: async (ctx) => {
      const rows = PRICE_ALERT_ASSETS.map((asset) => [{ text: asset.label, callbackData: `a:asset:${asset.id}` }]);
      rows.push([{ text: 'انصراف', callbackData: 'a:list' }]);
      await ctx.setFlow('alert_asset', {});
      await ctx.reply('دارایی مورد نظر را انتخاب کنید:', { inline: { rows } });
    },
    asset: async (ctx, param) => {
      if (!param) return;
      const asset = PRICE_ALERT_ASSETS.find((item) => item.id === param);
      if (!asset) {
        await ctx.reply('دارایی نامعتبر است.');
        return;
      }
      await ctx.setFlow('alert_threshold', { asset: param });
      await ctx.reply(
        `آستانه قیمت برای ${asset.label} را به ${asset.unit} وارد کنید.\nنمونه: <code>${param === 'btc' ? '65000' : '4200000'}</code>`,
      );
    },
    dir: async (ctx, param) => {
      const data = ctx.flow?.data ?? {};
      const threshold = Number(data.threshold ?? 0);
      const asset = String(data.asset ?? '') as PriceAlert['asset'];
      const direction = param === 'below' ? 'below' : 'above';
      if (!threshold || !asset) {
        await ctx.reply('اطلاعات هشدار ناقص است. دوباره تلاش کنید.', {
          inline: { rows: [[{ text: 'افزودن هشدار', callbackData: 'a:add' }]] },
        });
        await ctx.clearFlow();
        return;
      }
      const id = randomId('al_').slice(3, 11);
      const alert: PriceAlert = {
        id,
        ownerId: ctx.user.id,
        chatId: ctx.message.chatId,
        asset,
        direction,
        threshold,
        createdAt: new Date().toISOString(),
        triggeredAt: null,
        lastValue: null,
        active: true,
      };
      await saveDoc(ctx.storage, ctx.bot.id, 'alerts', alertKey(id), alert as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      const label = PRICE_ALERT_ASSETS.find((item) => item.id === asset);
      await ctx.reply(
        `هشدار ثبت شد.\n\n${label?.label ?? asset} ${direction === 'above' ? 'بالاتر یا مساوی' : 'پایین‌تر یا مساوی'} ${ctx.formatNumber(threshold, 2)} ${label?.unit ?? ''}\n\nبررسی هر دقیقه انجام می‌شود.`,
        { inline: { rows: [[{ text: 'هشدارهای من', callbackData: 'a:list' }]] } },
      );
      await ctx.enqueue('alerts.evaluate', {}, new Date(Date.now() + 15_000));
    },
    del: async (ctx, param) => {
      if (param) {
        const doc = await getDoc(ctx.storage, ctx.bot.id, 'alerts', alertKey(param));
        if (doc && (doc.data as unknown as PriceAlert).ownerId === ctx.user.id) {
          await deleteDoc(ctx.storage, ctx.bot.id, 'alerts', alertKey(param));
        }
      }
      await renderAlerts(ctx);
    },
    toggle: async (ctx, param) => {
      if (param) {
        const doc = await getDoc(ctx.storage, ctx.bot.id, 'alerts', alertKey(param));
        if (doc) {
          const alert = doc.data as unknown as PriceAlert;
          if (alert.ownerId === ctx.user.id) {
            await saveDoc(ctx.storage, ctx.bot.id, 'alerts', alertKey(param), {
              ...(doc.data as Record<string, unknown>),
              active: !alert.active,
              triggeredAt: null,
            });
          }
        }
      }
      await renderAlerts(ctx);
    },
  },
  steps: {
    alert_threshold: async (ctx) => {
      const value = parseNumberInput(ctx.text);
      if (value === null || value <= 0) {
        await ctx.reply('عدد معتبر وارد کنید. نمونه: <code>4200000</code>');
        return;
      }
      await ctx.setFlow('alert_direction', { ...(ctx.flow?.data ?? {}), threshold: value });
      await ctx.reply('شرط هشدار را انتخاب کنید:', {
        inline: {
          rows: [
            [
              { text: 'بالاتر یا مساوی', callbackData: 'a:dir:above' },
              { text: 'پایین‌تر یا مساوی', callbackData: 'a:dir:below' },
            ],
            [{ text: 'انصراف', callbackData: 'a:list' }],
          ],
        },
      });
    },
  },
  jobs: {
    'alerts.evaluate': async (job) => {
      const result = await job.storage.documents.list(job.bot.id, 'alerts', { pageSize: 200 });
      const alerts = result.items
        .map((item) => item.data as unknown as PriceAlert)
        .filter((alert) => alert.active && !alert.triggeredAt);
      const cache = new Map<string, number | null>();
      for (const alert of alerts) {
        let value = cache.get(alert.asset);
        if (value === undefined) {
          value = await priceFor(job.services, alert.asset);
          cache.set(alert.asset, value);
        }
        if (value === null) continue;
        const hit = alert.direction === 'above' ? value >= alert.threshold : value <= alert.threshold;
        if (!hit) continue;
        const asset = PRICE_ALERT_ASSETS.find((item) => item.id === alert.asset);
        try {
          await job.send(
            alert.chatId,
            `<b>هشدار قیمت</b>\n\n${asset?.label ?? alert.asset} به ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${asset?.unit ?? ''} رسید.\nآستانه شما: ${alert.threshold.toLocaleString('en-US')}`,
            { rows: [[{ text: 'مدیریت هشدارها', callbackData: 'a:list' }]] },
          );
        } catch (error) {
          job.logger.warn('alert notify failed', { alertId: alert.id, error: (error as Error).message });
        }
        await saveDoc(job.storage, job.bot.id, 'alerts', alertKey(alert.id), {
          ...(alert as unknown as Record<string, unknown>),
          triggeredAt: new Date().toISOString(),
          lastValue: value,
          active: false,
        });
      }
      const pending = await job.storage.documents.list(job.bot.id, 'alerts', { pageSize: 200 });
      const stillActive = pending.items.some((item) => {
        const alert = item.data as unknown as PriceAlert;
        return alert.active && !alert.triggeredAt;
      });
      if (stillActive) {
        await job.enqueue('alerts.evaluate', {}, new Date(Date.now() + 60_000));
      }
    },
  },
  async onStart(ctx) {
    await ctx.reply(
      '<b>هشدار قیمت</b>\n\nبا تعیین آستانه، به‌محض رسیدن قیمت به هدف پیام دریافت می‌کنید.',
      {
        inline: {
          rows: [
            [{ text: 'افزودن هشدار', callbackData: 'a:add' }],
            [{ text: 'هشدارهای من', callbackData: 'a:list' }],
          ],
        },
      },
    );
  },
  onText: async (ctx) => {
    await ctx.reply('برای مدیریت هشدارها از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'هشدارهای من', callbackData: 'a:list' }]] },
    });
  },
});
