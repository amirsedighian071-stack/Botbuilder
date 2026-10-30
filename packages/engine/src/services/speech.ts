import { upstreamError } from '@botforge/core';
import type { ServiceDeps } from './deps';
import { AiService } from './ai';
import { isEmptyValue } from './deps';

export interface SpeechResult {
  data: Uint8Array;
  mime: string;
}

export class SpeechService {
  constructor(private readonly deps: ServiceDeps, private readonly ai: AiService) {}

  async sttAvailable(): Promise<boolean> {
    return this.ai.available();
  }

  async ttsAvailable(): Promise<boolean> {
    if (await this.ai.available()) return true;
    const url = await this.deps.getSetting<string>('SPEECH_TTS_URL', '');
    return !isEmptyValue(url);
  }

  async transcribe(fileUrl: string, fileName = 'audio.ogg', language = 'fa'): Promise<string> {
    if (!(await this.ai.available())) {
      throw upstreamError('سرویس تبدیل گفتار به متن پیکربندی نشده است (کلید AI_API_KEY)');
    }
    return this.ai.transcribe(fileUrl, fileName, language);
  }

  async synthesize(text: string, voice?: string): Promise<SpeechResult | null> {
    const clean = text.trim();
    if (!clean) throw upstreamError('متنی برای تبدیل به گفتار وجود ندارد');
    if (clean.length > 4000) throw upstreamError('متن بیش از حد طولانی است (حداکثر ۴۰۰۰ کاراکتر)');

    const aiResult = await this.ai.speech(clean, voice ?? 'alloy');
    if (aiResult) return aiResult;

    const customUrl = await this.deps.getSetting<string>('SPEECH_TTS_URL', '');
    if (isEmptyValue(customUrl)) {
      throw upstreamError('سرویس تبدیل متن به گفتار پیکربندی نشده است (کلید AI_API_KEY یا SPEECH_TTS_URL)');
    }
    const apiKey = await this.deps.getSetting<string>('SPEECH_API_KEY', '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!isEmptyValue(apiKey)) headers.authorization = `Bearer ${apiKey}`;
    const response = await this.deps.http.requestBinary(customUrl, {
      method: 'POST',
      headers,
      json: { text: clean, voice: voice ?? 'fa-IR-Female', format: 'mp3' },
      timeoutMs: 90_000,
    });
    if (!response.ok || response.data.byteLength === 0) {
      throw upstreamError('سرویس تبدیل متن به گفتار پاسخ معتبری نداد');
    }
    return { data: response.data, mime: response.contentType || 'audio/mpeg' };
  }
}
