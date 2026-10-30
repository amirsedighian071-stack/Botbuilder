import type { BotContext } from '@botforge/core';
import { chunkButtons, defineBot, fa, getDoc, listDocs, saveDoc, truncateText } from '../kit';

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

interface Flashcard {
  id: string;
  question: string;
  answer: string;
  box: number;
  dueAt: string;
  createdAt: string;
  correct: number;
  wrong: number;
}

const notesCollection = 'notes';
const cardsCollection = 'flashcards';

async function ownNotes(ctx: BotContext): Promise<Note[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, notesCollection, 1, 300);
  return result.items
    .map((item) => item.data as unknown as Note & { userId: string })
    .filter((note) => note.userId === ctx.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function ownCards(ctx: BotContext): Promise<Flashcard[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, cardsCollection, 1, 400);
  return result.items
    .map((item) => item.data as unknown as Flashcard & { userId: string })
    .filter((card) => card.userId === ctx.user.id);
}

async function renderNotes(ctx: BotContext): Promise<void> {
  const notes = await ownNotes(ctx);
  if (notes.length === 0) {
    await ctx.reply('هنوز یادداشتی ذخیره نکرده‌اید.', {
      inline: { rows: [[{ text: 'یادداشت جدید', callbackData: 'a:addnote' }]] },
    });
    return;
  }
  const lines = ['<b>یادداشت‌های شما</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  notes.slice(0, 10).forEach((note, index) => {
    lines.push(`${index + 1}. ${ctx.escape(truncateText(note.title, 40))} — ${ctx.formatDate(note.createdAt)}`);
    rows.push([{ text: truncateText(note.title, 20), callbackData: `a:note:${note.id}` }]);
  });
  rows.push([{ text: 'یادداشت جدید', callbackData: 'a:addnote' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderNote(ctx: BotContext, id: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, notesCollection, `note_${id}`);
  if (!doc) {
    await ctx.reply('یادداشت پیدا نشد.');
    return;
  }
  const note = doc.data as unknown as Note;
  await ctx.reply(`<b>${ctx.escape(note.title)}</b>\n\n${ctx.escape(note.content.slice(0, 3000))}\n\n${ctx.formatDateTime(note.createdAt)}`, {
    inline: {
      rows: [
        [{ text: 'ساخت فلش‌کارت', callbackData: `a:mkcard:${id}` }],
        [
          { text: 'آزمون از این یادداشت', callbackData: `a:quiz:${id}` },
          { text: 'حذف', callbackData: `a:delnote:${id}` },
        ],
        [{ text: 'بازگشت', callbackData: 'a:notes' }],
      ],
    },
  });
}

async function reviewCards(ctx: BotContext): Promise<void> {
  const cards = (await ownCards(ctx)).filter((card) => new Date(card.dueAt).getTime() <= Date.now());
  if (cards.length === 0) {
    await ctx.reply('فلش‌کارتی برای مرور امروز وجود ندارد. کارت جدید بسازید.', {
      inline: { rows: [[{ text: 'فلش‌کارت جدید', callbackData: 'a:addcard' }]] },
    });
    return;
  }
  const card = cards[0];
  await ctx.setFlow('review_answer', { cardId: card.id });
  await ctx.reply(
    `<b>فلش‌کارت</b> (${fa(card.box)} از ۵)\n\n${ctx.escape(card.question)}\n\n` +
      `آمار: ${fa(card.correct)} درست / ${fa(card.wrong)} نادرست`,
    { inline: { rows: [[{ text: 'نمایش پاسخ', callbackData: `a:reveal:${card.id}` }]] } },
  );
}

function nextDue(box: number): string {
  const days = [1, 2, 4, 7, 14][Math.min(box, 4)] ?? 14;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export const studyAssistantBot = defineBot({
  id: 'study-assistant',
  name: 'دستیار مطالعه',
  category: 'D',
  summary: 'یادداشت‌برداری، فلش‌کارت با مرور فاصله‌دار و آزمون هوشمند',
  description:
    'یادداشت‌های درسی را ذخیره می‌کند و از هر یادداشت فلش‌کارت یا آزمون می‌سازد. مرور کارت‌ها با الگوریتم جعبه لایتنر (۵ سطح) انجام می‌شود؛ پاسخ درست کارت را به جعبه بالاتر و پاسخ نادرست به جعبه اول منتقل می‌کند.',
  icon: 'book-open',
  tags: ['ai', 'education'],
  commands: [
    { command: 'notes', description: 'یادداشت‌های من' },
    { command: 'review', description: 'مرور فلش‌کارت‌ها' },
    { command: 'quiz', description: 'آزمون از یادداشت' },
  ],
  menu: [
    { id: 'notes', label: 'یادداشت‌ها' },
    { id: 'addnote', label: 'یادداشت جدید' },
    { id: 'review', label: 'مرور فلش‌کارت' },
    { id: 'addcard', label: 'فلش‌کارت جدید' },
  ],
  requirements: [
    {
      key: 'AI_API_KEY',
      label: 'کلید هوش مصنوعی',
      description: 'برای ساخت آزمون و فلش‌کارت خودکار.',
      required: false,
      env: 'AI_API_KEY',
    },
  ],
  defaultConfig: { quizQuestions: 5 },
  actions: {
    notes: async (ctx) => renderNotes(ctx),
    note: async (ctx, param) => {
      if (param) await renderNote(ctx, param);
    },
    addnote: async (ctx) => {
      await ctx.setFlow('note_title', {});
      await ctx.reply('عنوان یادداشت را ارسال کنید:');
    },
    delnote: async (ctx, param) => {
      await ctx.storage.documents.deleteByKey(ctx.bot.id, notesCollection, `note_${param}`);
      await ctx.reply('یادداشت حذف شد.');
    },
    addcard: async (ctx) => {
      await ctx.setFlow('card_question', {});
      await ctx.reply('سؤال فلش‌کارت را ارسال کنید:');
    },
    mkcard: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, notesCollection, `note_${param}`);
      if (!doc) return;
      const note = doc.data as unknown as Note;
      await ctx.setFlow('card_answer', { question: `مهم‌ترین نکته یادداشت «${note.title}» چیست؟`, fromNote: param });
      await ctx.reply('پاسخ فلش‌کارت را ارسال کنید:');
    },
    review: async (ctx) => reviewCards(ctx),
    reveal: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, cardsCollection, `card_${param}`);
      if (!doc) {
        await ctx.reply('کارت پیدا نشد.');
        return;
      }
      const card = doc.data as unknown as Flashcard;
      await ctx.reply(`<b>پاسخ</b>\n\n${ctx.escape(card.answer)}`, {
        inline: {
          rows: [
            [
              { text: 'درست بود', callbackData: `a:grade:${card.id}:correct` },
              { text: 'نادرست بود', callbackData: `a:grade:${card.id}:wrong` },
            ],
          ],
        },
      });
    },
    grade: async (ctx, param) => {
      const [id, result] = (param ?? '').split(':');
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, cardsCollection, `card_${id}`);
      if (!doc) return;
      const card = doc.data as unknown as Flashcard;
      const correct = result === 'correct';
      const box = correct ? Math.min(5, card.box + 1) : 0;
      await saveDoc(ctx.storage, ctx.bot.id, cardsCollection, `card_${id}`, {
        ...(doc.data as Record<string, unknown>),
        box,
        dueAt: nextDue(box),
        correct: card.correct + (correct ? 1 : 0),
        wrong: card.wrong + (correct ? 0 : 1),
      });
      await ctx.reply(correct ? 'عالی! کارت به جعبه بالاتر رفت.' : 'اشکالی ندارد؛ کارت برای مرور فردا تنظیم شد.');
      await reviewCards(ctx);
    },
    quiz: async (ctx, param) => {
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, notesCollection, `note_${param}`);
      if (!doc) {
        await ctx.reply('یادداشت پیدا نشد.');
        return;
      }
      if (!ctx.services.ai.available) {
        await ctx.reply('برای ساخت آزمون، کلید هوش مصنوعی لازم است.');
        return;
      }
      const note = doc.data as unknown as Note;
      await ctx.typing();
      const count = await ctx.getSetting<number>('quizQuestions', 5);
      const questions = await ctx.services.ai.json<Array<{ q: string; options: string[]; answer: number; explain?: string }>>(
        `از متن زیر ${count} سؤال چهارگزینه‌ای بساز. خروجی JSON با ساختار {"questions":[{"q":"","options":["","","",""],"answer":0,"explain":""}]}\n\nمتن:\n${truncateText(note.content, 6000)}`,
        'تو یک معلم دقیق هستی و فقط JSON معتبر برمی‌گردانی.',
      );
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        await ctx.reply('ساخت آزمون ممکن نشد. دوباره تلاش کنید.');
        return;
      }
      await saveDoc(ctx.storage, ctx.bot.id, 'quizzes', `quiz_${ctx.user.id}`, {
        noteId: param,
        questions,
        index: 0,
        score: 0,
        createdAt: new Date().toISOString(),
      });
      await sendQuizQuestion(ctx);
    },
    answer: async (ctx, param) => {
      const quizDoc = await getDoc<{
        questions: Array<{ q: string; options: string[]; answer: number; explain?: string }>;
        index: number;
        score: number;
      }>(ctx.storage, ctx.bot.id, 'quizzes', `quiz_${ctx.user.id}`);
      if (!quizDoc) {
        await ctx.reply('آزمونی در جریان نیست.');
        return;
      }
      const quiz = quizDoc.data;
      const question = quiz.questions[quiz.index];
      if (!question) return;
      const selected = Number(param);
      const isCorrect = selected === question.answer;
      const updated = {
        ...quiz,
        index: quiz.index + 1,
        score: quiz.score + (isCorrect ? 1 : 0),
      };
      await saveDoc(ctx.storage, ctx.bot.id, 'quizzes', `quiz_${ctx.user.id}`, updated);
      await ctx.reply(
        `${isCorrect ? 'پاسخ درست بود.' : `پاسخ نادرست بود. گزینه صحیح: ${question.options[question.answer]}`}` +
          (question.explain ? `\n${ctx.escape(question.explain)}` : ''),
      );
      if (updated.index >= quiz.questions.length) {
        await ctx.reply(
          `<b>پایان آزمون</b>\n\nامتیاز: ${fa(updated.score)} از ${fa(quiz.questions.length)}\n` +
            `درصد: ${fa(Math.round((updated.score / quiz.questions.length) * 100))}٪`,
          { inline: { rows: [[{ text: 'یادداشت‌ها', callbackData: 'a:notes' }]] } },
        );
        await ctx.storage.documents.deleteByKey(ctx.bot.id, 'quizzes', `quiz_${ctx.user.id}`);
        return;
      }
      await sendQuizQuestion(ctx);
    },
  },
  steps: {
    note_title: async (ctx) => {
      await ctx.setFlow('note_content', { title: ctx.text.trim().slice(0, 100) });
      await ctx.reply('متن یادداشت را ارسال کنید:');
    },
    note_content: async (ctx) => {
      const content = ctx.text.trim();
      if (content.length < 3) {
        await ctx.reply('متن یادداشت خیلی کوتاه است.');
        return;
      }
      const id = Date.now().toString(36);
      await saveDoc(ctx.storage, ctx.bot.id, notesCollection, `note_${id}`, {
        id,
        title: String(ctx.flow?.data.title ?? 'یادداشت'),
        content: content.slice(0, 8000),
        userId: ctx.user.id,
        createdAt: new Date().toISOString(),
      });
      await ctx.clearFlow();
      await ctx.reply('یادداشت ذخیره شد.', { inline: { rows: [[{ text: 'یادداشت‌های من', callbackData: 'a:notes' }]] } });
    },
    card_question: async (ctx) => {
      await ctx.setFlow('card_answer', { question: ctx.text.trim().slice(0, 300) });
      await ctx.reply('پاسخ فلش‌کارت را ارسال کنید:');
    },
    card_answer: async (ctx) => {
      const answer = ctx.text.trim();
      const id = Date.now().toString(36);
      await saveDoc(ctx.storage, ctx.bot.id, cardsCollection, `card_${id}`, {
        id,
        question: String(ctx.flow?.data.question ?? 'سؤال'),
        answer: answer.slice(0, 1000),
        box: 0,
        dueAt: new Date().toISOString(),
        userId: ctx.user.id,
        correct: 0,
        wrong: 0,
        createdAt: new Date().toISOString(),
      });
      await ctx.clearFlow();
      await ctx.reply('فلش‌کارت ساخته شد.', {
        inline: { rows: [[{ text: 'شروع مرور', callbackData: 'a:review' }]] },
      });
    },
  },
  async onStart(ctx) {
    const cards = await ownCards(ctx);
    await ctx.reply(
      `<b>دستیار مطالعه</b>\n\nفلش‌کارت‌های شما: ${fa(cards.length)}\n` +
        `آماده مرور: ${fa(cards.filter((card) => new Date(card.dueAt).getTime() <= Date.now()).length)}`,
      {
        inline: {
          rows: [
            [
              { text: 'یادداشت‌ها', callbackData: 'a:notes' },
              { text: 'مرور', callbackData: 'a:review' },
            ],
            [{ text: 'یادداشت جدید', callbackData: 'a:addnote' }],
          ],
        },
      },
    );
  },
  onText: async (ctx) => {
    await ctx.reply('از منوی مطالعه استفاده کنید.', {
      inline: {
        rows: [
          [
            { text: 'یادداشت جدید', callbackData: 'a:addnote' },
            { text: 'مرور', callbackData: 'a:review' },
          ],
        ],
      },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'notes') {
      await renderNotes(ctx);
      return true;
    }
    if (command === 'review') {
      await reviewCards(ctx);
      return true;
    }
    if (command === 'quiz') {
      const notes = await ownNotes(ctx);
      if (notes.length === 0) {
        await ctx.reply('ابتدا یک یادداشت بسازید.');
        return true;
      }
      await ctx.reply('یادداشت مورد نظر را انتخاب کنید:', {
        inline: { rows: chunkButtons(notes.slice(0, 8).map((note) => ({ text: truncateText(note.title, 20), data: `a:quiz:${note.id}` })), 2).rows },
      });
      return true;
    }
    return false;
  },
});

async function sendQuizQuestion(ctx: BotContext): Promise<void> {
  const quizDoc = await getDoc<{
    questions: Array<{ q: string; options: string[]; answer: number; explain?: string }>;
    index: number;
    score: number;
  }>(ctx.storage, ctx.bot.id, 'quizzes', `quiz_${ctx.user.id}`);
  if (!quizDoc) {
    await ctx.reply('آزمونی در جریان نیست.');
    return;
  }
  const quiz = quizDoc.data;
  const question = quiz.questions[quiz.index];
  if (!question) return;
  const rows = question.options.map((option, index) => [
    { text: `${index + 1}. ${truncateText(option, 40)}`, callbackData: `a:answer:${index}` },
  ]);
  await ctx.reply(
    `<b>سؤال ${fa(quiz.index + 1)} از ${fa(quiz.questions.length)}</b>\n\n${ctx.escape(question.q)}`,
    { inline: { rows } },
  );
}

export type { Flashcard, Note };
