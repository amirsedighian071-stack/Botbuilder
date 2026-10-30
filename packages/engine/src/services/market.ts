import { upstreamError } from '@botforge/core';
import { TtlCache } from '../util/cache';
import type { ServiceDeps } from './deps';
import { isEmptyValue } from './deps';

export interface GoldPrice {
  ounceUsd: number;
  gram18: number;
  gram24: number;
  mesghal: number;
  updatedAt: string;
  source: string;
}

const OUNCE_TO_GRAM = 31.1034768;
const MESGHAL_TO_GRAM = 4.6083;

export class MarketService {
  private readonly ratesCache = new TtlCache<Record<string, number>>(10 * 60_000, 100);
  private readonly tomanCache = new TtlCache<number>(3 * 60_000, 10);
  private readonly goldCache = new TtlCache<GoldPrice>(5 * 60_000, 10);
  private readonly cryptoCache = new TtlCache<Record<string, { usd: number; change24h: number }>>(2 * 60_000, 50);

  constructor(private readonly deps: ServiceDeps) {}

  async currencyRates(base = 'USD', symbols?: string[]): Promise<Record<string, number>> {
    const cacheKey = `${base}:${symbols?.join(',') ?? 'all'}`;
    const cached = this.ratesCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.deps.http.get<{ rates?: Record<string, number>; result?: string }>(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      { timeoutMs: 12_000, retries: 2 },
    );
    const rates = response.body?.rates;
    if (!rates) throw upstreamError('نرخ ارز در دسترس نیست');
    const filtered: Record<string, number> = {};
    if (symbols && symbols.length > 0) {
      for (const symbol of symbols) {
        const value = rates[symbol.toUpperCase()];
        if (value !== undefined) filtered[symbol.toUpperCase()] = value;
      }
    } else {
      for (const symbol of ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'CAD', 'AUD', 'CNY', 'JPY', 'CHF', 'RUB', 'IQD', 'SAR']) {
        const value = rates[symbol];
        if (value !== undefined) filtered[symbol] = value;
      }
    }
    if (Object.keys(filtered).length === 0) throw upstreamError('نرخ ارز برای این ارزها یافت نشد');
    this.ratesCache.set(cacheKey, filtered, 10 * 60_000);
    return filtered;
  }

  async usdtToman(): Promise<number> {
    const cached = this.tomanCache.get('usdt');
    if (cached) return cached;
    try {
      const response = await this.deps.http.get<{ lastTradePrice?: number; latestTrade?: { price?: number } }>(
        'https://api.nobitex.ir/v2/orderbook/USDTIRT',
        { timeoutMs: 10_000, retries: 1 },
      );
      const price = response.body?.lastTradePrice ?? response.body?.latestTrade?.price;
      if (price && Number.isFinite(price)) {
        const toman = price > 1_000_000 ? price / 10 : price;
        this.tomanCache.set('usdt', toman, 3 * 60_000);
        return toman;
      }
    } catch (error) {
      this.deps.logger.debug('nobitex rate failed', { error: (error as Error).message });
    }
    try {
      const rates = await this.currencyRates('USD', ['IRR']);
      const irr = rates.IRR;
      if (irr) {
        const toman = irr / 10;
        this.tomanCache.set('usdt', toman, 5 * 60_000);
        return toman;
      }
    } catch {
      /* fall through */
    }
    throw upstreamError('نرخ لحظه‌ای دلار/تومان در دسترس نیست');
  }

  private async ounceUsd(): Promise<{ price: number; source: string }> {
    const apiKey = await this.deps.getSetting<string>('GOLD_API_KEY', '');
    if (!isEmptyValue(apiKey)) {
      try {
        const response = await this.deps.http.get<{ metals?: Record<string, number>; gold?: number }>(
          'https://api.metals.dev/v1/latest',
          {
            query: { api_key: apiKey, currency: 'USD', unit: 'toz' },
            timeoutMs: 12_000,
            retries: 1,
          },
        );
        const price = response.body?.metals?.gold ?? response.body?.gold;
        if (price) return { price, source: 'metals.dev' };
      } catch (error) {
        this.deps.logger.warn('gold api key provider failed', { error: (error as Error).message });
      }
    }

    try {
      const response = await this.deps.http.get<{ price?: number }>('https://api.gold-api.com/price/XAU', {
        timeoutMs: 10_000,
        retries: 1,
      });
      if (response.body?.price) return { price: response.body.price, source: 'gold-api.com' };
    } catch (error) {
      this.deps.logger.debug('gold-api failed', { error: (error as Error).message });
    }

    const yahoo = await this.deps.http.get<{
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    }>('https://query1.finance.yahoo.com/v8/finance/chart/GC=F', {
      query: { interval: '1d', range: '1d' },
      timeoutMs: 12_000,
      retries: 1,
    });
    const price = yahoo.body?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price) throw upstreamError('قیمت جهانی طلا در دسترس نیست');
    return { price, source: 'Yahoo Finance' };
  }

  async goldPrice(): Promise<GoldPrice> {
    const cached = this.goldCache.get('gold');
    if (cached) return cached;
    const [{ price, source }, toman] = await Promise.all([this.ounceUsd(), this.usdtToman().catch(() => 0)]);
    const gram24 = (price / OUNCE_TO_GRAM) * toman;
    const gram18 = gram24 * (18 / 24);
    const result: GoldPrice = {
      ounceUsd: price,
      gram18,
      gram24,
      mesghal: gram18 * (MESGHAL_TO_GRAM / 1),
      updatedAt: new Date().toISOString(),
      source,
    };
    this.goldCache.set('gold', result, 5 * 60_000);
    return result;
  }

  async crypto(symbols: string[] = ['BTC', 'ETH', 'TON', 'USDT']): Promise<Record<string, { usd: number; change24h: number }>> {
    const cacheKey = symbols.join(',').toUpperCase();
    const cached = this.cryptoCache.get(cacheKey);
    if (cached) return cached;

    const ids = symbols.map((symbol) => {
      const map: Record<string, string> = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        TON: 'the-open-network',
        USDT: 'tether',
        BNB: 'binancecoin',
        SOL: 'solana',
        XRP: 'ripple',
        DOGE: 'dogecoin',
        ADA: 'cardano',
        TRX: 'tron',
      };
      return map[symbol.toUpperCase()] ?? symbol.toLowerCase();
    });

    const response = await this.deps.http.get<Record<string, { usd?: number; usd_24h_change?: number }>>(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        query: { ids: ids.join(','), vs_currencies: 'usd', include_24hr_change: 'true' },
        timeoutMs: 12_000,
        retries: 2,
      },
    );

    const result: Record<string, { usd: number; change24h: number }> = {};
    Object.entries(response.body ?? {}).forEach(([id, value], index) => {
      const symbol = symbols[index]?.toUpperCase() ?? id.toUpperCase();
      if (value && typeof value.usd === 'number') {
        result[symbol] = { usd: value.usd, change24h: value.usd_24h_change ?? 0 };
      }
    });
    if (Object.keys(result).length === 0) throw upstreamError('قیمت ارز دیجیتال در دسترس نیست');
    this.cryptoCache.set(cacheKey, result, 2 * 60_000);
    return result;
  }
}
