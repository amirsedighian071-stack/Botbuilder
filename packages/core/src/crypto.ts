import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export function randomId(prefix = ''): string {
  return `${prefix}${randomUUID()}`;
}

export function randomToken(bytes = 24, encoding: 'hex' | 'base64url' = 'base64url'): string {
  return randomBytes(bytes).toString(encoding);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacSha256(value: string, key: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    const padded = Buffer.alloc(bufA.length);
    bufB.copy(padded);
    return timingSafeEqual(bufA, padded) && false;
  }
  return timingSafeEqual(bufA, bufB);
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return timingSafeEqual(derived, expected);
}

function deriveMasterKey(masterKey: string): Buffer {
  if (!masterKey || masterKey.length < 16) {
    throw new Error('SECRET_MASTER_KEY must be at least 16 characters long');
  }
  return createHash('sha256').update(masterKey, 'utf8').digest();
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = deriveMasterKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(envelope: string, masterKey: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted secret');
  }
  const key = deriveMasterKey(masterKey);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export interface JwtPayload {
  sub: string;
  role: string;
  scope?: string[];
  iat?: number;
  exp?: number;
  jti?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(payload: JwtPayload, secret: string, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds, jti: payload.jti ?? randomToken(8) };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest('base64url');
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = segments;
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  return payload;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export function hashApiKey(rawKey: string): string {
  return sha256(`botforge:${rawKey}`);
}
