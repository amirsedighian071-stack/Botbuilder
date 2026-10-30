import { upstreamError, type AppConfig } from '@botforge/core';
import { TtlCache } from '../util/cache';
import type { ServiceDeps } from './deps';
import { isEmptyValue } from './deps';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  jsonMode?: boolean;
}

export class AiService {
  private readonly cache = new TtlCache<string>(5 * 60_000, 200);

  constructor(private readonly deps: ServiceDeps) {}

  async apiKey(): Promise<string> {
    const configured = await this.deps.getSetting<string>('AI_API_KEY', '');
    return isEmptyValue(configured) ? this.deps.config.AI_API_KEY ?? '' : configured;
  }

  async available(): Promise<boolean> {
    return (await this.apiKey()).length > 0;
  }

  async baseUrl(): Promise<string> {
    const configured = await this.deps.getSetting<string>('AI_BASE_URL', '');
    const base = isEmptyValue(configured) ? this.deps.config.AI_BASE_URL : configured;
    return base.replace(/\/+$/, '');
  }

  async model(): Promise<string> {
    const configured = await this.deps.getSetting<string>('AI_MODEL', '');
    return isEmptyValue(configured) ? this.deps.config.AI_MODEL : configured;
  }

  async chat(messages: ChatMessage[], options: AiOptions = {}): Promise<string> {
    const apiKey = await this.apiKey();
    if (!apiKey) {
      throw upstreamError('سرویس هوش مصنوعی پیکربندی نشده است. کلید AI_API_KEY را در پنل مدیریت ربات تنظیم کنید.');
    }
    const cacheKey = JSON.stringify([messages, options.maxTokens, options.temperature]);
    if (options.temperature === 0) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    const baseUrl = await this.baseUrl();
    const payload: Record<string, unknown> = {
      model: options.model ?? (await this.model()),
      messages,
      max_tokens: options.maxTokens ?? this.deps.config.AI_MAX_TOKENS,
      temperature: options.temperature ?? 0.7,
    };
    if (options.jsonMode) payload.response_format = { type: 'json_object' };

    const response = await this.deps.http.post<{
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    }>(`${baseUrl}/chat/completions`, payload, {
      headers: { authorization: `Bearer ${apiKey}` },
      timeoutMs: 60_000,
      retries: 1,
    });

    const content = response.body?.choices?.[0]?.message?.content;
    if (!content) {
      throw upstreamError('پاسخ نامعتبر از سرویس هوش مصنوعی', {
        error: response.body?.error?.message ?? 'empty completion',
      });
    }
    this.cache.set(cacheKey, content, 120_000);
    return content.trim();
  }

  async complete(prompt: string, system?: string, options: AiOptions = {}): Promise<string> {
    const messages: ChatMessage[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return this.chat(messages, options);
  }

  async translate(text: string, target: string): Promise<string> {
    const system =
      'You are a professional translator. Translate the user text into the target language. ' +
      'Preserve tone, formatting and numbers. Return only the translation without explanations.';
    return this.complete(`Target language: ${target}\n\nText:\n${text}`, system, { temperature: 0.2 });
  }

  async transcribe(audioUrl: string, fileName = 'audio.ogg', language = 'fa'): Promise<string> {
    const apiKey = await this.apiKey();
    if (!apiKey) throw upstreamError('سرویس تبدیل گفتار به متن پیکربندی نشده است');
    const file = await this.deps.http.download(audioUrl, { timeoutMs: 90_000 });
    if (file.data.byteLength > 24 * 1024 * 1024) {
      throw upstreamError('حجم فایل صوتی بیش از حد مجاز (۲۴ مگابایت) است');
    }
    const form = new FormData();
    form.append('file', new Blob([file.data], { type: file.contentType || 'audio/ogg' }), fileName);
    form.append('model', 'whisper-1');
    if (language) form.append('language', language);
    const baseUrl = await this.baseUrl();
    const response = await this.deps.http.request<{ text?: string }>(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      timeoutMs: 120_000,
      retries: 0,
      skipSsrfCheck: true,
    });
    const text = response.body?.text;
    if (!text) throw upstreamError('متنی از فایل صوتی استخراج نشد');
    return text.trim();
  }

  async speech(text: string, voice = 'alloy'): Promise<{ data: Uint8Array; mime: string } | null> {
    const apiKey = await this.apiKey();
    if (!apiKey) return null;
    const baseUrl = await this.baseUrl();
    const response = await this.deps.http.requestBinary(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      json: { model: 'tts-1', input: text.slice(0, 4000), voice },
      timeoutMs: 90_000,
      skipSsrfCheck: true,
    });
    if (!response.ok || response.data.byteLength === 0) return null;
    return { data: response.data, mime: response.contentType || 'audio/mpeg' };
  }

  async json<T>(prompt: string, system: string): Promise<T | null> {
    try {
      const raw = await this.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        { temperature: 0, jsonMode: true },
      );
      const match = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : raw) as T;
    } catch {
      return null;
    }
  }
}

export function createAiService(deps: ServiceDeps, config: AppConfig): AiService {
  return new AiService({ ...deps, config });
}
