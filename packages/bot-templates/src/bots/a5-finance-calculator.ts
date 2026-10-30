import type { BotContext } from '@botforge/core';
import { defineBot, fa, parseNumberInput } from '../kit';

function installment(amount: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return amount / months;
  return (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

function futureValue(principal: number, annualRate: number, months: number, monthlyDeposit = 0): number {
  const monthlyRate = annualRate / 100 / 12;
  let total = principal;
  for (let index = 0; index < months; index += 1) {
    total = total * (1 + monthlyRate) + monthlyDeposit;
  }
  return total;
}

async function askNumbers(ctx: BotContext, state: string, prompt: string, fields: string[]): Promise<void> {
  await ctx.setFlow(state, { fields });
  await ctx.reply(prompt);
}

export const financeCalculatorBot = defineBot({
  id: 'finance-calculator',
  name: 'محاسبه‌گر مالی',
  category: 'A',
  summary: 'محاسبه اقساط وام، سود سپرده، سود فروش، مالیات و تخفیف',
  description:
    'ابزارهای مالی پرکاربرد: محاسبه قسط ماهانه وام با نرخ سود، ارزش آینده سپرده، درصد سود یا زیان معامله، مالیات بر ارزش افزوده و تخفیف. همه محاسبات به‌صورت شفاف با فرمول نمایش داده می‌شوند.',
  icon: 'calculator',
  tags: ['finance', 'utility'],
  commands: [
    { command: 'loan', description: 'محاسبه قسط وام' },
    { command: 'saving', description: 'سود سپرده' },
    { command: 'profit', description: 'درصد سود معامله' },
    { command: 'vat', description: 'مالیات ارزش افزوده' },
  ],
  menu: [
    { id: 'loan', label: 'قسط وام' },
    { id: 'saving', label: 'سود سپرده' },
    { id: 'profit', label: 'سود معامله' },
    { id: 'vat', label: 'مالیات و تخفیف' },
  ],
  defaultConfig: { vatRate: 10 },
  actions: {
    loan: async (ctx) =>
      askNumbers(ctx, 'calc_loan', 'مبلغ وام، نرخ سود سالانه و تعداد ماه را با فاصله ارسال کنید.\nنمونه: <code>200000000 24 36</code>', [
        'amount',
        'rate',
        'months',
      ]),
    saving: async (ctx) =>
      askNumbers(
        ctx,
        'calc_saving',
        'مبلغ سپرده، نرخ سود سالانه، تعداد ماه و واریز ماهانه (اختیاری) را ارسال کنید.\nنمونه: <code>50000000 20 12 2000000</code>',
        ['amount', 'rate', 'months', 'deposit'],
      ),
    profit: async (ctx) =>
      askNumbers(ctx, 'calc_profit', 'قیمت خرید و قیمت فروش را ارسال کنید.\nنمونه: <code>1200000 1450000</code>', ['cost', 'sell']),
    vat: async (ctx) =>
      askNumbers(
        ctx,
        'calc_vat',
        'مبلغ را همراه با نوع محاسبه ارسال کنید:\n<code>1000000 vat</code> برای افزودن مالیات\n<code>1000000 discount 20</code> برای تخفیف ۲۰٪',
        ['amount', 'mode', 'rate'],
      ),
  },
  steps: {
    calc_loan: async (ctx) => {
      const parts = ctx.text.split(/[\s,]+/).filter(Boolean);
      const amount = parseNumberInput(parts[0] ?? '');
      const rate = parseNumberInput(parts[1] ?? '');
      const months = parseNumberInput(parts[2] ?? '');
      if (amount === null || rate === null || months === null || months <= 0) {
        await ctx.reply('ورودی نامعتبر است. نمونه: <code>200000000 24 36</code>');
        return;
      }
      const monthly = installment(amount, rate, months);
      const total = monthly * months;
      await ctx.clearFlow();
      await ctx.reply(
        [
          '<b>نتیجه محاسبه وام</b>',
          '',
          `مبلغ وام: ${ctx.formatMoney(amount)}`,
          `نرخ سود سالانه: ${fa(rate)}٪`,
          `مدت: ${fa(months)} ماه`,
          `قسط ماهانه: ${ctx.formatMoney(monthly)}`,
          `مجموع بازپرداخت: ${ctx.formatMoney(total)}`,
          `سود کل: ${ctx.formatMoney(total - amount)}`,
          '',
          'فرمول: قسط = (اصل × نرخ ماهانه) ÷ (۱ − (۱ + نرخ ماهانه)^−تعداد ماه)',
        ].join('\n'),
        { inline: { rows: [[{ text: 'محاسبه مجدد', callbackData: 'a:loan' }]] } },
      );
    },
    calc_saving: async (ctx) => {
      const parts = ctx.text.split(/[\s,]+/).filter(Boolean);
      const amount = parseNumberInput(parts[0] ?? '');
      const rate = parseNumberInput(parts[1] ?? '');
      const months = parseNumberInput(parts[2] ?? '');
      const deposit = parts[3] ? parseNumberInput(parts[3]) ?? 0 : 0;
      if (amount === null || rate === null || months === null || months <= 0) {
        await ctx.reply('ورودی نامعتبر است. نمونه: <code>50000000 20 12 2000000</code>');
        return;
      }
      const future = futureValue(amount, rate, months, deposit);
      await ctx.clearFlow();
      await ctx.reply(
        [
          '<b>نتیجه سپرده‌گذاری</b>',
          '',
          `سرمایه اولیه: ${ctx.formatMoney(amount)}`,
          `واریز ماهانه: ${ctx.formatMoney(deposit)}`,
          `نرخ سود سالانه: ${fa(rate)}٪`,
          `مدت: ${fa(months)} ماه`,
          `ارزش آینده: ${ctx.formatMoney(future)}`,
          `سود کسب‌شده: ${ctx.formatMoney(future - amount - deposit * months)}`,
        ].join('\n'),
        { inline: { rows: [[{ text: 'محاسبه مجدد', callbackData: 'a:saving' }]] } },
      );
    },
    calc_profit: async (ctx) => {
      const parts = ctx.text.split(/[\s,]+/).filter(Boolean);
      const cost = parseNumberInput(parts[0] ?? '');
      const sell = parseNumberInput(parts[1] ?? '');
      if (cost === null || sell === null || cost <= 0) {
        await ctx.reply('ورودی نامعتبر است. نمونه: <code>1200000 1450000</code>');
        return;
      }
      const diff = sell - cost;
      const percent = (diff / cost) * 100;
      await ctx.clearFlow();
      await ctx.reply(
        [
          '<b>نتیجه معامله</b>',
          '',
          `قیمت خرید: ${ctx.formatMoney(cost)}`,
          `قیمت فروش: ${ctx.formatMoney(sell)}`,
          `${diff >= 0 ? 'سود' : 'زیان'}: ${ctx.formatMoney(Math.abs(diff))}`,
          `درصد: ${fa(percent.toFixed(2))}٪`,
        ].join('\n'),
        { inline: { rows: [[{ text: 'محاسبه مجدد', callbackData: 'a:profit' }]] } },
      );
    },
    calc_vat: async (ctx) => {
      const parts = ctx.text.split(/[\s,]+/).filter(Boolean);
      const amount = parseNumberInput(parts[0] ?? '');
      const mode = (parts[1] ?? 'vat').toLowerCase();
      const rate = parts[2] ? parseNumberInput(parts[2]) : null;
      if (amount === null) {
        await ctx.reply('مبلغ نامعتبر است.');
        return;
      }
      const vatRate = await ctx.getSetting<number>('vatRate', 10);
      await ctx.clearFlow();
      if (mode === 'discount') {
        const percent = rate ?? 10;
        const discount = (amount * percent) / 100;
        await ctx.reply(
          [
            '<b>تخفیف</b>',
            '',
            `مبلغ اولیه: ${ctx.formatMoney(amount)}`,
            `درصد تخفیف: ${fa(percent)}٪`,
            `مبلغ تخفیف: ${ctx.formatMoney(discount)}`,
            `مبلغ نهایی: ${ctx.formatMoney(amount - discount)}`,
          ].join('\n'),
        );
        return;
      }
      const vat = (amount * Number(vatRate)) / 100;
      await ctx.reply(
        [
          '<b>مالیات بر ارزش افزوده</b>',
          '',
          `مبلغ: ${ctx.formatMoney(amount)}`,
          `نرخ مالیات: ${fa(vatRate)}٪`,
          `مالیات: ${ctx.formatMoney(vat)}`,
          `مبلغ نهایی: ${ctx.formatMoney(amount + vat)}`,
        ].join('\n'),
      );
    },
  },
  async onCommand(ctx, command) {
    const map: Record<string, string> = { loan: 'loan', saving: 'saving', profit: 'profit', vat: 'vat' };
    const action = map[command];
    if (action && financeCalculatorBot.actions[action]) {
      await financeCalculatorBot.actions[action](ctx);
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await ctx.reply('<b>محاسبه‌گر مالی</b>\n\nیکی از ابزارها را انتخاب کنید.', {
      inline: {
        rows: [
          [
            { text: 'قسط وام', callbackData: 'a:loan' },
            { text: 'سود سپرده', callbackData: 'a:saving' },
          ],
          [
            { text: 'سود معامله', callbackData: 'a:profit' },
            { text: 'مالیات و تخفیف', callbackData: 'a:vat' },
          ],
        ],
      },
    });
  },
});
