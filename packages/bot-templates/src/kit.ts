import { createHmac } from 'node:crypto';
import {
  AppError,
  randomToken,
  toPersianDigits,
  type BotContext,
  type BotDefinition,
  type DocumentRecord,
  type InlineKeyboard,
  type Paginated,
  type Storage,
} from '@botforge/core';

export { formatBytes, formatDuration, formatMoney, formatNumber } from '@botforge/core';

export const fa = (value: string | number): string => toPersianDigits(String(value));

export type BotDefinitionInput = Omit<
  BotDefinition,
  'version' | 'tags' | 'requirements' | 'defaultConfig' | 'actions' | 'steps' | 'commands' | 'menu'
> &
  Partial<
    Pick<BotDefinition, 'version' | 'tags' | 'requirements' | 'defaultConfig' | 'actions' | 'steps' | 'commands' | 'menu'>
  >;

export function defineBot(definition: BotDefinitionInput): BotDefinition {
  return {
    version: '1.0.0',
    tags: [],
    requirements: [],
    defaultConfig: {},
    actions: {},
    steps: {},
    commands: [],
    menu: [],
    ...definition,
  };
}

export interface DocHandle<T> {
  id: string | null;
  key: string;
  data: T;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getDoc<T extends Record<string, unknown>>(
  storage: Storage,
  botId: string,
  collection: string,
  key: string,
): Promise<DocHandle<T> | null> {
  const record = await storage.documents.findByKey(botId, collection, key);
  if (!record) return null;
  return {
    id: record.id,
    key: record.key,
    data: record.data as T,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function saveDoc<T extends Record<string, unknown>>(
  storage: Storage,
  botId: string,
  collection: string,
  key: string,
  data: T,
): Promise<DocumentRecord> {
  return storage.documents.upsert({ botId, collection, key, data });
}

export async function deleteDoc(storage: Storage, botId: string, collection: string, key: string): Promise<boolean> {
  return storage.documents.deleteByKey(botId, collection, key);
}

export async function listDocs<T extends Record<string, unknown>>(
  storage: Storage,
  botId: string,
  collection: string,
  page = 1,
  pageSize = 10,
  direction: 'asc' | 'desc' = 'desc',
): Promise<Paginated<DocumentRecord>> {
  const result = await storage.documents.list(botId, collection, { page, pageSize, direction });
  return result as unknown as Paginated<DocumentRecord>;
}

export async function nextSequence(ctx: BotContext, name: string): Promise<number> {
  const current = await getDoc<{ value: number }>(ctx.storage, ctx.bot.id, 'counters', name);
  const next = (current?.data.value ?? 0) + 1;
  await saveDoc(ctx.storage, ctx.bot.id, 'counters', name, { value: next });
  return next;
}

export function chunkButtons(
  items: Array<{ text: string; data: string }>,
  perRow = 2,
): InlineKeyboard {
  const rows: InlineKeyboard['rows'] = [];
  for (let index = 0; index < items.length; index += perRow) {
    rows.push(items.slice(index, index + perRow).map((item) => ({ text: item.text, callbackData: item.data })));
  }
  return { rows };
}

export function paginationRow(
  prefix: string,
  page: number,
  totalPages: number,
  back = 'a:__menu',
): Array<{ text: string; callbackData: string }> {
  const row: Array<{ text: string; callbackData: string }> = [];
  if (page > 1) row.push({ text: 'قبلی', callbackData: `${prefix}:${page - 1}` });
  row.push({ text: `صفحه ${fa(page)} از ${fa(Math.max(1, totalPages))}`, callbackData: `${prefix}:${page}` });
  if (page < totalPages) row.push({ text: 'بعدی', callbackData: `${prefix}:${page + 1}` });
  row.push({ text: 'منوی اصلی', callbackData: back });
  return row;
}

export async function requireAdmin(ctx: BotContext): Promise<boolean> {
  if (ctx.isAdmin) return true;
  await ctx.reply('این بخش فقط برای مدیران ربات در دسترس است.');
  return false;
}

export function parseNumberInput(input: string): number | null {
  const normalized = input
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)))
    .replace(/[,\s_]/g, '')
    .replace(/تومان|ریال|تومان‌|ت$/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseDuration(input: string): number | null {
  const normalized = input
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .trim()
    .toLowerCase();
  const match = normalized.match(/^(\d+)\s*(ثانیه|دقیقه|ساعت|روز|s|m|h|d)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] ?? 'دقیقه';
  const multipliers: Record<string, number> = {
    ثانیه: 1000,
    دقیقه: 60_000,
    ساعت: 3_600_000,
    روز: 86_400_000,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (multipliers[unit] ?? 60_000);
}

export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const normalized = input
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function parseJalaliDate(input: string): Date | null {
  const normalized = input
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/\//g, '-')
    .trim();
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [jy, jm, jd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  return jalaliToGregorian(jy, jm, jd);
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  const gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let jy2 = jy + 1595;
  let days =
    -355668 +
    365 * jy2 +
    Math.floor(jy2 / 33) * 8 +
    Math.floor(((jy2 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  if (isLeap) gDaysInMonth[1] = 29;
  let gm = 0;
  while (gd > gDaysInMonth[gm]) {
    gd -= gDaysInMonth[gm];
    gm += 1;
  }
  jy2 = gy;
  return new Date(Date.UTC(gy, gm, gd, 12, 0, 0));
}

export function todayJalaliLabel(): string {
  return new Intl.DateTimeFormat('fa-IR', { calendar: 'persian', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function truncateText(input: string, max: number): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}

export interface TempMedia {
  url: string;
  fileName: string;
}

export function buildMediaSignature(name: string, secret: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${name}:${expiresAt}`).digest('base64url').slice(0, 32);
}

export function mediaToken(name: string, secret: string, ttlSeconds = 3600): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${expiresAt}.${buildMediaSignature(name, secret, expiresAt)}`;
}

export function verifyMediaToken(name: string, token: string, secret: string): boolean {
  const [expiresRaw, signature] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const expected = buildMediaSignature(name, secret, expiresAt);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

export interface MediaPublishConfig {
  mediaDir: string;
  publicBaseUrl: string;
  secret: string;
}

export function mediaConfig(ctx: BotContext): MediaPublishConfig {
  return {
    mediaDir: ctx.config.MEDIA_DIR ?? '.data/media',
    publicBaseUrl: ctx.config.PUBLIC_BASE_URL,
    secret: ctx.config.SECRET_MASTER_KEY,
  };
}

export async function publishTempMedia(
  data: Uint8Array,
  extension: string,
  config: { mediaDir: string; publicBaseUrl: string; secret: string },
): Promise<TempMedia> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(config.mediaDir, { recursive: true });
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const fileName = `${randomToken(12, 'hex')}.${safeExtension}`;
  await writeFile(join(config.mediaDir, fileName), data);
  const token = mediaToken(fileName, config.secret);
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return { url: `${base}/media/${fileName}?token=${encodeURIComponent(token)}`, fileName };
}

export async function ffmpegConvert(input: {
  data: Uint8Array;
  inputExtension: string;
  outputExtension: string;
  args?: string[];
}): Promise<Uint8Array> {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'botforge-ffmpeg-'));
  const inputPath = join(dir, `input.${input.inputExtension}`);
  const outputPath = join(dir, `output.${input.outputExtension}`);
  try {
    await writeFile(inputPath, input.data);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...(input.args ?? []), outputPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new AppError('UPSTREAM_ERROR', 'پردازش رسانه زمان‌بر شد و متوقف شد'));
      }, 120_000);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString().slice(0, 3000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new AppError('NOT_CONFIGURED', `ابزار ffmpeg در دسترس نیست: ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new AppError('UPSTREAM_ERROR', `تبدیل فایل ناموفق بود: ${stderr.slice(0, 200)}`));
      });
    });
    const output = await readFile(outputPath);
    return new Uint8Array(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function hasFfmpeg(): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function fetchAttachmentFile(
  ctx: BotContext,
  meta: { fileId?: string; fileName?: string; mimeType?: string },
): Promise<{ data: Uint8Array; extension: string; fileUrl: string } | null> {
  if (!meta.fileId) return null;
  const fileUrl = await ctx.api.getFileUrl(meta.fileId);
  if (!fileUrl) return null;
  const file = await ctx.services.files.download(fileUrl);
  const limitMb = ctx.config.MAX_UPLOAD_MB ?? 48;
  if (file.data.byteLength > limitMb * 1024 * 1024) {
    throw new AppError('VALIDATION', `حجم فایل بیش از ${limitMb} مگابایت است`);
  }
  return {
    data: file.data,
    extension: detectExtension(meta.fileName ?? file.fileName ?? undefined, meta.mimeType ?? file.contentType),
    fileUrl,
  };
}

export function detectExtension(fileName?: string, mimeType?: string): string {
  if (fileName && /\.[a-z0-9]{2,5}$/i.test(fileName)) {
    return fileName.split('.').pop()?.toLowerCase() ?? 'bin';
  }
  const mime = (mimeType ?? '').toLowerCase();
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  for (const [key, extension] of Object.entries(map)) {
    if (mime.includes(key)) return extension;
  }
  return 'bin';
}

export function bulletList(items: string[]): string {
  return items.filter(Boolean).map((item) => `• ${item}`).join('\n');
}

export function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    pending: 'در انتظار',
    paid: 'پرداخت‌شده',
    confirmed: 'تأییدشده',
    shipped: 'ارسال‌شده',
    delivered: 'تحویل‌شده',
    cancelled: 'لغوشده',
    open: 'باز',
    answered: 'پاسخ داده‌شده',
    closed: 'بسته',
    active: 'فعال',
    expired: 'منقضی',
    done: 'انجام‌شده',
    up: 'سالم',
    down: 'قطع',
    new: 'جدید',
    in_progress: 'در حال انجام',
    rejected: 'ردشده',
  };
  return labels[value] ?? value;
}
