import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  formatDuration,
  getDoc,
  listDocs,
  parseDuration,
  requireAdmin,
  saveDoc,
  truncateText,
} from '../kit';

interface Monitor {
  id: string;
  userId: string;
  chatId: string;
  url: string;
  label: string;
  intervalMs: number;
  active: boolean;
  lastStatus: 'up' | 'down' | 'unknown';
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  failures: number;
  checks: number;
  upCount: number;
  downCount: number;
  createdAt: string;
}

const MONITORS = 'monitors';
const key = (id: string) => `mon_${id}`;

async function ownMonitors(ctx: BotContext): Promise<Array<{ key: string; monitor: Monitor }>> {
  const result = await listDocs(ctx.storage, ctx.bot.id, MONITORS, 1, 200);
  return result.items
    .map((item) => ({ key: item.key, monitor: item.data as unknown as Monitor }))
    .filter((entry) => ctx.isAdmin || entry.monitor.userId === ctx.user.id);
}

async function renderList(ctx: BotContext): Promise<void> {
  const entries = await ownMonitors(ctx);
  if (entries.length === 0) {
    await ctx.reply('مانیتوری ثبت نشده است.', {
      inline: { rows: [[{ text: 'افزودن مانیتور', callbackData: 'a:add' }]] },
    });
    return;
  }
  const lines = ['<b>پایش سایت‌ها</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const entry of entries) {
    const monitor = entry.monitor;
    const status = monitor.lastStatus === 'up' ? 'سالم' : monitor.lastStatus === 'down' ? 'قطع' : 'بررسی‌نشده';
    lines.push(
      `<b>${ctx.escape(truncateText(monitor.label || monitor.url, 40))}</b>\n` +
        `وضعیت: ${status} | پاسخ: ${monitor.lastLatencyMs ? `${fa(monitor.lastLatencyMs)} میلی‌ثانیه` : '—'}\n` +
        `بررسی‌ها: ${fa(monitor.checks)} | قطعی: ${fa(monitor.downCount)} | فاصله: ${formatDuration(Math.round(monitor.intervalMs / 1000))}`,
    );
    rows.push([{ text: truncateText(monitor.label || monitor.url, 20), callbackData: `a:monitor:${monitor.id}` }]);
  }
  rows.push([{ text: 'افزودن مانیتور', callbackData: 'a:add' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderMonitor(ctx: BotContext, id: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, MONITORS, key(id));
  if (!doc) {
    await ctx.reply('مانیتور پیدا نشد.');
    return;
  }
  const monitor = doc.data as unknown as Monitor;
  if (!ctx.isAdmin && monitor.userId !== ctx.user.id) {
    await ctx.reply('این مانیتور متعلق به شما نیست.');
    return;
  }
  const uptime = monitor.checks > 0 ? Math.round((monitor.upCount / monitor.checks) * 100) : 0;
  const lines = [
    `<b>${ctx.escape(monitor.label || monitor.url)}</b>`,
    '',
    `<code>${ctx.escape(monitor.url)}</code>`,
    `وضعیت فعلی: ${monitor.lastStatus === 'up' ? 'سالم' : monitor.lastStatus === 'down' ? 'قطع' : 'نامشخص'}`,
    `آخرین بررسی: ${monitor.lastCheckAt ? ctx.formatDateTime(monitor.lastCheckAt) : '—'}`,
    `زمان پاسخ: ${monitor.lastLatencyMs ? `${fa(monitor.lastLatencyMs)} میلی‌ثانیه` : '—'}`,
    `دسترس‌پذیری: ${fa(uptime)}٪`,
    `بررسی‌ها: ${fa(monitor.checks)} | قطعی: ${fa(monitor.downCount)}`,
    `بازه بررسی: ${formatDuration(Math.round(monitor.intervalMs / 1000))}`,
    monitor.active ? '' : '\n<i>پایش متوقف است.</i>',
  ].filter(Boolean);
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [{ text: 'بررسی فوری', callbackData: `a:check:${monitor.id}` }],
        [
          { text: monitor.active ? 'توقف پایش' : 'شروع پایش', callbackData: `a:toggle:${monitor.id}` },
          { text: 'حذف', callbackData: `a:del:${monitor.id}` },
        ],
        [{ text: 'بازگشت', callbackData: 'a:list' }],
      ],
    },
  });
}

export const webMonitorBot = defineBot({
  id: 'web-monitor',
  name: 'پایش وب‌سایت و سرویس',
  category: 'E',
  summary: 'بررسی دوره‌ای سایت با هشدار قطعی و گزارش دسترس‌پذیری',
  description:
    'آدرس سایت را ثبت می‌کند و در بازه تعیین‌شده درخواست HTTP ارسال می‌کند. زمان پاسخ، کد وضعیت و دسترس‌پذیری محاسبه می‌شود. در صورت قطع شدن یا بازگشت سرویس، پیام هشدار برای کاربر ارسال می‌گردد. محافظت SSRF و محدودیت زمان پاسخ اعمال می‌شود.',
  icon: 'activity',
  tags: ['monitoring', 'automation'],
  commands: [
    { command: 'monitors', description: 'فهرست مانیتورها' },
    { command: 'addmonitor', description: 'افزودن پایش' },
    { command: 'check', description: 'بررسی فوری آدرس' },
  ],
  menu: [
    { id: 'list', label: 'مانیتورهای من' },
    { id: 'add', label: 'افزودن پایش' },
    { id: 'quick', label: 'بررسی فوری' },
  ],
  defaultConfig: { defaultIntervalMs: 300_000, timeoutMs: 15_000 },
  actions: {
    list: async (ctx) => renderList(ctx),
    monitor: async (ctx, param) => {
      if (param) await renderMonitor(ctx, param);
    },
    add: async (ctx) => {
      await ctx.setFlow('monitor_url', {});
      await ctx.reply('آدرس سایت را ارسال کنید. نمونه: <code>https://example.com</code>');
    },
    quick: async (ctx) => {
      await ctx.ask('آدرس مورد بررسی را ارسال کنید:', 'monitor_quick');
    },
    check: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, MONITORS, key(param ?? ''));
      if (!doc) return;
      const monitor = doc.data as unknown as Monitor;
      await ctx.typing();
      const result = await ctx.services.webwatch.check(monitor.url);
      await ctx.reply(
        `نتیجه بررسی:\nوضعیت: ${result.ok ? 'سالم' : 'قطع'}${result.status ? ` (HTTP ${fa(result.status)})` : ''}\n` +
          `زمان پاسخ: ${fa(result.latencyMs)} میلی‌ثانیه` +
          (result.error ? `\nخطا: ${ctx.escape(result.error)}` : ''),
      );
      await updateMonitor(ctx, monitor, result.ok, result.latencyMs);
    },
    toggle: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, MONITORS, key(param ?? ''));
      if (!doc) return;
      const monitor = doc.data as unknown as Monitor;
      const active = !monitor.active;
      await saveDoc(ctx.storage, ctx.bot.id, MONITORS, key(monitor.id), {
        ...(doc.data as Record<string, unknown>),
        active,
      });
      await ctx.reply(active ? 'پایش فعال شد.' : 'پایش متوقف شد.');
      if (active) await ctx.enqueue('web.monitor', { monitorId: monitor.id }, new Date(Date.now() + 5000));
      await renderMonitor(ctx, monitor.id);
    },
    del: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, MONITORS, key(param ?? ''));
      if (!doc) return;
      const monitor = doc.data as unknown as Monitor;
      if (!ctx.isAdmin && monitor.userId !== ctx.user.id) return;
      await ctx.storage.documents.deleteByKey(ctx.bot.id, MONITORS, key(monitor.id));
      await ctx.reply('مانیتور حذف شد.');
      await renderList(ctx);
    },
  },
  steps: {
    monitor_url: async (ctx) => {
      const url = ctx.text.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) {
        await ctx.reply('آدرس معتبر با http یا https ارسال کنید.');
        return;
      }
      await ctx.setFlow('monitor_label', { url });
      await ctx.reply('یک نام کوتاه برای این پایش وارد کنید (یا «-»):');
    },
    monitor_label: async (ctx) => {
      const label = ctx.text.trim() === '-' ? '' : ctx.text.trim().slice(0, 60);
      await ctx.setFlow('monitor_interval', { ...(ctx.flow?.data ?? {}), label });
      await ctx.reply('بازه بررسی را ارسال کنید. نمونه: <code>5m</code> (۵ دقیقه) یا <code>1h</code>');
    },
    monitor_interval: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const interval = parseDuration(ctx.text) ?? 300_000;
      if (interval < 60_000) {
        await ctx.reply('حداقل بازه بررسی یک دقیقه است.');
        return;
      }
      const id = Date.now().toString(36);
      const monitor: Monitor = {
        id,
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        url: String(data.url ?? ''),
        label: String(data.label ?? ''),
        intervalMs: interval,
        active: true,
        lastStatus: 'unknown',
        lastCheckAt: null,
        lastLatencyMs: null,
        failures: 0,
        checks: 0,
        upCount: 0,
        downCount: 0,
        createdAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, MONITORS, key(id), monitor as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply('پایش ثبت شد. اولین بررسی انجام می‌شود...');
      await ctx.enqueue('web.monitor', { monitorId: id }, new Date(Date.now() + 3000));
      await renderMonitor(ctx, id);
    },
    monitor_quick: async (ctx) => {
      const url = ctx.text.trim();
      await ctx.clearFlow();
      if (!/^https?:\/\/\S+$/i.test(url)) {
        await ctx.reply('آدرس معتبر ارسال کنید.');
        return;
      }
      await ctx.typing();
      const result = await ctx.services.webwatch.check(url);
      await ctx.reply(
        `<b>بررسی ${ctx.escape(truncateText(url, 60))}</b>\n\n` +
          `وضعیت: ${result.ok ? 'سالم' : 'قطع'}${result.status ? ` (HTTP ${fa(result.status)})` : ''}\n` +
          `زمان پاسخ: ${fa(result.latencyMs)} میلی‌ثانیه` +
          (result.error ? `\nخطا: ${ctx.escape(result.error)}` : ''),
      );
    },
  },
  jobs: {
    'web.monitor': async (job) => {
      const id = String(job.payload.monitorId ?? '');
      if (!id) return;
      const doc = await job.storage.documents.findByKey(job.bot.id, MONITORS, key(id));
      if (!doc) return;
      const monitor = doc.data as unknown as Monitor;
      if (!monitor.active) return;
      const result = await job.services.webwatch.check(monitor.url);
      const wasUp = monitor.lastStatus === 'up';
      const isUp = result.ok;
      const updated: Monitor = {
        ...monitor,
        lastStatus: isUp ? 'up' : 'down',
        lastCheckAt: new Date().toISOString(),
        lastLatencyMs: result.latencyMs,
        failures: isUp ? 0 : monitor.failures + 1,
        checks: monitor.checks + 1,
        upCount: monitor.upCount + (isUp ? 1 : 0),
        downCount: monitor.downCount + (isUp ? 0 : 1),
      };
      await job.storage.documents.update(job.bot.id, doc.id, updated as unknown as Record<string, unknown>);

      if (!isUp && (wasUp || monitor.lastStatus === 'unknown')) {
        await job.send(
          monitor.chatId,
          `<b>هشدار قطعی سرویس</b>\n\n${monitor.label || monitor.url}\n<code>${monitor.url}</code>\n` +
            `وضعیت: قطع${result.status ? ` (HTTP ${result.status})` : ''}\n${result.error ? `خطا: ${result.error}` : ''}`,
          { rows: [[{ text: 'جزئیات', callbackData: `a:monitor:${monitor.id}` }]] },
        );
      } else if (isUp && monitor.lastStatus === 'down') {
        await job.send(
          monitor.chatId,
          `<b>بازگشت سرویس</b>\n\n${monitor.label || monitor.url} دوباره در دسترس است.\nزمان پاسخ: ${result.latencyMs} میلی‌ثانیه`,
          { rows: [[{ text: 'جزئیات', callbackData: `a:monitor:${monitor.id}` }]] },
        );
      }
      await job.enqueue('web.monitor', { monitorId: id }, new Date(Date.now() + monitor.intervalMs));
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>پایش سایت</b>\n\nسایت خود را اضافه کنید تا از قطعی آن باخبر شوید.', {
      inline: {
        rows: [
          [{ text: 'افزودن پایش', callbackData: 'a:add' }],
          [
            { text: 'مانیتورها', callbackData: 'a:list' },
            { text: 'بررسی فوری', callbackData: 'a:quick' },
          ],
        ],
      },
    });
  },
  onText: async (ctx) => {
    const url = ctx.text.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      await ctx.typing();
      const result = await ctx.services.webwatch.check(url);
      await ctx.reply(
        `وضعیت: ${result.ok ? 'سالم' : 'قطع'}${result.status ? ` (HTTP ${fa(result.status)})` : ''}\nزمان پاسخ: ${fa(result.latencyMs)} میلی‌ثانیه`,
        { inline: { rows: [[{ text: 'افزودن این آدرس به پایش', callbackData: 'a:add' }]] } },
      );
      return;
    }
    await ctx.reply('آدرس سایت را ارسال کنید یا از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'مانیتورها', callbackData: 'a:list' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'monitors') {
      await renderList(ctx);
      return true;
    }
    if (command === 'addmonitor') {
      await ctx.setFlow('monitor_url', {});
      await ctx.reply('آدرس سایت را ارسال کنید:');
      return true;
    }
    if (command === 'check') {
      const url = ctx.params[0];
      if (url) {
        const result = await ctx.services.webwatch.check(url);
        await ctx.reply(
          `وضعیت: ${result.ok ? 'سالم' : 'قطع'}${result.status ? ` (HTTP ${fa(result.status)})` : ''}\nزمان پاسخ: ${fa(result.latencyMs)} میلی‌ثانیه`,
        );
        return true;
      }
      await ctx.ask('آدرس مورد بررسی را ارسال کنید:', 'monitor_quick');
      return true;
    }
    return false;
  },
});

async function updateMonitor(
  ctx: BotContext,
  monitor: Monitor,
  ok: boolean,
  latencyMs: number,
): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, MONITORS, key(monitor.id));
  if (!doc) return;
  await saveDoc(ctx.storage, ctx.bot.id, MONITORS, key(monitor.id), {
    ...(doc.data as Record<string, unknown>),
    lastStatus: ok ? 'up' : 'down',
    lastCheckAt: new Date().toISOString(),
    lastLatencyMs: latencyMs,
    checks: monitor.checks + 1,
    upCount: monitor.upCount + (ok ? 1 : 0),
    downCount: monitor.downCount + (ok ? 0 : 1),
  });
}

export type { Monitor };
export { renderList as renderMonitorList };
export { chunkButtons as monitorChunkButtons, requireAdmin as monitorRequireAdmin };
