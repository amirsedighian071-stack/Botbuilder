import { upstreamError } from '@botforge/core';
import { TtlCache } from '../util/cache';
import type { ServiceDeps } from './deps';
import { isEmptyValue } from './deps';

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  summary: string;
}

const RSS_FEEDS: Array<{ url: string; source: string; language: string; topic: string[] }> = [
  { url: 'https://feeds.bbci.co.uk/persian/rss.xml', source: 'BBC Persian', language: 'fa', topic: ['general', 'world'] },
  { url: 'https://www.iranintl.com/feed', source: 'Iran International', language: 'fa', topic: ['general', 'iran'] },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World', language: 'en', topic: ['world'] },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World', language: 'en', topic: ['world'] },
  { url: 'https://feeds.reuters.com/reuters/technologyNews', source: 'Reuters Tech', language: 'en', topic: ['technology'] },
  { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', language: 'en', topic: ['technology'] },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business', language: 'en', topic: ['business', 'economy'] },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: 'BBC Tech', language: 'en', topic: ['technology'] },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', source: 'BBC Science', language: 'en', topic: ['science'] },
  { url: 'https://feeds.bbci.co.uk/sport/rss.xml', source: 'BBC Sport', language: 'en', topic: ['sport'] },
];

const TOPIC_ALIASES: Record<string, string> = {
  عمومی: 'general',
  جهان: 'world',
  دنیا: 'world',
  ایران: 'iran',
  فناوری: 'technology',
  تکنولوژی: 'technology',
  اقتصاد: 'economy',
  بازار: 'business',
  کسب‌وکار: 'business',
  ورزش: 'sport',
  ورزشی: 'sport',
  علم: 'science',
  دانش: 'science',
};

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

export function parseRss(xml: string, source: string, limit = 10): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const title = stripTags(extractTag(block, 'title'));
    let link = extractTag(block, 'link');
    if (!link) {
      const atomLink = block.match(/<link[^>]*href="([^"]+)"/i);
      link = atomLink ? atomLink[1] : '';
    }
    const description = stripTags(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content'));
    const published = extractTag(block, 'pubDate') || extractTag(block, 'updated') || extractTag(block, 'published');
    if (!title || !link) continue;
    items.push({
      title,
      link,
      source,
      publishedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
      summary: description.slice(0, 400),
    });
  }
  return items;
}

export class NewsService {
  private readonly cache = new TtlCache<NewsItem[]>(5 * 60_000, 60);

  constructor(private readonly deps: ServiceDeps) {}

  async apiKey(): Promise<string> {
    const configured = await this.deps.getSetting<string>('NEWS_API_KEY', '');
    return isEmptyValue(configured) ? this.deps.config.NEWS_API_KEY ?? '' : configured;
  }

  async available(): Promise<boolean> {
    return true;
  }

  private resolveTopic(topic?: string): string {
    if (!topic) return 'general';
    const normalized = topic.trim();
    return TOPIC_ALIASES[normalized] ?? normalized.toLowerCase();
  }

  async latest(options: { topic?: string; limit?: number; language?: string } = {}): Promise<NewsItem[]> {
    const topic = this.resolveTopic(options.topic);
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
    const language = options.language;
    const cacheKey = `${topic}:${limit}:${language ?? 'any'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const apiKey = await this.apiKey();
    let items: NewsItem[] = [];

    if (apiKey) {
      try {
        const query = topic === 'general' ? 'world' : topic;
        const response = await this.deps.http.get<{
          articles?: Array<{ title?: string; url?: string; description?: string; publishedAt?: string; source?: { name?: string } }>;
        }>('https://newsapi.org/v2/everything', {
          query: { q: query, pageSize: limit, sortBy: 'publishedAt', language: language === 'fa' ? 'fa' : 'en' },
          headers: { 'x-api-key': apiKey },
          timeoutMs: 12_000,
          retries: 1,
        });
        items = (response.body?.articles ?? [])
          .filter((article) => article.title && article.url)
          .map((article) => ({
            title: stripTags(article.title ?? ''),
            link: article.url ?? '',
            source: article.source?.name ?? 'NewsAPI',
            publishedAt: article.publishedAt ? new Date(article.publishedAt).toISOString() : new Date().toISOString(),
            summary: stripTags(article.description ?? '').slice(0, 400),
          }));
      } catch (error) {
        this.deps.logger.warn('newsapi failed, falling back to rss', { error: (error as Error).message });
      }
    }

    if (items.length === 0) {
      const feeds = RSS_FEEDS.filter((feed) => {
        const topicMatch = topic === 'general' || feed.topic.includes(topic);
        const languageMatch = !language || feed.language === language;
        return topicMatch && languageMatch;
      });
      const selected = (feeds.length > 0 ? feeds : RSS_FEEDS).slice(0, 3);
      const results = await Promise.allSettled(
        selected.map(async (feed) => {
          const response = await this.deps.http.get<string>(feed.url, {
            timeoutMs: 10_000,
            retries: 1,
            headers: { accept: 'application/rss+xml, application/xml, text/xml' },
          });
          return parseRss(response.text, feed.source, limit);
        }),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
      }
      items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      if (items.length === 0) throw upstreamError('دریافت اخبار در حال حاضر ممکن نیست');
    }

    const final = items.slice(0, limit);
    this.cache.set(cacheKey, final, 5 * 60_000);
    return final;
  }

  async fetchArticle(url: string, maxChars = 6000): Promise<{ title: string; text: string; siteName: string; url: string }> {
    const response = await this.deps.http.get<string>(url, {
      timeoutMs: 15_000,
      retries: 1,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const html = response.text;
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<article[\s\S]*?<\/article>/i, (match) => ` ${match} `);
    const articleMatch = body.match(/<article[\s\S]*?<\/article>/i);
    if (articleMatch) body = articleMatch[0];
    const text = stripTags(body).replace(/\s+/g, ' ').slice(0, maxChars);
    if (text.length < 200) throw upstreamError('محتوای قابل استفاده‌ای در این صفحه پیدا نشد');
    return {
      title: stripTags(ogTitle?.[1] ?? titleMatch?.[1] ?? url).slice(0, 300),
      text,
      siteName: stripTags(ogSite?.[1] ?? ''),
      url,
    };
  }
}
