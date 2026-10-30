import type { BotContext } from '@botforge/core';
import { defineBot, fa } from '../kit';

function weatherAdvice(code: number): string {
  if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code)) return 'چتر همراه داشته باشید.';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'احتمال بارش برف؛ لباس گرم بپوشید.';
  if ([45, 48].includes(code)) return 'دید افقی پایین است؛ در رانندگی احتیاط کنید.';
  if ([0, 1].includes(code)) return 'هوای مناسبی برای فعالیت در فضای باز است.';
  return 'وضعیت جوی متغیر است.';
}

async function sendCurrent(ctx: BotContext, city: string): Promise<void> {
  if (!(await ctx.guardRate('weather', 6, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const current = await ctx.services.weather.current(city);
  const lines = [
    `<b>هوای ${ctx.escape(current.city)}</b>`,
    '',
    `دما: ${fa(current.temperature.toFixed(1))} درجه`,
    `احساس واقعی: ${fa(current.apparent.toFixed(1))} درجه`,
    `وضعیت: ${current.description}`,
    `رطوبت: ${fa(current.humidity)}٪`,
    `سرعت باد: ${fa(current.windSpeed.toFixed(1))} کیلومتر بر ساعت`,
    '',
    weatherAdvice(current.code),
  ];
  await ctx.reply(lines.join('\n'), {
    inline: {
      rows: [
        [
          { text: 'پیش‌بینی ۳ روز', callbackData: `a:forecast:${city}` },
          { text: 'تغییر شهر', callbackData: 'a:city' },
        ],
      ],
    },
  });
}

async function sendForecast(ctx: BotContext, city: string): Promise<void> {
  await ctx.typing();
  const days = await ctx.services.weather.forecast(city, 5);
  const lines = [`<b>پیش‌بینی هوای ${ctx.escape(city)}</b>`, ''];
  for (const day of days) {
    lines.push(
      `${ctx.formatDate(day.date)} — ${day.description}\nحداقل ${fa(day.min.toFixed(0))}° / حداکثر ${fa(day.max.toFixed(0))}° | بارش ${fa(day.precipitation)}٪`,
    );
  }
  await ctx.reply(lines.join('\n'), {
    inline: { rows: [[{ text: 'هوای فعلی', callbackData: `a:now:${city}` }, { text: 'منو', callbackData: 'a:__menu' }]] },
  });
}

export const weatherBot = defineBot({
  id: 'weather',
  name: 'آب‌وهوا',
  category: 'A',
  summary: 'هوای فعلی و پیش‌بینی چندروزه هر شهر با توصیه‌های کاربردی',
  description:
    'دمای فعلی، دمای محسوس، رطوبت، باد و پیش‌بینی چندروزه را برای هر شهر نمایش می‌دهد. داده‌ها از سرویس Open-Meteo خوانده می‌شود و شهر پیش‌فرض کاربر ذخیره می‌شود. پشتیبانی از نام فارسی شهرهای پرکاربرد به‌صورت داخلی انجام می‌شود.',
  icon: 'cloud-sun',
  tags: ['utility'],
  commands: [
    { command: 'weather', description: 'هوای شهر پیش‌فرض' },
    { command: 'forecast', description: 'پیش‌بینی چندروزه' },
  ],
  menu: [
    { id: 'now', label: 'هوای فعلی' },
    { id: 'forecast', label: 'پیش‌بینی' },
    { id: 'city', label: 'تعیین شهر پیش‌فرض' },
  ],
  defaultConfig: { defaultCity: 'تهران' },
  actions: {
    now: async (ctx, param) => {
      const city = param || (await ctx.getSetting<string>('defaultCity', 'تهران'));
      if (!param) {
        await ctx.ask('نام شهر را ارسال کنید یا دکمه شهر پیش‌فرض را بزنید.', 'city_input');
        return;
      }
      await sendCurrent(ctx, city);
    },
    forecast: async (ctx, param) => {
      const city = param || (await ctx.getSetting<string>('defaultCity', 'تهران'));
      if (!param) {
        await ctx.ask('نام شهر را برای پیش‌بینی ارسال کنید.', 'forecast_city');
        return;
      }
      await sendForecast(ctx, city);
    },
    city: async (ctx) => {
      await ctx.ask('نام شهر پیش‌فرض را ارسال کنید. نمونه: تهران، مشهد، آمستردام', 'set_city');
    },
  },
  steps: {
    city_input: async (ctx) => {
      const city = ctx.text.trim();
      await ctx.clearFlow();
      await sendCurrent(ctx, city);
    },
    forecast_city: async (ctx) => {
      const city = ctx.text.trim();
      await ctx.clearFlow();
      await sendForecast(ctx, city);
    },
    set_city: async (ctx) => {
      const city = ctx.text.trim();
      if (city.length < 2) {
        await ctx.reply('نام شهر معتبر نیست.');
        return;
      }
      const current = await ctx.services.weather.current(city);
      await ctx.setSetting('defaultCity', city);
      await ctx.clearFlow();
      await ctx.reply(`شهر پیش‌فرض شما «${current.city}» ثبت شد.`, {
        inline: { rows: [[{ text: 'هوای فعلی', callbackData: 'a:now' }]] },
      });
    },
  },
  async onCommand(ctx, command) {
    if (command === 'weather') {
      await sendCurrent(ctx, await ctx.getSetting<string>('defaultCity', 'تهران'));
      return true;
    }
    if (command === 'forecast') {
      await sendForecast(ctx, await ctx.getSetting<string>('defaultCity', 'تهران'));
      return true;
    }
    return false;
  },
  onText: async (ctx) => {
    await sendCurrent(ctx, ctx.text.trim());
  },
  async onStart(ctx) {
    const city = await ctx.getSetting<string>('defaultCity', 'تهران');
    await ctx.reply(
      `<b>آب‌وهوا</b>\n\nشهر پیش‌فرض شما: ${ctx.escape(city)}\nنام هر شهری را بنویسید تا هوای آن را ببینید.`,
      {
        inline: {
          rows: [
            [
              { text: 'هوای فعلی', callbackData: 'a:now' },
              { text: 'پیش‌بینی', callbackData: 'a:forecast' },
            ],
            [{ text: 'تغییر شهر پیش‌فرض', callbackData: 'a:city' }],
          ],
        },
      },
    );
  },
});
