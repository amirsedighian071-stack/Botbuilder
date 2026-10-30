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
  truncateText,
} from '../kit';

interface Lesson {
  title: string;
  content: string;
}

interface Course {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  active: boolean;
  createdAt: string;
}

interface Enrollment {
  userId: string;
  chatId: string;
  courseId: string;
  completed: number[];
  startedAt: string;
  finishedAt: string | null;
}

const COURSES = 'courses';
const ENROLLMENTS = 'enrollments';

function enrollmentKey(userId: string, courseId: string): string {
  return `enroll_${userId}_${courseId}`;
}

async function activeCourses(ctx: BotContext): Promise<Course[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, COURSES, 1, 100, 'asc');
  return result.items.map((item) => item.data as unknown as Course).filter((course) => course.active);
}

async function enrollmentFor(ctx: BotContext, courseId: string): Promise<Enrollment | null> {
  const doc = await getDoc<Record<string, unknown>>(
    ctx.storage,
    ctx.bot.id,
    ENROLLMENTS,
    enrollmentKey(ctx.user.id, courseId),
  );
  return doc ? (doc.data as unknown as Enrollment) : null;
}

async function renderCourses(ctx: BotContext): Promise<void> {
  const courses = await activeCourses(ctx);
  if (courses.length === 0) {
    await ctx.reply('دوره‌ای تعریف نشده است.', {
      inline: { rows: [[{ text: 'دوره جدید', callbackData: 'a:newcourse' }]] },
    });
    return;
  }
  const lines = ['<b>دوره‌های آموزشی</b>', ''];
  for (const course of courses) {
    const enrollment = await enrollmentFor(ctx, course.id);
    const progress = enrollment ? Math.round((enrollment.completed.length / Math.max(1, course.lessons.length)) * 100) : 0;
    lines.push(`<b>${ctx.escape(course.title)}</b>\n${ctx.escape(truncateText(course.description, 120))}\n${fa(course.lessons.length)} درس${enrollment ? ` — پیشرفت ${fa(progress)}٪` : ''}`);
  }
  await ctx.reply(lines.join('\n'), {
    inline: { rows: chunkButtons(courses.map((course) => ({ text: truncateText(course.title, 20), data: `a:course:${course.id}` })), 2).rows },
  });
}

async function renderCourse(ctx: BotContext, courseId: string): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, COURSES, `course_${courseId}`);
  if (!doc) {
    await ctx.reply('دوره پیدا نشد.');
    return;
  }
  const course = doc.data as unknown as Course;
  const enrollment = await enrollmentFor(ctx, courseId);
  const lines = [
    `<b>${ctx.escape(course.title)}</b>`,
    '',
    ctx.escape(course.description),
    '',
    `<b>سرفصل‌ها</b> (${fa(course.lessons.length)} درس)`,
    ...course.lessons.map((lesson, index) => `${enrollment?.completed.includes(index) ? '✓' : '○'} ${fa(index + 1)}. ${ctx.escape(truncateText(lesson.title, 60))}`),
  ];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  if (!enrollment) {
    rows.push([{ text: 'ثبت‌نام در دوره', callbackData: `a:enroll:${courseId}` }]);
  } else {
    const nextIndex = course.lessons.findIndex((_, index) => !enrollment.completed.includes(index));
    rows.push([
      {
        text: nextIndex === -1 ? 'مرور از ابتدا' : `شروع درس ${fa(nextIndex + 1)}`,
        callbackData: `a:lesson:${courseId}:${nextIndex === -1 ? 0 : nextIndex}`,
      },
    ]);
    if (enrollment.finishedAt) {
      rows.push([{ text: 'دریافت گواهی', callbackData: `a:cert:${courseId}` }]);
    }
  }
  rows.push([{ text: 'بازگشت', callbackData: 'a:courses' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function sendLesson(ctx: BotContext, courseId: string, index: number): Promise<void> {
  const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, COURSES, `course_${courseId}`);
  if (!doc) return;
  const course = doc.data as unknown as Course;
  const lesson = course.lessons[index];
  if (!lesson) {
    await ctx.reply('درس پیدا نشد.');
    return;
  }
  const enrollment = await enrollmentFor(ctx, courseId);
  if (!enrollment) {
    await ctx.reply('ابتدا در دوره ثبت‌نام کنید.');
    return;
  }
  await ctx.reply(
    `<b>${ctx.escape(course.title)}</b> — درس ${fa(index + 1)} از ${fa(course.lessons.length)}\n\n<b>${ctx.escape(lesson.title)}</b>\n\n${ctx.escape(lesson.content.slice(0, 3500))}`,
    {
      inline: {
        rows: [
          [{ text: 'این درس را خواندم', callbackData: `a:complete:${courseId}:${index}` }],
          [
            index > 0 ? { text: 'درس قبل', callbackData: `a:lesson:${courseId}:${index - 1}` } : { text: 'فهرست', callbackData: `a:course:${courseId}` },
            index + 1 < course.lessons.length
              ? { text: 'درس بعد', callbackData: `a:lesson:${courseId}:${index + 1}` }
              : { text: 'پایان دوره', callbackData: `a:course:${courseId}` },
          ],
        ],
      },
    },
  );
}

export const courseBot = defineBot({
  id: 'courses',
  name: 'آموزش و دوره',
  category: 'E',
  summary: 'دوره آموزشی چنددرسی با ثبت‌نام، پیشرفت و گواهی پایان',
  description:
    'مدیر دوره می‌سازد (عنوان، توضیح و درس‌ها). کاربر ثبت‌نام می‌کند، درس‌ها را یکی‌یکی می‌خواند و پیشرفت او ذخیره می‌شود. با تکمیل همه درس‌ها گواهی پایان دوره با کد پیگیری صادر می‌شود.',
  icon: 'graduation-cap',
  tags: ['education'],
  commands: [
    { command: 'courses', description: 'فهرست دوره‌ها' },
    { command: 'mycourses', description: 'دوره‌های من' },
    { command: 'newcourse', description: 'دوره جدید (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'courses', label: 'دوره‌ها' },
    { id: 'mycourses', label: 'دوره‌های من' },
    { id: 'newcourse', label: 'دوره جدید', adminOnly: true },
  ],
  defaultConfig: { certificatePrefix: 'BF' },
  actions: {
    courses: async (ctx) => renderCourses(ctx),
    course: async (ctx, param) => {
      if (param) await renderCourse(ctx, param);
    },
    enroll: async (ctx, param) => {
      if (!param) return;
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, COURSES, `course_${param}`);
      if (!doc) return;
      const course = doc.data as unknown as Course;
      const enrollment: Enrollment = {
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        courseId: param,
        completed: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      await saveDoc(
        ctx.storage,
        ctx.bot.id,
        ENROLLMENTS,
        enrollmentKey(ctx.user.id, param),
        enrollment as unknown as Record<string, unknown>,
      );
      await ctx.reply(`در «${ctx.escape(course.title)}» ثبت‌نام شدید.`, {
        inline: { rows: [[{ text: 'شروع درس اول', callbackData: `a:lesson:${param}:0` }]] },
      });
    },
    lesson: async (ctx, param) => {
      const [courseId, indexRaw] = (param ?? '').split(':');
      if (!courseId) return;
      await sendLesson(ctx, courseId, Number(indexRaw) || 0);
    },
    complete: async (ctx, param) => {
      const [courseId, indexRaw] = (param ?? '').split(':');
      const index = Number(indexRaw) || 0;
      if (!courseId) return;
      const enrollment = await enrollmentFor(ctx, courseId);
      if (!enrollment) return;
      if (!enrollment.completed.includes(index)) enrollment.completed.push(index);
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, COURSES, `course_${courseId}`);
      const course = doc ? (doc.data as unknown as Course) : null;
      const total = course?.lessons.length ?? 0;
      const finished = course && enrollment.completed.length >= total;
      if (finished && !enrollment.finishedAt) enrollment.finishedAt = new Date().toISOString();
      await saveDoc(
        ctx.storage,
        ctx.bot.id,
        ENROLLMENTS,
        enrollmentKey(ctx.user.id, courseId),
        enrollment as unknown as Record<string, unknown>,
      );
      const progress = Math.round((enrollment.completed.length / Math.max(1, total)) * 100);
      if (finished) {
        await ctx.reply('دوره کامل شد. پیشرفت شما ۱۰۰٪ است.', {
          inline: { rows: [[{ text: 'دریافت گواهی', callbackData: `a:cert:${courseId}` }]] },
        });
        return;
      }
      await ctx.reply(`پیشرفت شما: ${fa(progress)}٪`, {
        inline: {
          rows: [
            [{ text: 'درس بعد', callbackData: `a:lesson:${courseId}:${index + 1}` }],
            [{ text: 'فهرست دوره', callbackData: `a:course:${courseId}` }],
          ],
        },
      });
    },
    cert: async (ctx, param) => {
      if (!param) return;
      const enrollment = await enrollmentFor(ctx, param);
      const doc = await getDoc<Record<string, unknown>>(ctx.storage, ctx.bot.id, COURSES, `course_${param}`);
      if (!enrollment || !doc) {
        await ctx.reply('گواهی برای این دوره در دسترس نیست.');
        return;
      }
      const course = doc.data as unknown as Course;
      if (!enrollment.finishedAt) {
        await ctx.reply('برای دریافت گواهی ابتدا همه درس‌ها را تکمیل کنید.');
        return;
      }
      const prefix = await ctx.getSetting<string>('certificatePrefix', 'BF');
      const code = `${prefix}-${param.slice(-4).toUpperCase()}-${ctx.user.id.slice(-4).toUpperCase()}`;
      await ctx.reply(
        `<b>گواهی پایان دوره</b>\n\nاین گواهی تأیید می‌کند ${ctx.escape(ctx.user.firstName ?? 'کاربر')} دوره «${ctx.escape(course.title)}» را با موفقیت تکمیل کرده است.\n\n` +
          `کد گواهی: <code>${code}</code>\nتاریخ: ${ctx.formatDate(enrollment.finishedAt)}`,
      );
    },
    mycourses: async (ctx) => {
      const courses = await activeCourses(ctx);
      const items: Array<{ course: Course; enrollment: Enrollment }> = [];
      for (const course of courses) {
        const enrollment = await enrollmentFor(ctx, course.id);
        if (enrollment) items.push({ course, enrollment });
      }
      if (items.length === 0) {
        await ctx.reply('در دوره‌ای ثبت‌نام نکرده‌اید.', { inline: { rows: [[{ text: 'دوره‌ها', callbackData: 'a:courses' }]] } });
        return;
      }
      const lines = ['<b>دوره‌های من</b>', ''];
      const rows: Array<Array<{ text: string; callbackData: string }>> = [];
      for (const item of items) {
        const progress = Math.round((item.enrollment.completed.length / Math.max(1, item.course.lessons.length)) * 100);
        lines.push(`${ctx.escape(item.course.title)} — ${fa(progress)}٪${item.enrollment.finishedAt ? ' (تکمیل‌شده)' : ''}`);
        rows.push([{ text: truncateText(item.course.title, 20), callbackData: `a:course:${item.course.id}` }]);
      }
      await ctx.reply(lines.join('\n'), { inline: { rows } });
    },
    newcourse: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('course_title', {});
      await ctx.reply('عنوان دوره را ارسال کنید:');
    },
  },
  steps: {
    course_title: async (ctx) => {
      await ctx.setFlow('course_description', { title: ctx.text.trim().slice(0, 100) });
      await ctx.reply('توضیح دوره را ارسال کنید:');
    },
    course_description: async (ctx) => {
      await ctx.setFlow('course_lessons', { ...(ctx.flow?.data ?? {}), description: ctx.text.trim().slice(0, 500) });
      await ctx.reply(
        'درس‌ها را به این شکل ارسال کنید:\n<code>عنوان درس | متن درس</code>\nهر درس در یک خط. برای متن چندخطی از کاراکتر | بین عنوان و متن استفاده کنید.',
      );
    },
    course_lessons: async (ctx) => {
      const lessons: Lesson[] = ctx.text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((line) => {
          const [title, ...rest] = line.split('|');
          return {
            title: title.trim().slice(0, 120),
            content: (rest.join('|').trim() || title.trim()).slice(0, 3500),
          };
        });
      if (lessons.length === 0) {
        await ctx.reply('حداقل یک درس لازم است.');
        return;
      }
      const id = Date.now().toString(36);
      const course: Course = {
        id,
        title: String(ctx.flow?.data.title ?? 'دوره'),
        description: String(ctx.flow?.data.description ?? ''),
        lessons,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, COURSES, `course_${id}`, course as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`دوره «${ctx.escape(course.title)}» با ${fa(lessons.length)} درس ساخته شد.`, {
        inline: { rows: [[{ text: 'مشاهده دوره', callbackData: `a:course:${id}` }]] },
      });
    },
  },
  async onStart(ctx) {
    await renderCourses(ctx);
  },
  onText: async (ctx) => {
    await ctx.reply('برای مشاهده دوره‌ها از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'دوره‌ها', callbackData: 'a:courses' }]] },
    });
  },
  async onCommand(ctx, command) {
    if (command === 'courses') {
      await renderCourses(ctx);
      return true;
    }
    if (command === 'mycourses') {
      await courseBot.actions.mycourses(ctx);
      return true;
    }
    if (command === 'newcourse') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('course_title', {});
      await ctx.reply('عنوان دوره را ارسال کنید:');
      return true;
    }
    return false;
  },
});

export type { Course, Enrollment };
export { parseNumberInput as parseCourseNumber };
