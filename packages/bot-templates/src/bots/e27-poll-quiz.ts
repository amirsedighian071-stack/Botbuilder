import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, getDoc, listDocs, parseNumberInput, requireAdmin, saveDoc, truncateText } from '../kit';

interface Option {
  text: string;
  votes: number;
}

interface Poll {
  id: string;
  number: number;
  title: string;
  options: Option[];
  type: 'poll' | 'quiz';
  anonymous: boolean;
  correctIndex: number | null;
  closed: boolean;
  chatId: string;
  creatorId: string;
  voters: Record<string, number>;
  createdAt: string;
}

const POLLS = 'polls';

function renderBars(poll: Poll): string {
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0) || 1;
  return poll.options
    .map((option, index) => {
      const percent = Math.round((option.votes / total) * 100);
      const filled = Math.round(percent / 10);
      const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
      return `${index + 1}. ${option.text}\n${bar} ${fa(percent)}٪ (${fa(option.votes)} رأی)`;
    })
    .join('\n\n');
}

async function sendPoll(ctx: BotContext, poll: Poll): Promise<void> {
  const rows = poll.options.map((option, index) => [
    { text: truncateText(option.text, 40), callbackData: `a:vote:${poll.id}:${index}` },
  ]);
  rows.push([{ text: 'نتایج', callbackData: `a:results:${poll.id}` }]);
  const header =
    `<b>${poll.type === 'quiz' ? 'آزمون' : 'نظرسنجی'} #${fa(poll.number)}</b>\n\n${ctx.escape(poll.title)}\n\n` +
    (poll.anonymous ? '<i>رأی شما ناشناس ثبت می‌شود.</i>' : '');
  await ctx.reply(header, { inline: { rows } });
}

async function renderResults(ctx: BotContext, id: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, POLLS, `poll_${id}`);
  if (!doc) {
    await ctx.reply('نظرسنجی پیدا نشد.');
    return;
  }
  const poll = doc.data as unknown as Poll;
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
  await ctx.reply(
    `<b>نتایج: ${ctx.escape(poll.title)}</b>\n\n${renderBars(poll)}\n\nمجموع رأی‌ها: ${fa(total)}` +
      (poll.closed ? '\n\n<i>این نظرسنجی بسته شده است.</i>' : ''),
    { inline: { rows: [[{ text: 'بازگشت', callbackData: `a:vote:${poll.id}:0` }]] } },
  );
}

export const pollQuizBot = defineBot({
  id: 'poll-quiz',
  name: 'نظرسنجی و آزمون',
  category: 'E',
  summary: 'ساخت نظرسنجی و آزمون با رأی‌گیری، نتایج زنده و حالت ناشناس',
  description:
    'مدیر نظرسنجی یا آزمون می‌سازد، گزینه‌ها را تعیین می‌کند و می‌تواند پاسخ صحیح را مشخص کند. کاربران با دکمه‌های شیشه‌ای رأی می‌دهند؛ نتایج با نمودار متنی نمایش داده می‌شود. رأی هر کاربر یک بار ثبت می‌شود و امکان رأی ناشناس و بستن نظرسنجی وجود دارد.',
  icon: 'bar-chart-3',
  tags: ['polls', 'education'],
  commands: [
    { command: 'newpoll', description: 'نظرسنجی جدید (مدیر)', adminOnly: true },
    { command: 'newquiz', description: 'آزمون جدید (مدیر)', adminOnly: true },
    { command: 'myvotes', description: 'نظرسنجی‌های من' },
  ],
  menu: [
    { id: 'newpoll', label: 'نظرسنجی جدید', adminOnly: true },
    { id: 'newquiz', label: 'آزمون جدید', adminOnly: true },
    { id: 'myvotes', label: 'نظرسنجی‌های من' },
  ],
  defaultConfig: { maxOptions: 10, anonymousDefault: false },
  actions: {
    newpoll: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('poll_title', { type: 'poll' });
      await ctx.reply('سؤال نظرسنجی را ارسال کنید:');
    },
    newquiz: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('poll_title', { type: 'quiz' });
      await ctx.reply('سؤال آزمون را ارسال کنید:');
    },
    vote: async (ctx, param) => {
      const [id, indexRaw] = (param ?? '').split(':');
      const index = Number(indexRaw);
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, POLLS, `poll_${id}`);
      if (!doc) {
        await ctx.reply('نظرسنجی پیدا نشد.');
        return;
      }
      const poll = doc.data as unknown as Poll;
      if (poll.closed) {
        await ctx.reply('این نظرسنجی بسته شده است.');
        return;
      }
      if (!poll.options[index]) {
        await ctx.reply('گزینه نامعتبر است.');
        return;
      }
      const previous = poll.voters[ctx.user.id];
      if (previous !== undefined) {
        if (poll.anonymous) {
          await ctx.reply('رأی شما قبلاً ثبت شده است.');
          return;
        }
        poll.options[previous].votes = Math.max(0, poll.options[previous].votes - 1);
      }
      poll.options[index].votes += 1;
      poll.voters[ctx.user.id] = index;
      await saveDoc(ctx.storage, ctx.bot.id, POLLS, `poll_${id}`, poll as unknown as Record<string, unknown>);
      if (poll.type === 'quiz' && poll.correctIndex !== null) {
        const correct = index === poll.correctIndex;
        await ctx.reply(
          `${correct ? 'پاسخ درست است.' : `پاسخ نادرست است. گزینه صحیح: ${poll.options[poll.correctIndex ?? 0].text}`}\n\n` +
            `${correct ? 'امتیاز شما ثبت شد.' : 'دفعه بعد بهتر خواهید بود.'}`,
        );
      } else {
        await ctx.reply('رأی شما ثبت شد.', {
          inline: { rows: [[{ text: 'نتایج', callbackData: `a:results:${id}` }]] },
        });
      }
    },
    mode: async (ctx, param) => {
      await pollMode(ctx, param ?? 'public');
    },
    results: async (ctx, param) => {
      if (param) await renderResults(ctx, param);
    },
    myvotes: async (ctx) => {
      const result = await listDocs(ctx.storage, ctx.bot.id, POLLS, 1, 100);
      const polls = result.items.map((item) => item.data as unknown as Poll).filter((poll) => !poll.closed);
      if (polls.length === 0) {
        await ctx.reply('نظرسنجی فعالی وجود ندارد.');
        return;
      }
      const lines = ['<b>نظرسنجی‌های فعال</b>', ''];
      const rows: Array<Array<{ text: string; callbackData: string }>> = [];
      for (const poll of polls.slice(0, 8)) {
        lines.push(`#${fa(poll.number)} — ${ctx.escape(truncateText(poll.title, 50))}`);
        rows.push([{ text: truncateText(poll.title, 20), callbackData: `a:open:${poll.id}` }]);
      }
      await ctx.reply(lines.join('\n'), { inline: { rows } });
    },
    open: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, POLLS, `poll_${param}`);
      if (!doc) return;
      await sendPoll(ctx, doc.data as unknown as Poll);
    },
    close: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, POLLS, `poll_${param}`);
      if (!doc) return;
      await saveDoc(ctx.storage, ctx.bot.id, POLLS, `poll_${param}`, {
        ...(doc.data as Record<string, unknown>),
        closed: true,
      });
      await ctx.reply('نظرسنجی بسته شد.');
      await renderResults(ctx, param ?? '');
    },
    publish: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, POLLS, `poll_${param}`);
      if (!doc) return;
      const poll = doc.data as unknown as Poll;
      await sendPoll(ctx, poll);
    },
  },
  steps: {
    poll_title: async (ctx) => {
      await ctx.setFlow('poll_options', { ...(ctx.flow?.data ?? {}), title: ctx.text.trim().slice(0, 300) });
      await ctx.reply('گزینه‌ها را هر کدام در یک خط ارسال کنید (بین ۲ تا ۱۰ گزینه):');
    },
    poll_options: async (ctx) => {
      const max = await ctx.getSetting<number>('maxOptions', 10);
      const options = ctx.text
        .split('\n')
        .map((line) => line.trim().replace(/^[-•\d.)\s]+/, ''))
        .filter(Boolean)
        .slice(0, Number(max));
      if (options.length < 2) {
        await ctx.reply('حداقل دو گزینه لازم است.');
        return;
      }
      const type = String(ctx.flow?.data.type ?? 'poll');
      if (type === 'quiz') {
        await ctx.setFlow('poll_correct', { ...(ctx.flow?.data ?? {}), options });
        await ctx.reply('شماره گزینه صحیح را ارسال کنید (از ۱):');
        return;
      }
      await ctx.setFlow('poll_mode', { ...(ctx.flow?.data ?? {}), options });
      await ctx.reply('نوع رأی‌گیری را انتخاب کنید: عمومی یا ناشناس', {
        inline: {
          rows: [
            [
              { text: 'عمومی', callbackData: 'a:mode:public' },
              { text: 'ناشناس', callbackData: 'a:mode:anonymous' },
            ],
          ],
        },
      });
    },
    poll_mode: async (ctx) => {
      const input = ctx.text.trim();
      if (/ناشناس|anonymous/i.test(input)) {
        await pollMode(ctx, 'anonymous');
        return;
      }
      if (/عمومی|public/i.test(input)) {
        await pollMode(ctx, 'public');
        return;
      }
      await ctx.reply('یکی از گزینه‌های «عمومی» یا «ناشناس» را انتخاب کنید:', {
        inline: {
          rows: [
            [
              { text: 'عمومی', callbackData: 'a:mode:public' },
              { text: 'ناشناس', callbackData: 'a:mode:anonymous' },
            ],
          ],
        },
      });
    },
    poll_correct: async (ctx) => {
      const index = parseNumberInput(ctx.text);
      const options = (ctx.flow?.data.options as string[]) ?? [];
      if (index === null || index < 1 || index > options.length) {
        await ctx.reply('شماره گزینه نامعتبر است.');
        return;
      }
      await createPoll(ctx, index - 1, 'public');
    },
  },
  async onStart(ctx) {
    await ctx.reply('<b>نظرسنجی و آزمون</b>\n\nنظرسنجی بسازید یا در نظرسنجی‌های فعال شرکت کنید.', {
      inline: {
        rows: [
          [{ text: 'نظرسنجی‌های فعال', callbackData: 'a:myvotes' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    await ctx.reply('برای ساخت یا شرکت در نظرسنجی از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'نظرسنجی‌های من', callbackData: 'a:myvotes' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'newpoll' || command === 'newquiz') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('poll_title', { type: command === 'newquiz' ? 'quiz' : 'poll' });
      await ctx.reply('سؤال را ارسال کنید:');
      return true;
    }
    if (command === 'myvotes') {
      await pollQuizBot.actions.myvotes(ctx);
      return true;
    }
    return false;
  },
});

async function createPoll(ctx: BotContext, correctIndex: number | null, privacy: 'public' | 'anonymous'): Promise<void> {
  const data = ctx.flow?.data ?? {};
  const options = ((data.options as string[]) ?? []).map((text) => ({ text, votes: 0 }));
  const result = await listDocs(ctx.storage, ctx.bot.id, POLLS, 1, 200);
  const numbers = result.items.map((item) => (item.data as unknown as Poll).number ?? 0);
  const number = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  const id = Date.now().toString(36);
  const poll: Poll = {
    id,
    number,
    title: String(data.title ?? 'نظرسنجی'),
    options,
    type: data.type === 'quiz' ? 'quiz' : 'poll',
    anonymous: privacy === 'anonymous',
    correctIndex: data.type === 'quiz' ? correctIndex : null,
    closed: false,
    chatId: ctx.message.chatId,
    creatorId: ctx.user.id,
    voters: {},
    createdAt: new Date().toISOString(),
  };
  await saveDoc(ctx.storage, ctx.bot.id, POLLS, `poll_${id}`, poll as unknown as Record<string, unknown>);
  await ctx.clearFlow();
  await sendPoll(ctx, poll);
}

export async function pollMode(ctx: BotContext, mode: string): Promise<void> {
  const type = String(ctx.flow?.data.type ?? 'poll');
  if (type === 'quiz') {
    await ctx.setFlow('poll_correct', { ...(ctx.flow?.data ?? {}) });
    await ctx.reply('شماره گزینه صحیح را ارسال کنید (از ۱):');
    return;
  }
  await createPoll(ctx, null, mode === 'anonymous' ? 'anonymous' : 'public');
}

export type { Poll };
