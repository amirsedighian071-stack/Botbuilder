import type { BotRequirement, BotServices } from '@botforge/core';
import { AiService } from './ai';
import { isEmptyValue, type ServiceDeps } from './deps';
import { LinkService } from './links';
import { MarketService } from './market';
import { MediaService } from './media';
import { NewsService } from './news';
import { SpeechService } from './speech';
import { WeatherService } from './weather';
import { WebWatchService } from './webwatch';

export * from './deps';
export { AiService } from './ai';
export { WeatherService, describeWeatherCode } from './weather';
export { NewsService, parseRss, stripTags } from './news';
export { MarketService } from './market';
export { MediaService, sanitizeFileName } from './media';
export { SpeechService } from './speech';
export { LinkService } from './links';
export { WebWatchService } from './webwatch';

export interface BuiltServices {
  services: BotServices;
  requirementStatus: Array<{ key: string; label: string; configured: boolean; required: boolean }>;
  isConfigured(key: string): boolean;
}

const ENV_FALLBACKS: Record<string, string | undefined> = {
  AI_API_KEY: process.env.AI_API_KEY,
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,
  GOLD_API_KEY: process.env.GOLD_API_KEY,
  NEWS_API_KEY: process.env.NEWS_API_KEY,
  EXCHANGE_API_KEY: process.env.EXCHANGE_API_KEY,
  SPEECH_API_KEY: process.env.SPEECH_API_KEY,
  MEDIA_API_URL: process.env.MEDIA_API_URL,
  MEDIA_API_KEY: process.env.MEDIA_API_KEY,
};

export async function createBotServices(deps: ServiceDeps, requirements: BotRequirement[] = []): Promise<BuiltServices> {
  const ai = new AiService(deps);
  const weather = new WeatherService(deps);
  const news = new NewsService(deps);
  const market = new MarketService(deps);
  const media = new MediaService(deps);
  const speech = new SpeechService(deps, ai);
  const links = new LinkService(deps);
  const webwatch = new WebWatchService(deps);

  const [aiReady, ttsReady, sttReady, mediaReady] = await Promise.all([
    ai.available(),
    speech.ttsAvailable(),
    speech.sttAvailable(),
    media.available(),
  ]);

  const resolved = new Map<string, boolean>();
  for (const requirement of requirements) {
    const value = await deps.getSetting<unknown>(requirement.key, '');
    const configured = !isEmptyValue(value) || !isEmptyValue(ENV_FALLBACKS[requirement.key]);
    resolved.set(requirement.key, configured);
  }
  const providerReady: Record<string, boolean> = {
    AI_API_KEY: aiReady,
    SPEECH_API_KEY: ttsReady,
    MEDIA_API_URL: mediaReady,
  };
  for (const [key, ready] of Object.entries(providerReady)) {
    if (resolved.has(key)) resolved.set(key, ready || resolved.get(key) === true);
  }

  const requirementStatus = requirements.map((requirement) => ({
    key: requirement.key,
    label: requirement.label,
    configured: resolved.get(requirement.key) ?? false,
    required: requirement.required,
  }));

  const isConfigured = (key: string) => {
    if (resolved.has(key)) return resolved.get(key) === true;
    return !isEmptyValue(ENV_FALLBACKS[key]);
  };

  const services: BotServices = {
    isConfigured,
    requirementStatus: () => requirementStatus,
    ai: {
      available: aiReady,
      chat: (messages, options) => ai.chat(messages, options),
      complete: (prompt, system, options) => ai.complete(prompt, system, options),
      json: <T>(prompt: string, system: string) => ai.json<T>(prompt, system),
      translate: (text, target) => ai.translate(text, target),
      transcribe: (audioUrl, fileName) => ai.transcribe(audioUrl, fileName ?? 'audio.ogg'),
      speech: (text) => ai.speech(text),
    },
    weather: {
      available: true,
      current: (city) => weather.current(city),
      forecast: (city, days) => weather.forecast(city, days),
    },
    news: {
      available: true,
      latest: (options) => news.latest(options),
    },
    market: {
      currencyRates: (base, symbols) => market.currencyRates(base, symbols),
      goldPrice: () => market.goldPrice(),
      crypto: (symbols) => market.crypto(symbols),
    },
    media: {
      available: mediaReady,
      resolve: (url) => media.resolve(url),
      summarizeUrl: (url) => media.summarizeUrl(url),
    },
    speech: {
      sttAvailable: sttReady,
      ttsAvailable: ttsReady,
      transcribe: (fileUrl, fileName) => speech.transcribe(fileUrl, fileName ?? 'audio.ogg'),
      synthesize: (text, voice) => speech.synthesize(text, voice),
    },
    links: {
      shorten: (url) => links.shorten(url),
      expand: (url) => links.expand(url),
    },
    webwatch: {
      check: (url) => webwatch.check(url),
    },
    files: {
      download: async (url) => {
        const file = await deps.http.download(url, { timeoutMs: 90_000 });
        return { data: file.data, contentType: file.contentType, fileName: file.fileName };
      },
    },
  };

  return { services, requirementStatus, isConfigured };
}
