import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  nextSequence,
  requireAdmin,
  saveDoc,
  truncateText,
} from '../kit';

interface Field {
  label: string;
  required: boolean;
}

interface FormDefinition {
  id: string;
  title: string;
  description: string;
  fields: Field[];
  active: boolean;
  submissions: number;
  createdAt: string;
}

interface Submission {
  id: string;
  number: number;
  formId: string;
  userId: string;
  chatId: string;
  answers: Record<string, string>;
  createdAt: string;
}

const FORMS = 'forms';
const SUBMISSIONS = 'submissions';

async function activeForms(ctx: BotContext): Promise<FormDefinition[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, FORMS, 1, 100, 'asc');
  return result.items.map((item) => item.data as unknown as FormDefinition).filter((form) => form.active);
}

async function renderForms(ctx: BotContext): Promise<void> {
  const forms = await activeForms(ctx);
  if (forms.length === 0) {
    await ctx.reply('فرمی تعریف نشده است.', {
      inline: { rows: [[{ text: 'فرم جدید', callbackData: 'a:newform' }]] },
    });
    return;
  }
  const lines = ['<b>فرم‌های فعال</b>', ''];
  for (const form of forms) {
    lines.push(`<b>${ctx.escape(form.title)}</b>\n${form.description ? ctx.escape(truncateText(form.description, 100)) : ''}\n${fa(form.fields.length)} فیلد — ${fa(form.submissions)} پاسخ`);
  }
  await ctx.reply(lines.join('\n'), {
    inline: { rows: chunkButtons(forms.map((form) => ({ text: truncateText(form.title, 20), data: `a:fill:${form.id}` })), 2).rows },
  });
}

async function startFilling(ctx: BotContext, formId: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FORMS, `form_${formId}`);
  if (!doc) {
    await ctx.reply('فرم پیدا نشد.');
    return;
  }
  const form = doc.data as unknown as FormDefinition;
  const first = form.fields[0];
  if (!first) {
    await ctx.reply('این فرم فیلدی ندارد.');
    return;
  }
  await ctx.setFlow('form_fill', { formId, index: 0, answers: {} });
  await ctx.reply(`<b>${ctx.escape(form.title)}</b>\n\n${ctx.escape(first.label)}${first.required ? ' (الزامی)' : ''}\n\nبرای انصراف /cancel`);
}

export const formBuilderBot = defineBot({
  id: 'form-builder',
  name: 'فرم‌ساز',
  category: 'E',
  summary: 'ساخت فرم چندمرحله‌ای، دریافت پاسخ و گزارش برای مدیر',
  description:
    'مدیر فرم می‌سازد و فیلدها را تعریف می‌کند (هر فیلد در یک خط، با علامت * برای الزامی). کاربران فرم را مرحله‌به‌مرحله پر می‌کنند و پاسخ‌ها شماره‌گذاری و ذخیره می‌شوند. مدیر می‌تواند پاسخ‌ها را ببیند یا خروجی JSON بگیرد.',
  icon: 'clipboard',
  tags: ['forms', 'business'],
  commands: [
    { command: 'forms', description: 'فرم‌های فعال' },
    { command: 'newform', description: 'فرم جدید (مدیر)', adminOnly: true },
    { command: 'submissions', description: 'پاسخ‌ها (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'forms', label: 'فرم‌ها' },
    { id: 'newform', label: 'فرم جدید', adminOnly: true },
    { id: 'submissions', label: 'پاسخ‌ها', adminOnly: true },
  ],
  defaultConfig: { maxFields: 15 },
  actions: {
    forms: async (ctx) => renderForms(ctx),
    fill: async (ctx, param) => {
      if (param) await startFilling(ctx, param);
    },
    newform: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('form_title', {});
      await ctx.reply('عنوان فرم را ارسال کنید:');
    },
    submissions: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const result = await listDocs(ctx.storage, ctx.bot.id, SUBMISSIONS, 1, 200);
      const subs = result.items.map((item) => item.data as unknown as Submission);
      if (subs.length === 0) {
        await ctx.reply('پاسخی ثبت نشده است.');
        return;
      }
      if (param) {
        const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, SUBMISSIONS, `sub_${param}`);
        if (doc) {
          const submission = doc.data as unknown as Submission;
          const lines = [`<b>پاسخ #${fa(submission.number)}</b>`, ''];
          for (const [field, value] of Object.entries(submission.answers)) {
            lines.push(`<b>${ctx.escape(field)}</b>: ${ctx.escape(value)}`);
          }
          lines.push('', ctx.formatDateTime(submission.createdAt));
          await ctx.reply(lines.join('\n'));
        }
        return;
      }
      const lines = [`<b>آخرین پاسخ‌ها</b>`, ''];
      const rows: Array<Array<{ text: string; callbackData: string }>> = [];
      subs.slice(0, 10).forEach((submission) => {
        lines.push(`#${fa(submission.number)} — ${ctx.formatDateTime(submission.createdAt)}`);
        rows.push([{ text: `#${fa(submission.number)}`, callbackData: `a:submissions:${submission.id}` }]);
      });
      await ctx.reply(lines.join('\n'), { inline: { rows } });
    },
    deactivate: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FORMS, `form_${param}`);
      if (!doc) return;
      await saveDoc(ctx.storage, ctx.bot.id, FORMS, `form_${param}`, {
        ...(doc.data as Record<string, unknown>),
        active: false,
      });
      await ctx.reply('فرم غیرفعال شد.');
    },
  },
  steps: {
    form_title: async (ctx) => {
      await ctx.setFlow('form_description', { title: ctx.text.trim().slice(0, 100) });
      await ctx.reply('توضیح فرم را ارسال کنید (یا «-»):');
    },
    form_description: async (ctx) => {
      const description = ctx.text.trim() === '-' ? '' : ctx.text.trim().slice(0, 500);
      await ctx.setFlow('form_fields', { ...(ctx.flow?.data ?? {}), description });
      await ctx.reply(
        'فیلدهای فرم را هر کدام در یک خط ارسال کنید. برای فیلد الزامی علامت * بگذارید.\nنمونه:\n<code>نام و نام خانوادگی*\nشماره تماس*\nتوضیحات</code>',
      );
    },
    form_fields: async (ctx) => {
      const max = await ctx.getSetting<number>('maxFields', 15);
      const fields: Field[] = ctx.text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, Number(max))
        .map((line) => ({
          label: line.replace(/\*$/, '').trim().slice(0, 80),
          required: line.endsWith('*'),
        }));
      if (fields.length === 0) {
        await ctx.reply('حداقل یک فیلد لازم است.');
        return;
      }
      const id = Date.now().toString(36);
      const form: FormDefinition = {
        id,
        title: String(ctx.flow?.data.title ?? 'فرم'),
        description: String(ctx.flow?.data.description ?? ''),
        fields,
        active: true,
        submissions: 0,
        createdAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, FORMS, `form_${id}`, form as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`فرم «${ctx.escape(form.title)}» با ${fa(fields.length)} فیلد ساخته شد.`, {
        inline: { rows: [[{ text: 'مشاهده فرم', callbackData: `a:fill:${id}` }]] },
      });
    },
    form_fill: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const formId = String(data.formId ?? '');
      const index = Number(data.index ?? 0);
      const answers = { ...((data.answers as Record<string, string>) ?? {}) };
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, FORMS, `form_${formId}`);
      if (!doc) {
        await ctx.clearFlow();
        await ctx.reply('فرم پیدا نشد.');
        return;
      }
      const form = doc.data as unknown as FormDefinition;
      const field = form.fields[index];
      if (!field) {
        await ctx.clearFlow();
        await ctx.reply('فرم ناقص است.');
        return;
      }
      const value = ctx.text.trim();
      if (field.required && value.length === 0) {
        await ctx.reply('این فیلد الزامی است. مقدار را وارد کنید.');
        return;
      }
      answers[field.label] = value.slice(0, 1000);
      const nextIndex = index + 1;
      if (nextIndex >= form.fields.length) {
        const number = await nextSequence(ctx, 'submissions');
        const id = Date.now().toString(36);
        const submission: Submission = {
          id,
          number,
          formId,
          userId: ctx.user.id,
          chatId: ctx.message.chatId,
          answers,
          createdAt: new Date().toISOString(),
        };
        await saveDoc(ctx.storage, ctx.bot.id, SUBMISSIONS, `sub_${id}`, submission as unknown as Record<string, unknown>);
        await saveDoc(ctx.storage, ctx.bot.id, FORMS, `form_${formId}`, {
          ...(doc.data as Record<string, unknown>),
          submissions: (form.submissions ?? 0) + 1,
        });
        await ctx.clearFlow();
        await ctx.reply(`پاسخ شما با شماره #${fa(number)} ثبت شد.`, {
          inline: { rows: [[{ text: 'منوی اصلی', callbackData: 'a:__menu' }]] },
        });
        await ctx.notifyAdmin(`پاسخ جدید فرم «${ctx.escape(form.title)}» #${fa(number)}`);
        return;
      }
      const nextField = form.fields[nextIndex];
      await ctx.setFlow('form_fill', { formId, index: nextIndex, answers });
      await ctx.reply(`${ctx.escape(nextField.label)}${nextField.required ? ' (الزامی)' : ''}`);
    },
  },
  async onStart(ctx) {
    await renderForms(ctx);
  },
  onText: async (ctx) => {
    await ctx.reply('برای پر کردن فرم، از فهرست فرم‌ها استفاده کنید.', {
      inline: { rows: [[{ text: 'فرم‌ها', callbackData: 'a:forms' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'forms') {
      await renderForms(ctx);
      return true;
    }
    if (command === 'newform') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('form_title', {});
      await ctx.reply('عنوان فرم را ارسال کنید:');
      return true;
    }
    if (command === 'submissions') {
      await formBuilderBot.actions.submissions(ctx);
      return true;
    }
    return false;
  },
});

export type { FormDefinition, Submission };
