import { z } from 'zod';

export const platformSchema = z.enum(['telegram', 'bale', 'rubika']);

export const botTokenSchema = z
  .string()
  .trim()
  .min(20, 'توکن ربات معتبر نیست')
  .max(200, 'توکن ربات بیش از حد طولانی است')
  .regex(/^[A-Za-z0-9:_-]+$/, 'توکن ربات شامل کاراکترهای غیرمجاز است');

export const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'شناسه فقط می‌تواند شامل حروف کوچک، رقم و خط تیره باشد');

export const emailSchema = z.string().trim().toLowerCase().email();

export const passwordSchema = z
  .string()
  .min(10, 'رمز عبور باید حداقل ۱۰ کاراکتر باشد')
  .max(128)
  .regex(/[a-z]/, 'رمز عبور باید شامل حرف کوچک باشد')
  .regex(/[A-Z]/, 'رمز عبور باید شامل حرف بزرگ باشد')
  .regex(/[0-9]/, 'رمز عبور باید شامل رقم باشد');

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'فقط آدرس‌های http/https مجاز هستند');

export const chatIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^-?[A-Za-z0-9_@-]+$/, 'شناسه گفتگو نامعتبر است');

export const createBotSchema = z.object({
  templateId: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(64),
  slug: slugSchema,
  platform: platformSchema,
  token: botTokenSchema,
  config: z.record(z.unknown()).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const broadcastSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  parseMode: z.enum(['HTML', 'Markdown']).optional(),
  onlyActive: z.boolean().optional(),
});

export const forceMembershipSchema = z.object({
  enabled: z.boolean(),
  channels: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        platform: platformSchema,
        chatId: chatIdSchema,
        title: z.string().trim().min(1).max(120),
        inviteLink: z.string().trim().url().max(512).optional(),
        required: z.boolean(),
      }),
    )
    .max(10),
  message: z.string().trim().min(1).max(1000),
  buttonLabel: z.string().trim().min(1).max(40),
  recheckLabel: z.string().trim().min(1).max(40),
  bypassAdmins: z.boolean(),
  cacheSeconds: z.number().int().min(0).max(86_400),
});

export function sanitizeText(input: string, maxLength = 4096): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .slice(0, maxLength)
    .trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHtml(input: string): string {
  return sanitizeText(input.replace(/<[^>]*>/g, ''));
}

export function normalizeDigits(input: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  return input.replace(/[۰-۹٠-٩]/g, (char) => {
    const p = persian.indexOf(char);
    if (p >= 0) return String(p);
    const a = arabic.indexOf(char);
    return a >= 0 ? String(a) : char;
  });
}

export function parseAmount(input: string): number | null {
  const normalized = normalizeDigits(input)
    .replace(/[,\s_]/g, '')
    .replace(/تومان|ریال|درهم|دلار|یورو/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
