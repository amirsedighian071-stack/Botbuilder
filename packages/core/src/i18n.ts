export type Language = 'fa' | 'en';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
}

export function formatNumber(value: number, language: Language = 'fa', maximumFractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
  return formatted;
}

export function formatMoney(value: number, language: Language = 'fa', currency = 'تومان'): string {
  return `${formatNumber(value, language, 0)} ${currency}`;
}

export function formatDate(iso: string | Date, language: Language = 'fa'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-GB', {
    calendar: language === 'fa' ? 'persian' : 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(iso: string | Date, language: Language = 'fa'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-GB', {
    calendar: language === 'fa' ? 'persian' : 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDuration(seconds: number, language: Language = 'fa'): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(language === 'fa' ? `${toPersianDigits(hours)} ساعت` : `${hours}h`);
  if (minutes > 0) parts.push(language === 'fa' ? `${toPersianDigits(minutes)} دقیقه` : `${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(language === 'fa' ? `${toPersianDigits(secs)} ثانیه` : `${secs}s`);
  return parts.join(' ');
}

export function formatBytes(bytes: number, language: Language = 'fa'): string {
  if (bytes < 1024) return `${formatNumber(bytes, language, 0)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${formatNumber(value, language, 1)} ${units[index]}`;
}

export function relativeTime(iso: string, language: Language = 'fa', now = Date.now()): string {
  const diffSeconds = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const past = diffSeconds >= 0;
  const pick = (fa: string, en: string) => (language === 'fa' ? fa : en);
  if (abs < 60) return pick('همین حالا', 'just now');
  if (abs < 3600) {
    const value = Math.floor(abs / 60);
    return past ? pick(`${toPersianDigits(value)} دقیقه پیش`, `${value}m ago`) : pick(`${toPersianDigits(value)} دقیقه بعد`, `in ${value}m`);
  }
  if (abs < 86400) {
    const value = Math.floor(abs / 3600);
    return past ? pick(`${toPersianDigits(value)} ساعت پیش`, `${value}h ago`) : pick(`${toPersianDigits(value)} ساعت بعد`, `in ${value}h`);
  }
  const days = Math.floor(abs / 86400);
  return past ? pick(`${toPersianDigits(days)} روز پیش`, `${days}d ago`) : pick(`${toPersianDigits(days)} روز بعد`, `in ${days}d`);
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function progressBar(percent: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(clamped)}%`;
}

export function splitMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const block of text.split(/\n\n+/)) {
    if ((current + block).length > maxLength) {
      if (current) chunks.push(current.trim());
      let remaining = block;
      while (remaining.length > maxLength) {
        const slice = remaining.slice(0, maxLength);
        const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
        const boundary = cut > maxLength * 0.5 ? cut + 1 : maxLength;
        chunks.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary);
      }
      current = remaining;
    } else {
      current += `${current ? '\n\n' : ''}${block}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}
