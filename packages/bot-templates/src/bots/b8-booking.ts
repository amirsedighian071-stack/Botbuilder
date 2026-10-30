import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  fa,
  getDoc,
  listDocs,
  parseJalaliDate,
  parseNumberInput,
  parseTimeOfDay,
  requireAdmin,
  saveDoc,
  statusLabel,
  truncateText,
} from '../kit';

interface Service {
  id: string;
  title: string;
  durationMinutes: number;
  capacity: number;
  startHour: number;
  endHour: number;
  slotMinutes: number;
  price: number;
  active: boolean;
}

interface Booking {
  id: string;
  code: number;
  serviceId: string;
  serviceTitle: string;
  userId: string;
  chatId: string;
  customerName: string;
  phone: string;
  date: string;
  time: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'done';
  createdAt: string;
  remindAt: string | null;
}

const SERVICES = 'services';
const BOOKINGS = 'bookings';

function defaultServices(): Service[] {
  return [
    {
      id: 'svc_default',
      title: 'مشاوره عمومی',
      durationMinutes: 30,
      capacity: 3,
      startHour: 9,
      endHour: 17,
      slotMinutes: 30,
      price: 0,
      active: true,
    },
  ];
}

async function getServices(ctx: BotContext): Promise<Service[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, SERVICES, 1, 100, 'asc');
  const services = result.items.map((item) => item.data as unknown as Service).filter((service) => service.active);
  return services.length > 0 ? services : defaultServices();
}

function slotList(service: Service): string[] {
  const slots: string[] = [];
  for (let minutes = service.startHour * 60; minutes + service.slotMinutes <= service.endHour * 60; minutes += service.slotMinutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return slots;
}

async function bookedCount(ctx: BotContext, serviceId: string, date: string, time: string): Promise<number> {
  const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
  return result.items.filter((item) => {
    const booking = item.data as unknown as Booking;
    return (
      booking.serviceId === serviceId &&
      booking.date === date &&
      booking.time === time &&
      booking.status !== 'cancelled'
    );
  }).length;
}

async function renderServices(ctx: BotContext): Promise<void> {
  const services = await getServices(ctx);
  const lines = ['<b>خدمات قابل رزرو</b>', ''];
  for (const service of services) {
    lines.push(
      `<b>${ctx.escape(service.title)}</b>\nمدت: ${fa(service.durationMinutes)} دقیقه | ظرفیت هر نوبت: ${fa(service.capacity)} نفر | ساعت کاری: ${fa(service.startHour)} تا ${fa(service.endHour)}${service.price > 0 ? ` | هزینه: ${ctx.formatMoney(service.price)}` : ''}`,
    );
    lines.push('');
  }
  const rows = chunkButtons(services.map((service) => ({ text: truncateText(service.title, 20), data: `a:svc:${service.id}` })), 2).rows;
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderMyBookings(ctx: BotContext): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 200);
  const bookings = result.items
    .map((item) => item.data as unknown as Booking)
    .filter((booking) => (ctx.isAdmin ? true : booking.userId === ctx.user.id))
    .sort((a, b) => b.code - a.code);
  if (bookings.length === 0) {
    await ctx.reply('نوبتی ثبت نشده است.', { inline: { rows: [[{ text: 'رزرو نوبت', callbackData: 'a:services' }]] } });
    return;
  }
  const lines = ['<b>نوبت‌ها</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const booking of bookings.slice(0, 8)) {
    lines.push(
      `#${fa(booking.code)} — ${ctx.escape(booking.serviceTitle)}\n${ctx.escape(booking.date)} ساعت ${fa(booking.time)} — ${statusLabel(booking.status)}`,
    );
    rows.push([
      { text: `جزئیات #${fa(booking.code)}`, callbackData: `a:booking:${booking.code}` },
    ]);
  }
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderBooking(ctx: BotContext, code: number): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
  const entry = result.items.find((item) => (item.data as unknown as Booking).code === code);
  if (!entry) {
    await ctx.reply('نوبت پیدا نشد.');
    return;
  }
  const booking = entry.data as unknown as Booking;
  if (!ctx.isAdmin && booking.userId !== ctx.user.id) {
    await ctx.reply('این نوبت به شما تعلق ندارد.');
    return;
  }
  const lines = [
    `<b>نوبت #${fa(booking.code)}</b>`,
    '',
    `خدمت: ${ctx.escape(booking.serviceTitle)}`,
    `تاریخ: ${ctx.escape(booking.date)}`,
    `ساعت: ${fa(booking.time)}`,
    `وضعیت: ${statusLabel(booking.status)}`,
    `نام: ${ctx.escape(booking.customerName)}`,
    `تلفن: ${ctx.escape(booking.phone)}`,
  ];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  if (booking.status !== 'cancelled') {
    rows.push([{ text: 'لغو نوبت', callbackData: `a:cancelbooking:${booking.code}` }]);
  }
  if (ctx.isAdmin && booking.status === 'pending') {
    rows.push([{ text: 'تأیید نوبت', callbackData: `a:confirmbooking:${booking.code}` }]);
  }
  if (ctx.isAdmin && booking.status !== 'done' && booking.status !== 'cancelled') {
    rows.push([{ text: 'ثبت انجام‌شده', callbackData: `a:donebooking:${booking.code}` }]);
  }
  rows.push([{ text: 'بازگشت', callbackData: 'a:mybookings' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const bookingBot = defineBot({
  id: 'booking',
  name: 'رزرو و نوبت‌دهی',
  category: 'B',
  summary: 'رزرو نوبت بر اساس خدمت، تاریخ و ساعت با کنترل ظرفیت و یادآوری',
  description:
    'مدیر خدمات را با مدت، ظرفیت و ساعت کاری تعریف می‌کند. کاربر خدمت، تاریخ شمسی و ساعت را انتخاب می‌کند؛ ظرفیت هر نوبت کنترل می‌شود. نوبت ثبت‌شده با شماره پیگیری ذخیره می‌شود و یادآوری خودکار پیش از موعد ارسال می‌گردد. لغو، تأیید و ثبت انجام از پنل انجام می‌شود.',
  icon: 'calendar-check',
  tags: ['booking', 'commerce'],
  commands: [
    { command: 'reserve', description: 'رزرو نوبت' },
    { command: 'mybookings', description: 'نوبت‌های من' },
    { command: 'addservice', description: 'تعریف خدمت (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'services', label: 'رزرو نوبت' },
    { id: 'mybookings', label: 'نوبت‌های من' },
    { id: 'addservice', label: 'تعریف خدمت', adminOnly: true },
  ],
  defaultConfig: { remindMinutesBefore: 60 },
  actions: {
    services: async (ctx) => renderServices(ctx),
    svc: async (ctx, param) => {
      if (!param) return;
      const services = await getServices(ctx);
      const service = services.find((item) => item.id === param);
      if (!service) {
        await ctx.reply('خدمت پیدا نشد.');
        return;
      }
      await ctx.setFlow('booking_date', { serviceId: service.id, serviceTitle: service.title });
      await ctx.reply(`خدمت «${ctx.escape(service.title)}» انتخاب شد.\nتاریخ را به شمسی وارد کنید. نمونه: <code>1404-08-15</code>`);
    },
    slot: async (ctx, param) => {
      const data = ctx.flow?.data ?? {};
      if (!param || !data.date) {
        await ctx.reply('اطلاعات ناقص است.');
        return;
      }
      await ctx.setFlow('booking_name', { ...data, time: param });
      await ctx.reply('نام و نام خانوادگی خود را وارد کنید:');
    },
    mybookings: async (ctx) => renderMyBookings(ctx),
    booking: async (ctx, param) => renderBooking(ctx, Number(param) || 0),
    cancelbooking: async (ctx, param) => {
      const code = Number(param) || 0;
      const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
      const entry = result.items.find((item) => (item.data as unknown as Booking).code === code);
      if (!entry) {
        await ctx.reply('نوبت پیدا نشد.');
        return;
      }
      const booking = entry.data as unknown as Booking;
      if (!ctx.isAdmin && booking.userId !== ctx.user.id) {
        await ctx.reply('این نوبت به شما تعلق ندارد.');
        return;
      }
      const updated: Booking = { ...booking, status: 'cancelled' };
      await saveDoc(ctx.storage, ctx.bot.id, BOOKINGS, `booking_${code}`, updated as unknown as Record<string, unknown>);
      await ctx.reply(`نوبت #${fa(code)} لغو شد.`);
      if (!ctx.isAdmin) {
        await ctx.notifyAdmin(`لغو نوبت #${fa(code)}\n${ctx.escape(booking.serviceTitle)} — ${ctx.escape(booking.date)} ${fa(booking.time)}`);
      }
    },
    confirmbooking: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const code = Number(param) || 0;
      const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
      const entry = result.items.find((item) => (item.data as unknown as Booking).code === code);
      if (!entry) {
        await ctx.reply('نوبت پیدا نشد.');
        return;
      }
      const booking: Booking = { ...(entry.data as unknown as Booking), status: 'confirmed' };
      await saveDoc(ctx.storage, ctx.bot.id, BOOKINGS, `booking_${code}`, booking as unknown as Record<string, unknown>);
      await ctx.api.sendMessage(booking.chatId, {
        text: `نوبت #${fa(code)} شما تأیید شد.\n${ctx.escape(booking.serviceTitle)} — ${ctx.escape(booking.date)} ساعت ${fa(booking.time)}`,
        parseMode: 'HTML',
      });
      await renderBooking(ctx, code);
    },
    donebooking: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const code = Number(param) || 0;
      const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
      const entry = result.items.find((item) => (item.data as unknown as Booking).code === code);
      if (!entry) {
        await ctx.reply('نوبت پیدا نشد.');
        return;
      }
      const booking: Booking = { ...(entry.data as unknown as Booking), status: 'done' };
      await saveDoc(ctx.storage, ctx.bot.id, BOOKINGS, `booking_${code}`, booking as unknown as Record<string, unknown>);
      await ctx.reply(`نوبت #${fa(code)} انجام‌شده ثبت شد.`);
    },
    addservice: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('service_title', {});
      await ctx.reply('عنوان خدمت را ارسال کنید:');
    },
  },
  steps: {
    booking_date: async (ctx) => {
      const date = parseJalaliDate(ctx.text);
      if (!date) {
        await ctx.reply('تاریخ نامعتبر است. نمونه: <code>1404-08-15</code>');
        return;
      }
      const iso = date.toISOString().slice(0, 10);
      if (date.getTime() < Date.now() - 86_400_000) {
        await ctx.reply('تاریخ گذشته قابل انتخاب نیست.');
        return;
      }
      const data = ctx.flow?.data ?? {};
      const services = await getServices(ctx);
      const service = services.find((item) => item.id === data.serviceId);
      if (!service) {
        await ctx.clearFlow();
        await ctx.reply('خدمت پیدا نشد.');
        return;
      }
      const slots = slotList(service);
      const available: Array<{ text: string; callbackData: string }> = [];
      for (const slot of slots) {
        const count = await bookedCount(ctx, service.id, iso, slot);
        if (count < service.capacity) available.push({ text: slot, callbackData: `a:slot:${slot}` });
      }
      if (available.length === 0) {
        await ctx.reply('برای این تاریخ ظرفیت خالی نیست. تاریخ دیگری انتخاب کنید.');
        return;
      }
      await ctx.setFlow('booking_slot', { ...data, date: iso });
      await ctx.reply(`ساعت‌های خالی ${ctx.escape(iso)}:`, {
        inline: { rows: chunkButtons(available.map((item) => ({ text: item.text, data: item.callbackData })), 3).rows },
      });
    },
    booking_name: async (ctx) => {
      await ctx.setFlow('booking_phone', { ...(ctx.flow?.data ?? {}), customerName: ctx.text.trim().slice(0, 80) });
      await ctx.reply('شماره تماس خود را وارد کنید:');
    },
    booking_phone: async (ctx) => {
      const phone = ctx.text.replace(/[^\d+]/g, '');
      const data = ctx.flow?.data ?? {};
      if (phone.length < 8) {
        await ctx.reply('شماره تماس معتبر نیست.');
        return;
      }
      const services = await getServices(ctx);
      const service = services.find((item) => item.id === data.serviceId);
      if (!service) {
        await ctx.clearFlow();
        await ctx.reply('خدمت پیدا نشد.');
        return;
      }
      const result = await listDocs(ctx.storage, ctx.bot.id, BOOKINGS, 1, 500);
      const codes = result.items.map((item) => (item.data as unknown as Booking).code ?? 0);
      const code = (codes.length > 0 ? Math.max(...codes) : 0) + 1;
      const date = String(data.date ?? '');
      const time = String(data.time ?? '00:00');
      const [hour, minute] = time.split(':').map(Number);
      const target = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
      const remindBefore = await ctx.getSetting<number>('remindMinutesBefore', 60);
      const booking: Booking = {
        id: `b_${code}`,
        code,
        serviceId: service.id,
        serviceTitle: service.title,
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        customerName: String(data.customerName ?? '-'),
        phone,
        date,
        time,
        status: 'pending',
        createdAt: new Date().toISOString(),
        remindAt: new Date(target.getTime() - Number(remindBefore) * 60_000).toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, BOOKINGS, `booking_${code}`, booking as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(
        `<b>نوبت شما ثبت شد</b>\n\nشماره پیگیری: #${fa(code)}\n${ctx.escape(service.title)}\n${ctx.escape(date)} ساعت ${fa(time)}\n\n` +
          'پیش از موعد یادآوری ارسال می‌شود.',
        { inline: { rows: [[{ text: 'نوبت‌های من', callbackData: 'a:mybookings' }]] } },
      );
      await ctx.notifyAdmin(
        `نوبت جدید #${fa(code)}\n${ctx.escape(service.title)}\n${ctx.escape(date)} ${fa(time)}\n${ctx.escape(booking.customerName)} — ${ctx.escape(phone)}`,
      );
      if (target.getTime() > Date.now()) {
        await ctx.enqueue('booking.remind', { code }, new Date(target.getTime() - Number(remindBefore) * 60_000));
      }
    },
    service_title: async (ctx) => {
      await ctx.setFlow('service_duration', { title: ctx.text.trim().slice(0, 60) });
      await ctx.reply('مدت هر نوبت را به دقیقه وارد کنید. نمونه: <code>30</code>');
    },
    service_duration: async (ctx) => {
      const duration = parseNumberInput(ctx.text);
      if (duration === null || duration < 5) {
        await ctx.reply('مدت نامعتبر است.');
        return;
      }
      await ctx.setFlow('service_capacity', { ...(ctx.flow?.data ?? {}), durationMinutes: duration });
      await ctx.reply('ظرفیت هر نوبت (تعداد نفر) را وارد کنید:');
    },
    service_capacity: async (ctx) => {
      const capacity = parseNumberInput(ctx.text);
      if (capacity === null || capacity < 1) {
        await ctx.reply('ظرفیت نامعتبر است.');
        return;
      }
      await ctx.setFlow('service_hours', { ...(ctx.flow?.data ?? {}), capacity });
      await ctx.reply('ساعت کاری را به شکل <code>9-17</code> وارد کنید:');
    },
    service_hours: async (ctx) => {
      const match = ctx.text.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (!match) {
        await ctx.reply('قالب ساعت کاری نامعتبر است. نمونه: <code>9-17</code>');
        return;
      }
      const startHour = Number(match[1]);
      const endHour = Number(match[2]);
      if (startHour < 0 || endHour > 24 || endHour <= startHour) {
        await ctx.reply('بازه ساعت کاری نامعتبر است.');
        return;
      }
      const data = ctx.flow?.data ?? {};
      const id = `svc_${Date.now().toString(36)}`;
      const service: Service = {
        id,
        title: String(data.title ?? 'خدمت'),
        durationMinutes: Number(data.durationMinutes ?? 30),
        capacity: Number(data.capacity ?? 1),
        startHour,
        endHour,
        slotMinutes: Number(data.durationMinutes ?? 30),
        price: 0,
        active: true,
      };
      await saveDoc(ctx.storage, ctx.bot.id, SERVICES, id, service as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`خدمت «${ctx.escape(service.title)}» با موفقیت تعریف شد.`, {
        inline: { rows: [[{ text: 'خدمات', callbackData: 'a:services' }]] },
      });
    },
  },
  jobs: {
    'booking.remind': async (job) => {
      const code = Number(job.payload.code ?? 0);
      if (!code) return;
      const doc = await job.storage.documents.findByKey(job.bot.id, BOOKINGS, `booking_${code}`);
      if (!doc) return;
      const booking = doc.data as unknown as Booking;
      if (booking.status === 'cancelled' || booking.status === 'done') return;
      await job.send(
        booking.chatId,
        `<b>یادآوری نوبت</b>\n\nنوبت #${fa(code)} شما:\n${booking.serviceTitle}\n${booking.date} ساعت ${booking.time}\n\nبرای لغو از منوی «نوبت‌های من» استفاده کنید.`,
        { rows: [[{ text: 'نوبت‌های من', callbackData: 'a:mybookings' }]] },
      );
    },
  },
  async onCommand(ctx, command) {
    if (command === 'reserve') {
      await renderServices(ctx);
      return true;
    }
    if (command === 'mybookings') {
      await renderMyBookings(ctx);
      return true;
    }
    if (command === 'addservice') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('service_title', {});
      await ctx.reply('عنوان خدمت را ارسال کنید:');
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await ctx.reply('<b>رزرو نوبت</b>\n\nبرای رزرو، خدمت مورد نظر را انتخاب کنید.', {
      inline: {
        rows: [
          [{ text: 'خدمات', callbackData: 'a:services' }],
          [{ text: 'نوبت‌های من', callbackData: 'a:mybookings' }],
        ],
      },
    });
  },
  onText: async (ctx) => {
    const time = parseTimeOfDay(ctx.text);
    if (time) {
      await ctx.reply(`ساعت ${fa(ctx.text.trim())} ذخیره نشد؛ ابتدا خدمت را انتخاب کنید.`, {
        inline: { rows: [[{ text: 'خدمات', callbackData: 'a:services' }]] },
      });
      return;
    }
    await ctx.reply('برای رزرو از منو استفاده کنید.', {
      inline: { rows: [[{ text: 'خدمات', callbackData: 'a:services' }]] },
    });
  },
});

export type { Booking, Service };
export { getDoc as getBookingDoc };
