import { upstreamError } from '@botforge/core';
import { TtlCache } from '../util/cache';
import type { ServiceDeps } from './deps';
import { isEmptyValue } from './deps';

export interface CurrentWeather {
  city: string;
  temperature: number;
  apparent: number;
  humidity: number;
  windSpeed: number;
  code: number;
  description: string;
  isDay: boolean;
}

export interface ForecastDay {
  date: string;
  min: number;
  max: number;
  code: number;
  description: string;
  precipitation: number;
}

const WMO_DESCRIPTIONS: Record<number, { fa: string; en: string }> = {
  0: { fa: 'آسمان صاف', en: 'Clear sky' },
  1: { fa: 'عمدتاً صاف', en: 'Mainly clear' },
  2: { fa: 'نیمه ابری', en: 'Partly cloudy' },
  3: { fa: 'ابری', en: 'Overcast' },
  45: { fa: 'مه', en: 'Fog' },
  48: { fa: 'مه یخ‌زده', en: 'Depositing rime fog' },
  51: { fa: 'نم‌نم باران سبک', en: 'Light drizzle' },
  53: { fa: 'نم‌نم باران', en: 'Moderate drizzle' },
  55: { fa: 'نم‌نم باران شدید', en: 'Dense drizzle' },
  61: { fa: 'باران سبک', en: 'Slight rain' },
  63: { fa: 'باران', en: 'Moderate rain' },
  65: { fa: 'باران شدید', en: 'Heavy rain' },
  71: { fa: 'برف سبک', en: 'Slight snow' },
  73: { fa: 'برف', en: 'Moderate snow' },
  75: { fa: 'برف شدید', en: 'Heavy snow' },
  77: { fa: 'دانه‌های برف', en: 'Snow grains' },
  80: { fa: 'رگبار سبک', en: 'Slight rain showers' },
  81: { fa: 'رگبار', en: 'Moderate rain showers' },
  82: { fa: 'رگبار شدید', en: 'Violent rain showers' },
  85: { fa: 'رگبار برف', en: 'Snow showers' },
  86: { fa: 'رگبار برف شدید', en: 'Heavy snow showers' },
  95: { fa: 'رعد و برق', en: 'Thunderstorm' },
  96: { fa: 'رعد و برق با تگرگ', en: 'Thunderstorm with hail' },
  99: { fa: 'رعد و برق شدید با تگرگ', en: 'Severe thunderstorm with hail' },
};

export function describeWeatherCode(code: number, language: 'fa' | 'en' = 'fa'): string {
  return WMO_DESCRIPTIONS[code]?.[language] ?? (language === 'fa' ? 'نامشخص' : 'Unknown');
}

const CITY_ALIASES: Record<string, string> = {
  تهران: 'Tehran',
  مشهد: 'Mashhad',
  اصفهان: 'Isfahan',
  شیراز: 'Shiraz',
  تبریز: 'Tabriz',
  کرج: 'Karaj',
  اهواز: 'Ahvaz',
  قم: 'Qom',
  کرمانشاه: 'Kermanshah',
  ارومیه: 'Urmia',
  رشت: 'Rasht',
  زاهدان: 'Zahedan',
  همدان: 'Hamadan',
  کرمان: 'Kerman',
  یزد: 'Yazd',
  اردبیل: 'Ardabil',
  بندرعباس: 'Bandar Abbas',
  اراک: 'Arak',
  ساری: 'Sari',
  بوشهر: 'Bushehr',
  'آمستردام': 'Amsterdam',
  'دبی': 'Dubai',
  'استانبول': 'Istanbul',
  'لندن': 'London',
  'برلین': 'Berlin',
  'تورنتو': 'Toronto',
  'نیویورک': 'New York',
};

export class WeatherService {
  private readonly cache = new TtlCache<CurrentWeather>(10 * 60_000, 300);

  constructor(private readonly deps: ServiceDeps) {}

  async available(): Promise<boolean> {
    return true;
  }

  private normalizeCity(city: string): string {
    const trimmed = city.trim();
    return CITY_ALIASES[trimmed] ?? trimmed;
  }

  private async geocode(rawCity: string): Promise<{ name: string; country: string; latitude: number; longitude: number }> {
    const city = this.normalizeCity(rawCity);
    const response = await this.deps.http.get<{
      results?: Array<{ name: string; country?: string; latitude: number; longitude: number; admin1?: string }>;
    }>('https://geocoding-api.open-meteo.com/v1/search', {
      query: { name: city, count: 1, language: 'fa', format: 'json' },
      timeoutMs: 12_000,
      retries: 2,
    });
    const result = response.body?.results?.[0];
    if (!result) throw upstreamError(`شهر «${rawCity}» پیدا نشد`);
    return {
      name: result.name,
      country: result.country ?? '',
      latitude: result.latitude,
      longitude: result.longitude,
    };
  }

  async current(rawCity: string): Promise<CurrentWeather> {
    const cacheKey = rawCity.trim().toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const place = await this.geocode(rawCity);
    const response = await this.deps.http.get<{
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
        is_day?: number;
      };
    }>('https://api.open-meteo.com/v1/forecast', {
      query: {
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
        timezone: 'auto',
      },
      timeoutMs: 12_000,
      retries: 2,
    });

    const current = response.body?.current;
    if (!current || current.temperature_2m === undefined) {
      throw upstreamError('اطلاعات هواشناسی در دسترس نیست');
    }
    const result: CurrentWeather = {
      city: `${place.name}${place.country ? `، ${place.country}` : ''}`,
      temperature: current.temperature_2m,
      apparent: current.apparent_temperature ?? current.temperature_2m,
      humidity: current.relative_humidity_2m ?? 0,
      windSpeed: current.wind_speed_10m ?? 0,
      code: current.weather_code ?? 0,
      description: describeWeatherCode(current.weather_code ?? 0),
      isDay: (current.is_day ?? 1) === 1,
    };
    this.cache.set(cacheKey, result, 10 * 60_000);
    return result;
  }

  async forecast(rawCity: string, days = 3): Promise<ForecastDay[]> {
    const place = await this.geocode(rawCity);
    const response = await this.deps.http.get<{
      daily?: {
        time?: string[];
        temperature_2m_min?: number[];
        temperature_2m_max?: number[];
        weather_code?: number[];
        precipitation_probability_max?: number[];
      };
    }>('https://api.open-meteo.com/v1/forecast', {
      query: {
        latitude: place.latitude,
        longitude: place.longitude,
        daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max',
        forecast_days: Math.min(Math.max(days, 1), 7),
        timezone: 'auto',
      },
      timeoutMs: 12_000,
      retries: 2,
    });
    const daily = response.body?.daily;
    if (!daily?.time) throw upstreamError('پیش‌بینی هواشناسی در دسترس نیست');
    return daily.time.map((date, index) => ({
      date,
      min: daily.temperature_2m_min?.[index] ?? 0,
      max: daily.temperature_2m_max?.[index] ?? 0,
      code: daily.weather_code?.[index] ?? 0,
      description: describeWeatherCode(daily.weather_code?.[index] ?? 0),
      precipitation: daily.precipitation_probability_max?.[index] ?? 0,
    }));
  }

  async resolveCityFromCoordinates(latitude: number, longitude: number): Promise<string | null> {
    try {
      const response = await this.deps.http.get<{ results?: Array<{ name: string }> }>(
        'https://geocoding-api.open-meteo.com/v1/search',
        {
          query: { latitude, longitude, count: 1, language: 'fa' },
          timeoutMs: 10_000,
          retries: 1,
        },
      );
      return response.body?.results?.[0]?.name ?? null;
    } catch {
      return null;
    }
  }

  static async fromDeps(deps: ServiceDeps): Promise<WeatherService> {
    const key = await deps.getSetting<string>('WEATHER_API_KEY', '');
    if (!isEmptyValue(key)) deps.logger.debug('weather api key present, open-meteo provider remains primary');
    return new WeatherService(deps);
  }
}
