import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, upstreamError } from '@botforge/core';
import type { ServiceDeps } from './deps';
import { isEmptyValue } from './deps';
import { NewsService } from './news';

export interface MediaAsset {
  url: string;
  quality?: string;
  type: 'video' | 'audio' | 'image';
  size?: number;
  thumbnail?: string;
}

interface YtDlpFormat {
  url?: string;
  format_id?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  ext?: string;
}

interface YtDlpInfo {
  title?: string;
  url?: string;
  formats?: YtDlpFormat[];
  thumbnail?: string;
}

export class MediaService {
  constructor(private readonly deps: ServiceDeps) {}

  private async providerUrl(): Promise<string> {
    return this.deps.getSetting<string>('MEDIA_API_URL', '');
  }

  private async providerKey(): Promise<string> {
    return this.deps.getSetting<string>('MEDIA_API_KEY', '');
  }

  async available(): Promise<boolean> {
    const url = await this.providerUrl();
    if (!isEmptyValue(url)) return true;
    return await this.hasYtDlp();
  }

  private async hasYtDlp(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('yt-dlp', ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }

  async resolve(rawUrl: string): Promise<MediaAsset[]> {
    const url = rawUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError('BAD_REQUEST', 'لینک وارد شده معتبر نیست');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new AppError('BAD_REQUEST', 'فقط لینک‌های http و https پشتیبانی می‌شوند');
    }

    const providerUrl = await this.providerUrl();
    if (!isEmptyValue(providerUrl)) {
      return this.resolveWithProvider(providerUrl, url);
    }
    if (await this.hasYtDlp()) {
      return this.resolveWithYtDlp(url);
    }
    throw new AppError(
      'NOT_CONFIGURED',
      'سرویس دانلود پیکربندی نشده است. آدرس سرویس دانلود را در تنظیمات ربات (MEDIA_API_URL) وارد کنید یا yt-dlp را روی سرور نصب کنید.',
    );
  }

  private async resolveWithProvider(endpoint: string, url: string): Promise<MediaAsset[]> {
    const apiKey = await this.providerKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (!isEmptyValue(apiKey)) headers.authorization = `Api-Key ${apiKey}`;

    if (/cobalt/i.test(endpoint)) headers.accept = 'application/json';
    const body = /cobalt/i.test(endpoint)
      ? { url, videoQuality: '720', downloadMode: 'auto', filenameStyle: 'basic' }
      : { url: url };

    let response;
    try {
      response = await this.deps.http.post<Record<string, unknown>>(endpoint, body, {
        headers,
        timeoutMs: 30_000,
        retries: 1,
      });
    } catch (error) {
      throw upstreamError('سرویس دانلود پاسخ معتبری نداد', { error: (error as Error).message });
    }

    const payload = response.body ?? {};
    if (payload.status === 'error' || payload.status === 'rate-limit') {
      throw upstreamError(`سرویس دانلود خطا داد: ${String(payload.error ?? payload.status)}`);
    }
    if (payload.status === 'redirect' || payload.status === 'tunnel' || payload.status === 'stream') {
      const target = String(payload.url ?? '');
      if (!target) throw upstreamError('سرویس دانلود فایلی برنگرداند');
      return [{ url: target, type: 'video', quality: String(payload.filename ?? 'best') }];
    }
    if (payload.status === 'picker' && Array.isArray(payload.picker)) {
      return (payload.picker as Array<Record<string, unknown>>)
        .slice(0, 10)
        .map((item): MediaAsset => ({
          url: String(item.url ?? ''),
          type: String(item.type ?? 'video').includes('audio') ? 'audio' : 'video',
          quality: String(item.quality ?? ''),
          thumbnail: String(payload.audio ?? payload.thumbnail ?? '') || undefined,
        }))
        .filter((asset) => asset.url.length > 0);
    }
    if (Array.isArray(payload.assets)) {
      return (payload.assets as Array<Record<string, unknown>>).map((item): MediaAsset => ({
        url: String(item.url ?? ''),
        type: (String(item.type ?? 'video') as MediaAsset['type']),
        quality: String(item.quality ?? ''),
        size: Number(item.size ?? 0) || undefined,
        thumbnail: String(payload.thumbnail ?? '') || undefined,
      })).filter((asset) => asset.url.length > 0);
    }
    if (typeof payload.url === 'string') {
      return [{ url: payload.url, type: 'video', quality: String(payload.quality ?? '') }];
    }
    throw upstreamError('ساختار پاسخ سرویس دانلود ناشناخته است');
  }

  private async resolveWithYtDlp(url: string): Promise<MediaAsset[]> {
    const info = await new Promise<YtDlpInfo>((resolve, reject) => {
      const child = spawn('yt-dlp', ['-J', '--no-warnings', '--no-playlist', url], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(upstreamError('زمان استخراج لینک دانلود به پایان رسید'));
      }, 45_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > 6_000_000) child.kill('SIGKILL');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString().slice(0, 2000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(upstreamError('اجرای yt-dlp ممکن نشد', { error: error.message }));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(upstreamError('استخراج لینک دانلود ناموفق بود', { error: stderr.slice(0, 300) }));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as YtDlpInfo);
        } catch {
          reject(upstreamError('پاسخ yt-dlp قابل خواندن نبود'));
        }
      });
    });

    const assets: MediaAsset[] = [];
    const formats = (info.formats ?? []).filter((format) => Boolean(format.url));
    const videoFormats = formats
      .filter((format) => format.vcodec && format.vcodec !== 'none')
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      .slice(0, 6);
    for (const format of videoFormats) {
      assets.push({
        url: String(format.url),
        type: 'video',
        quality: format.height ? `${format.height}p` : format.format_id ?? 'video',
        size: format.filesize,
        thumbnail: info.thumbnail,
      });
    }
    const audioFormats = formats
      .filter((format) => (!format.vcodec || format.vcodec === 'none') && format.acodec && format.acodec !== 'none')
      .slice(0, 3);
    for (const format of audioFormats) {
      assets.push({
        url: String(format.url),
        type: 'audio',
        quality: format.format_id ?? 'audio',
        size: format.filesize,
        thumbnail: info.thumbnail,
      });
    }
    if (assets.length === 0 && info.url) {
      assets.push({ url: info.url, type: 'video', quality: 'best', thumbnail: info.thumbnail });
    }
    if (assets.length === 0) throw upstreamError('هیچ فایل قابل دانلودی پیدا نشد');
    return assets;
  }

  async downloadToTemp(asset: MediaAsset): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'botforge-media-'));
    const file = await this.deps.http.download(asset.url, { timeoutMs: 120_000 });
    if (file.data.byteLength > 48 * 1024 * 1024) {
      await rm(dir, { recursive: true, force: true });
      throw upstreamError('حجم فایل بیش از ۴۸ مگابایت است و ارسال آن از طریق پیام‌رسان ممکن نیست');
    }
    const path = join(dir, sanitizeFileName(file.fileName ?? `media-${Date.now()}.bin`));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, file.data);
    return { path, cleanup: async () => rm(dir, { recursive: true, force: true }) };
  }

  async summarizeUrl(url: string): Promise<{ title: string; text: string; siteName: string; url: string }> {
    const news = new NewsService(this.deps);
    return news.fetchArticle(url, 8000);
  }
}

export function sanitizeFileName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 120)
    .trim() || 'file';
}
