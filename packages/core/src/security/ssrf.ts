import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError, badRequest } from '../errors';

const BLOCKED_V4: Array<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    result = result * 256 + value;
  }
  return result >>> 0;
}

export function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  for (const [base, bits] of BLOCKED_V4) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (baseValue & mask)) return true;
  }
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (normalized.startsWith('ff')) return true;
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

export interface SsrfOptions {
  allowPrivate?: boolean;
  resolver?: (hostname: string) => Promise<string[]>;
  allowPorts?: number[];
}

export interface UrlCheckResult {
  url: URL;
  addresses: string[];
}

export async function assertSafeUrl(rawUrl: string, options: SsrfOptions = {}): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest('آدرس وارد شده معتبر نیست');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('فقط پروتکل‌های http و https پشتیبانی می‌شوند');
  }
  if (url.username || url.password) {
    throw badRequest('آدرس‌های دارای اطلاعات ورود مجاز نیستند');
  }
  if (options.allowPrivate) {
    return { url, addresses: [] };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new AppError('FORBIDDEN', 'دسترسی به آدرس‌های داخلی مجاز نیست');
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new AppError('FORBIDDEN', 'دسترسی به دامنه‌های داخلی مجاز نیست');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const allowedPorts = options.allowPorts ?? [80, 443, 8080, 8443];
  if (!allowedPorts.includes(port)) {
    throw new AppError('FORBIDDEN', 'اتصال به این پورت مجاز نیست');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new AppError('FORBIDDEN', 'دسترسی به آدرس‌های داخلی مجاز نیست');
    }
    return { url, addresses: [hostname] };
  }

  const resolver = options.resolver ?? (async (host: string) => {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  });

  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw badRequest('دامنه قابل تشخیص نیست');
  }
  if (addresses.length === 0) {
    throw badRequest('دامنه به هیچ آدرسی متصل نیست');
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new AppError('FORBIDDEN', 'دامنه به شبکه داخلی اشاره می‌کند و مجاز نیست');
    }
  }
  return { url, addresses };
}

export function isSafeRelativeLink(raw: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i.test(raw) === false || /^https?:\/\//i.test(raw);
}
