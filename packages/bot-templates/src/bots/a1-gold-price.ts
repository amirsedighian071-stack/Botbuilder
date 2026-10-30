import type { BotContext } from '@botforge/core';
import { defineBot, fa, parseNumberInput } from '../kit';

async function renderGold(ctx: BotContext): Promise<void> {
  if (!(await ctx.guardRate('gold', 6, 60_000))) {
    await ctx.reply('برای جلوگیری از محدودیت سرویس، هر دقیقه چند درخواست مجاز است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const price = await ctx.services.market.goldPrice();
  const toman = await ctx.services.market.currencyRates('USD', ['USD']).catch(() => ({} as Record<string, number>));
  const text = [
    '<b>قیمت طلا</b>',
    '',
    `انس جهانی: ${fa(price.ounceUsd.toFixed(2))} دلار`,
    `مثقال طلا: ${ctx.formatMoney(price.mesghal)}`,
    `گرم ۱۸ عیار: ${ctx.formatMoney(price.gram18)}`,
    `گرم ۲۴ عیار: ${ctx.formatMoney(price.gram24)}`,
    '',
    `منبع: ${price.source}`,
    `به‌روزرسانی: ${ctx.formatDateTime(price.updatedAt)}`,
    Object.keys(toman).length > 0 ? '' : '',
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.reply(text, {
    inline: {
      rows: [
        [
          { text: 'ارز', callbackData: 'a:currency' },
          { text: 'رمزارز', callbackData: 'a:crypto' },
        ],
        [{ text: 'به‌روزرسانی', callbackData: 'a:gold' }],
      ],
    },
  });
}

async function renderCurrency(ctx: BotContext): Promise<void> {
  if (!(await ctx.guardRate('currency', 6, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const symbols = await ctx.getSetting<string[]>('currencies', ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'CAD']);
  const rates = await ctx.services.market.currencyRates('USD', symbols);
  const toman = await ctx.services.market.currencyRates('USD', ['IRR']).catch(() => ({} as Record<string, number>));
  const rows = Object.entries(rates)
    .filter(([symbol]) => symbol !== 'USD')
    .map(([symbol, rate]) => {
      const usdToToman = toman.IRR ? toman.IRR / 10 : 0;
      const unitToman = usdToToman > 0 ? usdToToman / rate : 0;
      return `${symbol}: ${fa((1 / rate).toFixed(4))} دلار${unitToman > 0 ? ` | ${ctx.formatMoney(unitToman)}` : ''}`;
    });
  const text = [
    '<b>نرخ ارز</b>',
    '',
    ...rows,
    '',
    `نرخ رسمی دلار: ${toman.IRR ? ctx.formatMoney(toman.IRR / 10) : 'در دسترس نیست'}`,
    'نرخ‌های بازار آزاد ممکن است متفاوت باشد.',
  ].join('\n');
  await ctx.reply(text, {
    inline: {
      rows: [
        [
          { text: 'به‌روزرسانی', callbackData: 'a:currency' },
          { text: 'تبدیل ارز', callbackData: 'a:convert' },
        ],
      ],
    },
  });
}

async function renderCrypto(ctx: BotContext): Promise<void> {
  if (!(await ctx.guardRate('crypto', 6, 60_000))) {
    await ctx.reply('تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.');
    return;
  }
  await ctx.typing();
  const symbols = await ctx.getSetting<string[]>('crypto', ['BTC', 'ETH', 'TON', 'BNB']);
  const prices = await ctx.services.market.crypto(symbols);
  const lines = Object.entries(prices).map(([symbol, value]) => {
    const change = value.change24h;
    const direction = change >= 0 ? '+' : '';
    return `${symbol}: ${fa(value.usd.toLocaleString('en-US', { maximumFractionDigits: 2 }))} دلار (${direction}${fa(change.toFixed(2))}٪)`;
  });
  await ctx.reply(['<b>رمزارزها</b>', '', ...lines, '', 'منبع: CoinGecko'].join('\n'), {
    inline: { rows: [[{ text: 'به‌روزرسانی', callbackData: 'a:crypto' }]] },
  });
}

export const goldPriceBot = defineBot({
  id: 'gold-price',
  name: 'قیمت طلا و ارز',
  category: 'A',
  summary: 'قیمت لحظه‌ای طلا، ارز و رمزارز همراه با تبدیل سریع',
  description:
    'این ربات قیمت لحظه‌ای انس جهانی طلا، مثقال و گرم ۱۸ و ۲۴ عیار را به تومان محاسبه می‌کند، نرخ ارزهای پرکاربرد و رمزارزها را نمایش می‌دهد و امکان تبدیل ارز را فراهم می‌کند. نرخ تومان از بازار داخلی و نرخ جهانی از منابع عمومی خوانده می‌شود.',
  icon: 'coins',
  tags: ['finance', 'market'],
  commands: [
    { command: 'gold', description: 'قیمت طلا' },
    { command: 'currency', description: 'نرخ ارز' },
    { command: 'crypto', description: 'قیمت رمزارز' },
    { command: 'convert', description: 'تبدیل ارز' },
  ],
  menu: [
    { id: 'gold', label: 'طلا و سکه' },
    { id: 'currency', label: 'نرخ ارز' },
    { id: 'crypto', label: 'رمزارز' },
    { id: 'convert', label: 'تبدیل ارز' },
  ],
  requirements: [
    {
      key: 'GOLD_API_KEY',
      label: 'کلید سرویس طلا',
      description: 'اختیاری؛ در صورت نبود از منابع عمومی استفاده می‌شود.',
      required: false,
      env: 'GOLD_API_KEY',
    },
  ],
  defaultConfig: {
    currencies: ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'CAD'],
    crypto: ['BTC', 'ETH', 'TON', 'BNB'],
  },
  actions: {
    gold: async (ctx) => renderGold(ctx),
    currency: async (ctx) => renderCurrency(ctx),
    crypto: async (ctx) => renderCrypto(ctx),
    convert_to: async (ctx, param) => {
      await convertTo(ctx, param ?? 'USD');
    },
    convert: async (ctx) => {
      await ctx.ask(
        'مبلغ و ارز مبدأ را ارسال کنید. نمونه:\n<code>100 USD</code> یا <code>5000000 IRR</code>',
        'convert_amount',
      );
    },
  },
  steps: {
    convert_amount: async (ctx) => {
      const match = ctx.text.trim().match(/^([\d.,۰-۹]+)\s*([A-Za-z]{3})$/);
      const amount = match ? parseNumberInput(match[1]) : null;
      if (!match || amount === null) {
        await ctx.reply('قالب درست نیست. نمونه: <code>100 USD</code>');
        return;
      }
      const from = match[2].toUpperCase();
      await ctx.updateFlow({ amount, from });
      await ctx.reply('ارز مقصد را انتخاب کنید:', {
        inline: {
          rows: [
            [
              { text: 'تومان', callbackData: 'a:convert_to:IRT' },
              { text: 'دلار', callbackData: 'a:convert_to:USD' },
              { text: 'یورو', callbackData: 'a:convert_to:EUR' },
            ],
            [
              { text: 'درهم', callbackData: 'a:convert_to:AED' },
              { text: 'لیر', callbackData: 'a:convert_to:TRY' },
              { text: 'بیت‌کوین', callbackData: 'a:convert_to:BTC' },
            ],
            [{ text: 'انصراف', callbackData: 'a:__menu' }],
          ],
        },
      });
    },
  },
  onText: async (ctx) => {
    await ctx.reply('برای مشاهده قیمت‌ها از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'منوی قیمت‌ها', callbackData: 'a:__menu' }]] },
    });
  },
  async onStart(ctx) {
    await ctx.reply(
      '<b>قیمت طلا و ارز</b>\n\nقیمت لحظه‌ای طلا و ارز را از منوی زیر دریافت کنید. برای هشدار قیمت، ربات «هشدار قیمت» را فعال کنید.',
      { inline: { rows: [[{ text: 'شروع', callbackData: 'a:__menu' }]] } },
    );
  },
});

export async function convertTo(ctx: BotContext, target: string): Promise<void> {
  const amount = Number(ctx.flow?.data.amount ?? 0);
  const from = String(ctx.flow?.data.from ?? 'USD');
  if (!amount || !from) {
    await ctx.reply('ابتدا مبلغ و ارز مبدأ را ارسال کنید.');
    return;
  }
  await ctx.clearFlow();
  if (target === 'BTC') {
    const crypto = await ctx.services.market.crypto(['BTC']);
    const usd = await ctx.services.market.currencyRates('USD', [from]).catch(() => null);
    const usdRate = from === 'USD' ? 1 : usd?.[from];
    if (!usdRate || !crypto.BTC) {
      await ctx.reply('تبدیل به بیت‌کوین در دسترس نیست.');
      return;
    }
    const btc = (amount / usdRate) / crypto.BTC.usd;
    await ctx.reply(`${ctx.formatNumber(amount, 2)} ${from} = ${btc.toFixed(8)} BTC`);
    return;
  }
  if (target === 'IRT') {
    const toman = await ctx.services.market.currencyRates('USD', ['IRR']);
    const usd = await ctx.services.market.currencyRates('USD', [from]);
    const usdRate = from === 'USD' ? 1 : usd[from];
    if (!usdRate || !toman.IRR) {
      await ctx.reply('نرخ تبدیل در دسترس نیست.');
      return;
    }
    const value = (amount / usdRate) * (toman.IRR / 10);
    await ctx.reply(`${ctx.formatNumber(amount, 2)} ${from} = ${ctx.formatMoney(value)}`);
    return;
  }
  const rates = await ctx.services.market.currencyRates('USD', [from, target]);
  const fromRate = from === 'USD' ? 1 : rates[from];
  const toRate = target === 'USD' ? 1 : rates[target];
  if (!fromRate || !toRate) {
    await ctx.reply('نرخ تبدیل برای این ارزها در دسترس نیست.');
    return;
  }
  const value = (amount / fromRate) * toRate;
  await ctx.reply(`${ctx.formatNumber(amount, 2)} ${from} = ${ctx.formatNumber(value, 2)} ${target}`);
}
