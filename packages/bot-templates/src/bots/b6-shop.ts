import type { BotContext } from '@botforge/core';
import {
  chunkButtons,
  defineBot,
  deleteDoc,
  fa,
  getDoc,
  listDocs,
  nextSequence,
  paginationRow,
  parseNumberInput,
  requireAdmin,
  saveDoc,
  statusLabel,
  truncateText,
} from '../kit';

interface Product {
  id: string;
  title: string;
  price: number;
  stock: number;
  description: string;
  category: string;
  active: boolean;
  createdAt: string;
}

interface CartItem {
  productId: string;
  quantity: number;
}

interface Order {
  id: string;
  number: number;
  userId: string;
  chatId: string;
  items: Array<{ productId: string; title: string; price: number; quantity: number }>;
  total: number;
  customerName: string;
  phone: string;
  address: string;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

const PRODUCTS = 'products';
const ORDERS = 'orders';
const carts = (userId: string) => `cart_${userId}`;

async function products(ctx: BotContext): Promise<Product[]> {
  const result = await listDocs(ctx.storage, ctx.bot.id, PRODUCTS, 1, 200, 'asc');
  return result.items.map((item) => item.data as unknown as Product).filter((product) => product.active);
}

async function getCart(ctx: BotContext): Promise<CartItem[]> {
  const doc = await getDoc<{ items: CartItem[] }>(ctx.storage, ctx.bot.id, 'carts', carts(ctx.user.id));
  return doc?.data.items ?? [];
}

async function saveCart(ctx: BotContext, items: CartItem[]): Promise<void> {
  await saveDoc(ctx.storage, ctx.bot.id, 'carts', carts(ctx.user.id), { items, updatedAt: new Date().toISOString() });
}

async function renderCatalog(ctx: BotContext, page = 1): Promise<void> {
  const all = await products(ctx);
  if (all.length === 0) {
    await ctx.reply('در حال حاضر محصولی برای فروش ثبت نشده است.', {
      inline: { rows: [[{ text: 'منوی اصلی', callbackData: 'a:__menu' }]] },
    });
    return;
  }
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = all.slice((current - 1) * pageSize, current * pageSize);
  const lines = ['<b>فروشگاه</b>', ''];
  for (const product of slice) {
    lines.push(`<b>${ctx.escape(product.title)}</b>`);
    lines.push(`${ctx.formatMoney(product.price)} | موجودی: ${fa(product.stock)}`);
    if (product.description) lines.push(truncateText(product.description, 100));
    lines.push('');
  }
  const buttons = slice.map((product) => ({
    text: `${truncateText(product.title, 16)}`,
    data: `a:product:${product.id}`,
  }));
  const rows = chunkButtons(buttons).rows;
  rows.push(paginationRow('a:catalog', current, pages));
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderProduct(ctx: BotContext, productId: string): Promise<void> {
  const doc = await getDoc(ctx.storage, ctx.bot.id, PRODUCTS, productId);
  if (!doc) {
    await ctx.reply('محصول پیدا نشد.');
    return;
  }
  const product = doc.data as unknown as Product;
  const text = [
    `<b>${ctx.escape(product.title)}</b>`,
    '',
    product.description ? ctx.escape(product.description) : '',
    '',
    `قیمت: ${ctx.formatMoney(product.price)}`,
    `موجودی: ${fa(product.stock)}`,
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.reply(text, {
    inline: {
      rows: [
        [
          { text: 'افزودن به سبد', callbackData: `a:addcart:${product.id}` },
          { text: 'بازگشت', callbackData: 'a:catalog:1' },
        ],
      ],
    },
  });
}

async function renderCart(ctx: BotContext): Promise<void> {
  const items = await getCart(ctx);
  if (items.length === 0) {
    await ctx.reply('سبد خرید شما خالی است.', {
      inline: { rows: [[{ text: 'مشاهده محصولات', callbackData: 'a:catalog:1' }]] },
    });
    return;
  }
  const all = await products(ctx);
  const lines = ['<b>سبد خرید</b>', ''];
  let total = 0;
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const item of items) {
    const product = all.find((candidate) => candidate.id === item.productId);
    if (!product) continue;
    const subtotal = product.price * item.quantity;
    total += subtotal;
    lines.push(`${ctx.escape(product.title)} × ${fa(item.quantity)} = ${ctx.formatMoney(subtotal)}`);
    rows.push([
      { text: `کاهش ${truncateText(product.title, 10)}`, callbackData: `a:cartdec:${product.id}` },
      { text: `افزایش`, callbackData: `a:cartadd:${product.id}` },
      { text: `حذف`, callbackData: `a:cartdel:${product.id}` },
    ]);
  }
  lines.push('', `جمع کل: ${ctx.formatMoney(total)}`);
  rows.push([
    { text: 'ثبت سفارش', callbackData: 'a:checkout' },
    { text: 'ادامه خرید', callbackData: 'a:catalog:1' },
  ]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function checkout(ctx: BotContext): Promise<void> {
  const items = await getCart(ctx);
  if (items.length === 0) {
    await ctx.reply('سبد خرید خالی است.', { inline: { rows: [[{ text: 'محصولات', callbackData: 'a:catalog:1' }]] } });
    return;
  }
  await ctx.setFlow('checkout_name', {});
  await ctx.reply('نام و نام خانوادگی خود را وارد کنید:');
}

async function renderOrders(ctx: BotContext, page = 1): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, ORDERS, 1, 200);
  const orders = result.items
    .map((item) => item.data as unknown as Order)
    .filter((order) => (ctx.isAdmin ? true : order.userId === ctx.user.id))
    .sort((a, b) => b.number - a.number);
  if (orders.length === 0) {
    await ctx.reply(ctx.isAdmin ? 'سفارشی ثبت نشده است.' : 'شما سفارشی ثبت نکرده‌اید.', {
      inline: { rows: [[{ text: 'محصولات', callbackData: 'a:catalog:1' }]] },
    });
    return;
  }
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(orders.length / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = orders.slice((current - 1) * pageSize, current * pageSize);
  const lines = ['<b>سفارش‌ها</b>', ''];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  for (const order of slice) {
    lines.push(`#${fa(order.number)} — ${ctx.formatMoney(order.total)} — ${statusLabel(order.status)}`);
    rows.push([{ text: `جزئیات #${fa(order.number)}`, callbackData: `a:order:${order.number}` }]);
  }
  rows.push(paginationRow('a:orders', current, pages));
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

async function renderOrder(ctx: BotContext, number: number): Promise<void> {
  const result = await listDocs(ctx.storage, ctx.bot.id, ORDERS, 1, 200);
  const order = result.items.map((item) => item.data as unknown as Order).find((item) => item.number === number);
  if (!order || (!ctx.isAdmin && order.userId !== ctx.user.id)) {
    await ctx.reply('سفارش پیدا نشد.');
    return;
  }
  const lines = [
    `<b>سفارش #${fa(order.number)}</b>`,
    '',
    ...order.items.map((item) => `${ctx.escape(item.title)} × ${fa(item.quantity)} — ${ctx.formatMoney(item.price * item.quantity)}`),
    '',
    `جمع کل: ${ctx.formatMoney(order.total)}`,
    `وضعیت: ${statusLabel(order.status)}`,
    `مشتری: ${ctx.escape(order.customerName)}`,
    `تلفن: ${ctx.escape(order.phone)}`,
    `آدرس: ${ctx.escape(order.address)}`,
    `تاریخ: ${ctx.formatDateTime(order.createdAt)}`,
  ];
  const rows: Array<Array<{ text: string; callbackData: string }>> = [];
  if (ctx.isAdmin) {
    for (const status of ['confirmed', 'shipped', 'delivered', 'cancelled']) {
      rows.push([{ text: `تغییر به ${statusLabel(status)}`, callbackData: `a:setstatus:${order.number}:${status}` }]);
    }
  }
  rows.push([{ text: 'بازگشت', callbackData: 'a:orders:1' }]);
  await ctx.reply(lines.join('\n'), { inline: { rows } });
}

export const shopBot = defineBot({
  id: 'shop',
  name: 'فروشگاه کامل',
  category: 'B',
  summary: 'کاتالوگ محصول، سبد خرید، ثبت سفارش و مدیریت سفارش‌ها',
  description:
    'فروشگاه کامل داخل پیام‌رسان: مدیر محصولات را با عنوان، قیمت، موجودی و توضیحات اضافه می‌کند؛ کاربر محصولات را می‌بیند، به سبد اضافه می‌کند، سفارش ثبت می‌کند و مدیر وضعیت سفارش را مدیریت می‌کند. موجودی پس از ثبت سفارش کم می‌شود و برای مدیر اطلاع‌رسانی ارسال می‌گردد.',
  icon: 'shopping-bag',
  tags: ['commerce'],
  commands: [
    { command: 'shop', description: 'کاتالوگ محصولات' },
    { command: 'cart', description: 'سبد خرید' },
    { command: 'orders', description: 'سفارش‌های من' },
    { command: 'addproduct', description: 'افزودن محصول (مدیر)', adminOnly: true },
  ],
  menu: [
    { id: 'catalog', label: 'محصولات' },
    { id: 'cart', label: 'سبد خرید' },
    { id: 'orders', label: 'سفارش‌ها' },
    { id: 'addproduct', label: 'افزودن محصول', adminOnly: true },
  ],
  defaultConfig: { currency: 'تومان', minOrder: 0 },
  actions: {
    catalog: async (ctx, param) => renderCatalog(ctx, Number(param) || 1),
    product: async (ctx, param) => {
      if (param) await renderProduct(ctx, param);
    },
    addcart: async (ctx, param) => {
      if (!param) return;
      const items = await getCart(ctx);
      const existing = items.find((item) => item.productId === param);
      if (existing) existing.quantity += 1;
      else items.push({ productId: param, quantity: 1 });
      await saveCart(ctx, items);
      await ctx.reply('به سبد خرید اضافه شد.', {
        inline: {
          rows: [
            [{ text: 'سبد خرید', callbackData: 'a:cart' }],
            [{ text: 'ادامه خرید', callbackData: 'a:catalog:1' }],
          ],
        },
      });
    },
    cart: async (ctx) => renderCart(ctx),
    cartadd: async (ctx, param) => {
      const items = await getCart(ctx);
      const item = items.find((candidate) => candidate.productId === param);
      if (item) item.quantity += 1;
      await saveCart(ctx, items);
      await renderCart(ctx);
    },
    cartdec: async (ctx, param) => {
      const items = await getCart(ctx);
      const item = items.find((candidate) => candidate.productId === param);
      if (item) {
        item.quantity -= 1;
        if (item.quantity <= 0) items.splice(items.indexOf(item), 1);
      }
      await saveCart(ctx, items);
      await renderCart(ctx);
    },
    cartdel: async (ctx, param) => {
      const items = (await getCart(ctx)).filter((candidate) => candidate.productId !== param);
      await saveCart(ctx, items);
      await renderCart(ctx);
    },
    checkout: async (ctx) => checkout(ctx),
    orders: async (ctx, param) => renderOrders(ctx, Number(param) || 1),
    order: async (ctx, param) => renderOrder(ctx, Number(param) || 0),
    setstatus: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      const [numberRaw, status] = (param ?? '').split(':');
      const number = Number(numberRaw);
      const allowed = ['confirmed', 'shipped', 'delivered', 'cancelled'];
      if (!allowed.includes(status) || !number) {
        await ctx.reply('درخواست نامعتبر است.');
        return;
      }
      const result = await listDocs(ctx.storage, ctx.bot.id, ORDERS, 1, 200);
      const record = result.items.find((item) => (item.data as unknown as Order).number === number);
      if (!record) {
        await ctx.reply('سفارش پیدا نشد.');
        return;
      }
      const order = record.data as unknown as Order;
      const updated: Order = { ...order, status: status as Order['status'], updatedAt: new Date().toISOString() };
      await saveDoc(ctx.storage, ctx.bot.id, ORDERS, `order_${order.number}`, updated as unknown as Record<string, unknown>);
      await ctx.reply(`وضعیت سفارش #${fa(order.number)} به «${statusLabel(status)}» تغییر کرد.`);
      await ctx.api.sendMessage(order.chatId, {
        text: `وضعیت سفارش #${fa(order.number)} شما به «${statusLabel(status)}» تغییر کرد.`,
        parseMode: 'HTML',
      });
      await renderOrder(ctx, number);
    },
    addproduct: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      await ctx.setFlow('product_title', {});
      await ctx.reply('عنوان محصول را ارسال کنید:');
    },
    delproduct: async (ctx, param) => {
      if (!(await requireAdmin(ctx))) return;
      if (param) {
        const doc = await getDoc(ctx.storage, ctx.bot.id, PRODUCTS, param);
        if (doc) {
          await saveDoc(ctx.storage, ctx.bot.id, PRODUCTS, param, {
            ...(doc.data as Record<string, unknown>),
            active: false,
          });
        }
      }
      await ctx.reply('محصول غیرفعال شد.', { inline: { rows: [[{ text: 'محصولات', callbackData: 'a:catalog:1' }]] } });
    },
  },
  steps: {
    product_title: async (ctx) => {
      await ctx.setFlow('product_price', { title: ctx.text.trim().slice(0, 80) });
      await ctx.reply('قیمت محصول را به تومان وارد کنید:');
    },
    product_price: async (ctx) => {
      const price = parseNumberInput(ctx.text);
      if (price === null) {
        await ctx.reply('قیمت نامعتبر است. نمونه: <code>250000</code>');
        return;
      }
      await ctx.setFlow('product_stock', { ...(ctx.flow?.data ?? {}), price });
      await ctx.reply('موجودی را وارد کنید:');
    },
    product_stock: async (ctx) => {
      const stock = parseNumberInput(ctx.text);
      if (stock === null) {
        await ctx.reply('موجودی نامعتبر است.');
        return;
      }
      await ctx.setFlow('product_description', { ...(ctx.flow?.data ?? {}), stock });
      await ctx.reply('توضیحات محصول را ارسال کنید یا کلمه «نه» را بفرستید:');
    },
    product_description: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const description = /^(نه|no|skip|-)$/i.test(ctx.text.trim()) ? '' : ctx.text.trim().slice(0, 500);
      const id = `p_${Date.now().toString(36)}`;
      const product: Product = {
        id,
        title: String(data.title ?? 'محصول'),
        price: Number(data.price ?? 0),
        stock: Number(data.stock ?? 0),
        description,
        category: 'عمومی',
        active: true,
        createdAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, PRODUCTS, id, product as unknown as Record<string, unknown>);
      await ctx.clearFlow();
      await ctx.reply(`محصول «${ctx.escape(product.title)}» ثبت شد.`, {
        inline: {
          rows: [
            [{ text: 'مشاهده محصول', callbackData: `a:product:${id}` }],
            [{ text: 'محصولات', callbackData: 'a:catalog:1' }],
          ],
        },
      });
    },
    checkout_name: async (ctx) => {
      await ctx.setFlow('checkout_phone', { name: ctx.text.trim().slice(0, 80) });
      await ctx.reply('شماره تماس خود را وارد کنید:');
    },
    checkout_phone: async (ctx) => {
      const phone = ctx.text.replace(/[^\d+]/g, '');
      if (phone.length < 8) {
        await ctx.reply('شماره تماس معتبر نیست.');
        return;
      }
      await ctx.setFlow('checkout_address', { ...(ctx.flow?.data ?? {}), phone });
      await ctx.reply('آدرس تحویل را وارد کنید:');
    },
    checkout_address: async (ctx) => {
      const data = ctx.flow?.data ?? {};
      const address = ctx.text.trim().slice(0, 300);
      const items = await getCart(ctx);
      if (items.length === 0) {
        await ctx.clearFlow();
        await ctx.reply('سبد خرید خالی است.');
        return;
      }
      const catalog = await products(ctx);
      const orderItems = items
        .map((item) => {
          const product = catalog.find((candidate) => candidate.id === item.productId);
          return product ? { productId: product.id, title: product.title, price: product.price, quantity: item.quantity } : null;
        })
        .filter(Boolean) as Order['items'];
      const total = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const number = await nextSequence(ctx, 'orders');
      const order: Order = {
        id: `o_${number}`,
        number,
        userId: ctx.user.id,
        chatId: ctx.message.chatId,
        items: orderItems,
        total,
        customerName: String(data.name ?? '-'),
        phone: String(data.phone ?? '-'),
        address,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveDoc(ctx.storage, ctx.bot.id, ORDERS, `order_${number}`, order as unknown as Record<string, unknown>);
      for (const item of orderItems) {
        const doc = await getDoc(ctx.storage, ctx.bot.id, PRODUCTS, item.productId);
        if (doc) {
          const product = doc.data as unknown as Product;
          await saveDoc(ctx.storage, ctx.bot.id, PRODUCTS, item.productId, {
            ...(doc.data as Record<string, unknown>),
            stock: Math.max(0, product.stock - item.quantity),
          });
        }
      }
      await deleteDoc(ctx.storage, ctx.bot.id, 'carts', carts(ctx.user.id));
      await ctx.clearFlow();
      await ctx.reply(
        `سفارش #${fa(number)} با موفقیت ثبت شد.\nجمع کل: ${ctx.formatMoney(total)}\n\n` +
          'برای هماهنگی پرداخت با شما تماس گرفته می‌شود.',
        { inline: { rows: [[{ text: 'سفارش‌های من', callbackData: 'a:orders:1' }]] } },
      );
      await ctx.notifyAdmin(
        `سفارش جدید #${fa(number)}\nمبلغ: ${ctx.formatMoney(total)}\nمشتری: ${ctx.escape(String(data.name ?? '-'))}\nتلفن: ${ctx.escape(String(data.phone ?? '-'))}`,
      );
    },
  },
  async onCommand(ctx, command) {
    if (command === 'shop') {
      await renderCatalog(ctx, 1);
      return true;
    }
    if (command === 'cart') {
      await renderCart(ctx);
      return true;
    }
    if (command === 'orders') {
      await renderOrders(ctx, 1);
      return true;
    }
    if (command === 'addproduct') {
      if (!(await requireAdmin(ctx))) return true;
      await ctx.setFlow('product_title', {});
      await ctx.reply('عنوان محصول را ارسال کنید:');
      return true;
    }
    return false;
  },
  async onStart(ctx) {
    await ctx.reply('<b>فروشگاه</b>\n\nمحصولات را ببینید و خرید خود را کامل کنید.', {
      inline: {
        rows: [
          [{ text: 'محصولات', callbackData: 'a:catalog:1' }],
          [
            { text: 'سبد خرید', callbackData: 'a:cart' },
            { text: 'سفارش‌ها', callbackData: 'a:orders:1' },
          ],
        ],
      },
    });
  },
  onText: async (ctx) => {
    await ctx.reply('برای خرید از منوی فروشگاه استفاده کنید.', {
      inline: { rows: [[{ text: 'محصولات', callbackData: 'a:catalog:1' }]] },
    });
  },
});
