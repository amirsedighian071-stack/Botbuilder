import type { BotCategory, BotDefinition, BotRequirement } from '@botforge/core';

import { goldPriceBot } from './bots/a1-gold-price';
import { dailyNewsBot } from './bots/a2-daily-news';
import { priceAlertBot } from './bots/a3-price-alert';
import { weatherBot } from './bots/a4-weather';
import { financeCalculatorBot } from './bots/a5-finance-calculator';
import { shopBot } from './bots/b6-shop';
import { supportBot } from './bots/b7-support';
import { bookingBot } from './bots/b8-booking';
import { subscriptionBot } from './bots/b9-subscriptions';
import { marketingBot } from './bots/b10-marketing';
import { serviceOrdersBot } from './bots/b11-service-orders';
import { crmBot } from './bots/b12-crm';
import { instagramDownloaderBot } from './bots/c13-instagram-downloader';
import { youtubeDownloaderBot } from './bots/c14-youtube-downloader';
import { musicToVoiceBot } from './bots/c15-music-to-voice';
import { voiceToMusicBot } from './bots/c16-voice-to-music';
import { fileManagerBot } from './bots/c17-file-manager';
import { fileConverterBot } from './bots/c18-file-converter';
import { speechToTextBot } from './bots/c19-speech-to-text';
import { textToSpeechBot } from './bots/c20-text-to-speech';
import { aiAssistantBot } from './bots/d21-ai-assistant';
import { translatorBot } from './bots/d22-translator';
import { studyAssistantBot } from './bots/d23-study-assistant';
import { contentWriterBot } from './bots/d24-content-writer';
import { linkSummarizerBot } from './bots/d25-link-summarizer';
import { groupManagerBot } from './bots/e26-group-manager';
import { pollQuizBot } from './bots/e27-poll-quiz';
import { reminderBot } from './bots/e28-reminders';
import { linkShortenerBot } from './bots/e29-link-shortener';
import { formBuilderBot } from './bots/e30-form-builder';
import { courseBot } from './bots/e31-courses';
import { webMonitorBot } from './bots/e32-web-monitor';

export const botTemplates: BotDefinition[] = [
  goldPriceBot,
  dailyNewsBot,
  priceAlertBot,
  weatherBot,
  financeCalculatorBot,
  shopBot,
  supportBot,
  bookingBot,
  subscriptionBot,
  marketingBot,
  serviceOrdersBot,
  crmBot,
  instagramDownloaderBot,
  youtubeDownloaderBot,
  musicToVoiceBot,
  voiceToMusicBot,
  fileManagerBot,
  fileConverterBot,
  speechToTextBot,
  textToSpeechBot,
  aiAssistantBot,
  translatorBot,
  studyAssistantBot,
  contentWriterBot,
  linkSummarizerBot,
  groupManagerBot,
  pollQuizBot,
  reminderBot,
  linkShortenerBot,
  formBuilderBot,
  courseBot,
  webMonitorBot,
];

export interface TemplateCategory {
  id: BotCategory;
  title: string;
  description: string;
  icon: string;
  accent: string;
}

export const templateCategories: TemplateCategory[] = [
  {
    id: 'A',
    title: 'مالی و اطلاعاتی',
    description: 'قیمت طلا و ارز، اخبار، هشدار قیمت، آب‌وهوا و ماشین‌حساب مالی',
    icon: 'trending-up',
    accent: '#38bdf8',
  },
  {
    id: 'B',
    title: 'فروش و کسب‌وکار',
    description: 'فروشگاه کامل، پشتیبانی، نوبت‌دهی، اشتراک، بازاریابی، سفارش خدمات و CRM',
    icon: 'briefcase',
    accent: '#22d3ee',
  },
  {
    id: 'C',
    title: 'دانلود و رسانه',
    description: 'دانلود اینستاگرام و یوتیوب، تبدیل صوت و موسیقی، مدیریت فایل، تبدیل فرمت و گفتار',
    icon: 'download',
    accent: '#2dd4bf',
  },
  {
    id: 'D',
    title: 'هوش مصنوعی و بهره‌وری',
    description: 'دستیار هوشمند، مترجم، دستیار مطالعه، تولید محتوا و خلاصه‌سازی لینک',
    icon: 'sparkles',
    accent: '#60a5fa',
  },
  {
    id: 'E',
    title: 'مدیریت، آموزش و ابزار روزمره',
    description: 'مدیریت گروه، نظرسنجی، یادآور، کوتاه‌کننده لینک، فرم‌ساز، دوره آموزشی و پایش سایت',
    icon: 'layers',
    accent: '#a5b4fc',
  },
];

export interface CatalogEntry {
  id: string;
  number: number;
  name: string;
  category: BotCategory;
  summary: string;
  description: string;
  icon: string;
  tags: string[];
  version: string;
  commands: number;
  requirements: BotRequirement[];
  defaultConfig: Record<string, unknown>;
}

export const botCatalog: CatalogEntry[] = botTemplates.map((template, index) => ({
  id: template.id,
  number: index + 1,
  name: template.name,
  category: template.category,
  summary: template.summary,
  description: template.description,
  icon: template.icon,
  tags: template.tags,
  version: template.version,
  commands: template.commands.length,
  requirements: template.requirements,
  defaultConfig: template.defaultConfig,
}));

const byId = new Map<string, BotDefinition>(botTemplates.map((template) => [template.id, template]));

export function getBotTemplate(id: string): BotDefinition | undefined {
  return byId.get(id);
}

export function requireBotTemplate(id: string): BotDefinition {
  const template = byId.get(id);
  if (!template) throw new Error(`قالب ربات یافت نشد: ${id}`);
  return template;
}

export function templatesByCategory(category: BotCategory): BotDefinition[] {
  return botTemplates.filter((template) => template.category === category);
}

export function catalogByCategory(category: BotCategory): CatalogEntry[] {
  return botCatalog.filter((entry) => entry.category === category);
}

export function templateIds(): string[] {
  return botTemplates.map((template) => template.id);
}

export function requiredEnvKeys(): string[] {
  const keys = new Set<string>();
  for (const template of botTemplates) {
    for (const requirement of template.requirements) {
      if (requirement.env) keys.add(requirement.env);
    }
  }
  return [...keys].sort();
}

export { botCatalog as catalog, botTemplates as templates };

export * from './bots/a1-gold-price';
export * from './bots/a2-daily-news';
export * from './bots/a3-price-alert';
export * from './bots/a4-weather';
export * from './bots/a5-finance-calculator';
export * from './bots/b6-shop';
export * from './bots/b7-support';
export * from './bots/b8-booking';
export * from './bots/b9-subscriptions';
export * from './bots/b10-marketing';
export * from './bots/b11-service-orders';
export * from './bots/b12-crm';
export * from './bots/c13-instagram-downloader';
export * from './bots/c14-youtube-downloader';
export * from './bots/c15-music-to-voice';
export * from './bots/c16-voice-to-music';
export * from './bots/c17-file-manager';
export * from './bots/c18-file-converter';
export * from './bots/c19-speech-to-text';
export * from './bots/c20-text-to-speech';
export * from './bots/d21-ai-assistant';
export * from './bots/d22-translator';
export * from './bots/d23-study-assistant';
export * from './bots/d24-content-writer';
export * from './bots/d25-link-summarizer';
export * from './bots/e26-group-manager';
export * from './bots/e27-poll-quiz';
export * from './bots/e28-reminders';
export * from './bots/e29-link-shortener';
export * from './bots/e30-form-builder';
export * from './bots/e31-courses';
export * from './bots/e32-web-monitor';
export * from './kit';
