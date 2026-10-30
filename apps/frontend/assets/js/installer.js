/* BotForge installer engine — runs entirely in the browser.
 *
 * The wizard collects a template, a platform token and the integration keys of
 * that template, then this module produces a complete, self-contained
 * deployment package (Cloudflare Workers or Railway/Docker) as a ZIP file.
 * No request ever leaves the tab: secrets are sealed with WebCrypto using the
 * same envelope format the runtime uses, so the generated SQL row and the
 * `.env` file are directly usable.
 */
(function () {
  'use strict';

  const SCHEMA_URL = 'assets/installer/schema.sql';
  const WORKER_URL = 'assets/installer/worker.js';
  const STORAGE_KEY = 'botforge.installations';
  const ACTIVE_KEY = 'botforge.activeInstallation';
  const SECRET_PREFIX = 'botforge.secrets.';
  const ENCODER = new TextEncoder();

  const PLATFORMS = {
    telegram: {
      id: 'telegram',
      name: 'تلگرام',
      host: 'api.telegram.org',
      tokenPattern: /^\d{6,}:[A-Za-z0-9_-]{30,}$/,
      tokenHint: 'الگوی توکن تلگرام: شناسه عددی، دو نقطه و رشته لاتین (از BotFather)',
      apiLink: 'https://t.me/BotFather',
      apiLabel: 'ساخت ربات در BotFather',
      docsLink: 'https://core.telegram.org/bots/api'
    },
    bale: {
      id: 'bale',
      name: 'بله',
      host: 'tapi.bale.ai',
      tokenPattern: /^\d{6,}:[A-Za-z0-9_-]{30,}$/,
      tokenHint: 'الگوی توکن بله همانند تلگرام است (شناسه:رشته)',
      apiLink: 'https://dev.bale.ai/',
      apiLabel: 'پنل توسعه‌دهندگان بله',
      docsLink: 'https://dev.bale.ai/'
    },
    rubika: {
      id: 'rubika',
      name: 'روبیکا',
      host: 'botapi.rubika.ir',
      tokenPattern: /^[A-Za-z0-9]{24,}$/,
      tokenHint: 'توکن روبیکا فقط شامل حروف و ارقام لاتین است (از BotFather روبیکا)',
      apiLink: 'https://rubika.ir/botfather',
      apiLabel: 'ساخت ربات در روبیکا',
      docsLink: 'https://rubika.ir/'
    }
  };

  const PROVIDERS = {
    cloudflare: {
      id: 'cloudflare',
      name: 'Cloudflare Workers',
      summary: 'اجرای لبه‌ای با D1، بدون سرور و با کرون هر دقیقه؛ فعّال در چند ثانیه و مناسب وب‌هوک پرترافیک.',
      note: 'پردازش رسانه و ffmpeg روی Workers پشتیبانی نمی‌شود؛ برای ربات‌های دسته دانلود و رسانه Railway را انتخاب کنید.',
      tokenLink: 'https://dash.cloudflare.com/profile/api-tokens',
      tokenLabel: 'ساخت API Token در Cloudflare',
      icon: 'cloud'
    },
    railway: {
      id: 'railway',
      name: 'Railway (Docker)',
      summary: 'سرویس Node.js کامل با رسانه، ffmpeg و پایگاه‌داده؛ پشتیبان همه ۳۲ ربات.',
      note: 'به یک حساب Railway یا هر میزبان Docker نیاز دارید؛ همان بسته روی VPS هم اجرا می‌شود.',
      tokenLink: 'https://railway.com/account/tokens',
      tokenLabel: 'ساخت توکن Railway',
      icon: 'server'
    }
  };

  /* ------------------------------------------------------------ utilities */

  function randomBytes(length) {
    const buffer = new Uint8Array(length);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buffer);
    else for (let index = 0; index < length; index += 1) buffer[index] = Math.floor(Math.random() * 256);
    return buffer;
  }

  function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomHex(bytes) {
    return toHex(randomBytes(bytes));
  }

  function randomToken(bytes, encoding) {
    if (encoding === 'hex') return randomHex(bytes);
    return toBase64Url(randomBytes(bytes));
  }

  async function sha256Hex(value) {
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest('SHA-256', ENCODER.encode(value));
      return toHex(new Uint8Array(digest));
    }
    // Deterministic fallback for contexts without WebCrypto (older embedded browsers).
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let index = 0; index < value.length; index += 1) {
      h1 = (h1 ^ value.charCodeAt(index)) * 16777619 >>> 0;
      h2 = (h2 + value.charCodeAt(index) * (index + 7)) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      out[index] = (h1 >>> (index % 4 * 8) ^ h2 >>> (index % 3 * 8) ^ (index * 31)) & 0xff;
    }
    return toHex(out);
  }

  function maskToken(token) {
    if (!token) return '';
    if (token.length <= 8) return '••••';
    return `${token.slice(0, 4)}••••${token.slice(-4)}`;
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 32);
  }

  function suggestionFor(templateId, platform) {
    const base = slugify(templateId) || 'botforge-bot';
    return `${base}-${platform}`.slice(0, 40);
  }

  /** AES-256-GCM envelope identical to `encryptSecret` in @botforge/core. */
  async function sealToken(token, masterKey) {
    if (!window.crypto || !window.crypto.subtle) throw new Error('مرورگر شما WebCrypto را پشتیبانی نمی‌کند؛ از مرورگر به‌روز استفاده کنید.');
    const keyBytes = new Uint8Array(await window.crypto.subtle.digest('SHA-256', ENCODER.encode(masterKey)));
    const key = await window.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = randomBytes(12);
    const sealed = new Uint8Array(await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ENCODER.encode(token)));
    const ciphertext = sealed.slice(0, sealed.length - 16);
    const tag = sealed.slice(sealed.length - 16);
    return ['v1', toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join('.');
  }

  async function webhookPathSecret(secret) {
    return (await sha256Hex(`webhook:${secret}`)).slice(0, 32);
  }

  /* ---------------------------------------------------------------- spec */

  function createSpec(input) {
    const platform = PLATFORMS[input.platform] ? input.platform : 'telegram';
    const provider = PROVIDERS[input.provider] ? input.provider : 'cloudflare';
    const slug = slugify(input.slug) || suggestionFor(input.templateId, platform);
    return {
      id: `inst_${randomHex(6)}`,
      createdAt: new Date().toISOString(),
      templateId: input.templateId,
      templateName: input.templateName || '',
      name: (input.name || input.templateName || '').trim(),
      slug,
      platform,
      provider,
      botId: `bot_${randomHex(8)}`,
      webhookSecret: randomHex(24),
      masterKey: randomHex(32),
      jwtSecret: randomHex(32),
      adminEmail: input.adminEmail || `admin@${slug}.botforge.local`,
      adminPassword: `${randomToken(9)}#7`,
      integrationKeys: { ...(input.integrationKeys || {}) },
      forceMembership: input.forceMembership || { enabled: false, channels: [] },
      publicBaseUrl: '',
      status: 'generated'
    };
  }

  function emptyForceMembership() {
    return {
      enabled: false,
      channels: [],
      message: 'برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید.',
      buttonLabel: 'بررسی عضویت',
      recheckLabel: 'عضو شدم',
      bypassAdmins: true,
      cacheSeconds: 60
    };
  }

  /** Strips secrets so a spec can live in localStorage. */
  function publicSpec(spec) {
    return {
      id: spec.id,
      createdAt: spec.createdAt,
      templateId: spec.templateId,
      templateName: spec.templateName,
      name: spec.name,
      slug: spec.slug,
      platform: spec.platform,
      provider: spec.provider,
      botId: spec.botId,
      adminEmail: spec.adminEmail,
      webhookPath: spec.webhookPath || '',
      integrationKeys: Object.fromEntries(Object.entries(spec.integrationKeys || {}).map(([key, value]) => [key, value ? 'set' : ''])),
      forceMembership: spec.forceMembership || emptyForceMembership(),
      publicBaseUrl: spec.publicBaseUrl || '',
      status: spec.status || 'generated'
    };
  }

  function rememberSecrets(spec) {
    try {
      window.sessionStorage.setItem(
        `${SECRET_PREFIX}${spec.id}`,
        JSON.stringify({
          token: spec.token || '',
          masterKey: spec.masterKey,
          jwtSecret: spec.jwtSecret,
          adminPassword: spec.adminPassword,
          keys: { ...(spec.integrationKeys || {}) }
        })
      );
    } catch {
      /* sessionStorage may be blocked; the package is still downloadable */
    }
  }

  function recallSecrets(id) {
    try {
      const raw = window.sessionStorage.getItem(`${SECRET_PREFIX}${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- storage */

  function listInstallations() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveInstallation(spec) {
    const items = listInstallations().filter((item) => item.id !== spec.id);
    items.unshift({ ...publicSpec(spec), updatedAt: new Date().toISOString() });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 25)));
    setActive(spec.id);
    return items;
  }

  function updateInstallation(id, patch) {
    const items = listInstallations().map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return items.find((item) => item.id === id) || null;
  }

  function removeInstallation(id) {
    const items = listInstallations().filter((item) => item.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    if (activeInstallation() && activeInstallation().id === id) window.localStorage.removeItem(ACTIVE_KEY);
    try {
      window.sessionStorage.removeItem(`${SECRET_PREFIX}${id}`);
    } catch {
      /* ignore */
    }
    return items;
  }

  function activeInstallation() {
    const id = window.localStorage.getItem(ACTIVE_KEY);
    if (!id) return null;
    return listInstallations().find((item) => item.id === id) || null;
  }

  function setActive(id) {
    window.localStorage.setItem(ACTIVE_KEY, id);
    return listInstallations().find((item) => item.id === id) || null;
  }

  /* ------------------------------------------------------ zip (store only) */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
    const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
    return { time, date: day };
  }

  function buildZip(files) {
    const stamp = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = ENCODER.encode(file.path);
      const dataBytes = typeof file.content === 'string' ? ENCODER.encode(file.content) : file.content;
      const checksum = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, dataBytes);

      const entry = new Uint8Array(46 + nameBytes.length);
      const entryView = new DataView(entry.buffer);
      entryView.setUint32(0, 0x02014b50, true);
      entryView.setUint16(4, 20, true);
      entryView.setUint16(6, 20, true);
      entryView.setUint16(8, 0x0800, true);
      entryView.setUint16(10, 0, true);
      entryView.setUint16(12, stamp.time, true);
      entryView.setUint16(14, stamp.date, true);
      entryView.setUint32(16, checksum, true);
      entryView.setUint32(20, dataBytes.length, true);
      entryView.setUint32(24, dataBytes.length, true);
      entryView.setUint16(28, nameBytes.length, true);
      entryView.setUint16(30, 0, true);
      entryView.setUint16(32, 0, true);
      entryView.setUint16(34, 0, true);
      entryView.setUint16(36, 0, true);
      entryView.setUint32(38, 0, true);
      entryView.setUint32(42, offset, true);
      entry.set(nameBytes, 46);
      central.push(entry);

      offset += local.length + dataBytes.length;
    }

    const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ------------------------------------------------------------- package */

  let schemaCache = null;

  async function loadSchema() {
    if (schemaCache) return schemaCache;
    const response = await fetch(new URL(SCHEMA_URL, document.baseURI).toString(), { cache: 'no-cache' });
    if (!response.ok) throw new Error('طرح‌واره پایگاه‌داده در دسترس نیست؛ صفحه را دوباره بارگذاری کنید.');
    const text = await response.text();
    if (!/CREATE TABLE/i.test(text)) throw new Error('طرح‌واره پایگاه‌داده معتبر نیست.');
    schemaCache = text.trimEnd();
    return schemaCache;
  }

  let workerCache;

  async function loadWorkerBundle() {
    if (workerCache !== undefined) return workerCache;
    try {
      const response = await fetch(new URL(WORKER_URL, document.baseURI).toString(), { cache: 'no-cache' });
      if (!response.ok) throw new Error(String(response.status));
      workerCache = await response.text();
    } catch {
      workerCache = null;
    }
    return workerCache;
  }

  function sqlString(value) {
    return `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
  }

  function envFile(spec, options) {
    const withSecrets = !options || options.withSecrets !== false;
    const lines = [
      '# BotForge — متغیرهای محیطی نصب',
      `# قالب: ${spec.templateId} | پلتفرم: ${spec.platform} | ساخته‌شده: ${spec.createdAt}`,
      '',
      'NODE_ENV=production',
      'PORT=8080',
      'HOST=0.0.0.0',
      `PUBLIC_BASE_URL=${spec.publicBaseUrl || ''}`,
      '',
      'BOT_TEMPLATE=' + spec.templateId,
      'BOT_PLATFORM=' + spec.platform,
      'BOT_SLUG=' + spec.slug,
      'BOT_NAME=' + spec.name,
      'BOT_ID=' + spec.botId,
      'BOT_WEBHOOK_SECRET=' + spec.webhookSecret,
      'BOT_TOKEN=' + (withSecrets ? spec.token || '' : ''),
      '',
      'SECRET_MASTER_KEY=' + (withSecrets ? spec.masterKey : ''),
      'JWT_SECRET=' + (withSecrets ? spec.jwtSecret : ''),
      'ADMIN_SEED_EMAIL=' + spec.adminEmail,
      'ADMIN_SEED_PASSWORD=' + (withSecrets ? spec.adminPassword : ''),
      '',
      'RUN_MODE=install',
      'LOG_LEVEL=info',
      'CORS_ORIGINS=*',
      'SSRF_PROTECTION=true'
    ];
    if (spec.provider === 'cloudflare') {
      lines.push('DATABASE_DRIVER=d1');
    } else {
      lines.push('DATABASE_DRIVER=sqlite', 'SQLITE_PATH=/app/.data/botforge.sqlite', 'MEDIA_DIR=/app/.data/media');
    }
    const keys = Object.entries(spec.integrationKeys || {}).filter(([, value]) => value);
    if (keys.length) {
      lines.push('', '# کلیدهای یکپارچه‌سازی');
      for (const [key, value] of keys) lines.push(`${key}=${withSecrets ? value : ''}`);
    }
    lines.push('', '# عضویت اجباری');
    lines.push(`BOT_FORCE_MEMBERSHIP_JSON=${JSON.stringify(spec.forceMembership || emptyForceMembership())}`);
    lines.push('');
    return lines.join('\n');
  }

  function wranglerToml(spec) {
    const workerName = `botforge-${spec.slug}`;
    const keys = Object.entries(spec.integrationKeys || {}).filter(([, value]) => value).map(([key]) => key);
    const secrets = ['SECRET_MASTER_KEY', 'JWT_SECRET', ...keys];
    return `# BotForge — Cloudflare Workers
name = "${workerName}"
main = "src/index.js"
compatibility_date = "2025-01-15"
compatibility_flags = ["nodejs_compat"]
workers_dev = true

[observability]
enabled = true

[triggers]
crons = ["*/1 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "botforge-${spec.slug}"
database_id = "REPLACE_WITH_DATABASE_ID"

[vars]
PUBLIC_BASE_URL = "REPLACE_WITH_PUBLIC_URL"
WEBHOOK_PATH_PREFIX = "/webhooks"
LOG_LEVEL = "info"
CORS_ORIGINS = "*"

# رازها با اسکریپت deploy.sh ثبت می‌شوند: ${secrets.join('، ')}
`;
  }

  function botRowSql(spec, sealedToken) {
    const config = { ...(spec.templateConfig || {}) };
    const now = new Date().toISOString();
    return `-- رکورد ربات برای D1 — ساخته‌شده توسط ویزارد BotForge
INSERT OR REPLACE INTO bots (
  id, slug, template_id, name, platform, status,
  token_cipher, token_hint, owner_id, config, force_membership,
  webhook_secret, created_at, updated_at
) VALUES (
  ${sqlString(spec.botId)},
  ${sqlString(spec.slug)},
  ${sqlString(spec.templateId)},
  ${sqlString(spec.name)},
  ${sqlString(spec.platform)},
  'active',
  ${sqlString(sealedToken)},
  ${sqlString(maskToken(spec.token))},
  'installer',
  ${sqlString(JSON.stringify(config))},
  ${sqlString(JSON.stringify(spec.forceMembership || emptyForceMembership()))},
  ${sqlString(spec.webhookSecret)},
  ${sqlString(now)},
  ${sqlString(now)}
);
`;
  }

  function cloudflareDeployScript(spec, webhookPath) {
    const workerName = `botforge-${spec.slug}`;
    const dbName = `botforge-${spec.slug}`;
    const keys = Object.entries(spec.integrationKeys || {}).filter(([, value]) => value).map(([key]) => key);
    const secrets = ['SECRET_MASTER_KEY', 'JWT_SECRET', ...keys];
    return `#!/usr/bin/env bash
# BotForge — استقرار خودکار روی Cloudflare Workers + D1
# پیش‌نیاز: Node.js ۲۰+ و یک توکن Cloudflare با دسترسی Workers Scripts:Edit، D1:Edit و Account Settings:Read
set -euo pipefail
cd "$(dirname "$0")"

: "\${CLOUDFLARE_API_TOKEN:?export CLOUDFLARE_API_TOKEN با توکن Cloudflare}"
WRANGLER="npx --yes wrangler@3"
WORKER_NAME="${workerName}"
DB_NAME="${dbName}"
SECRETS="${secrets.join(' ')}"

echo "[1/6] شناسه حساب و زیردامنه ورکرها"
ACCOUNT_ID=\${CLOUDFLARE_ACCOUNT_ID:-}
if [ -z "$ACCOUNT_ID" ]; then
  ACCOUNT_ID=$($WRANGLER whoami --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const a=(j.accounts||[])[0];process.stdout.write(a?a.id:'')}catch{process.stdout.write('')}})")
fi
[ -n "$ACCOUNT_ID" ] || { echo "شناسه حساب Cloudflare پیدا نشد؛ CLOUDFLARE_ACCOUNT_ID را export کنید." >&2; exit 1; }
SUBDOMAIN=$(node -e "fetch('https://api.cloudflare.com/client/v4/accounts/'+process.argv[1]+'/workers/subdomain',{headers:{Authorization:'Bearer '+process.argv[2]}}).then(r=>r.json()).then(j=>process.stdout.write((j.result&&j.result.subdomain)||'')).catch(()=>process.stdout.write(''))" "$ACCOUNT_ID" "$CLOUDFLARE_API_TOKEN")
[ -n "$SUBDOMAIN" ] || { echo "زیردامنه workers.dev حساب پیدا نشد؛ آن را یک بار در داشبورد Cloudflare فعال کنید." >&2; exit 1; }
BASE_URL="https://$WORKER_NAME.$SUBDOMAIN.workers.dev"
echo "آدرس نهایی: $BASE_URL"
node -e "const fs=require('fs');const p='wrangler.toml';let s=fs.readFileSync(p,'utf8');s=s.replace('REPLACE_WITH_PUBLIC_URL',process.argv[1]);fs.writeFileSync(p,s)" "$BASE_URL"

echo "[2/6] ساخت یا بازیابی پایگاه D1"
DB_ID=$($WRANGLER d1 list --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const rows=JSON.parse(d);const row=(rows||[]).find(r=>r.name===process.argv[1]);process.stdout.write(row?(row.uuid||row.id||''):'')}catch{process.stdout.write('')}})" "$DB_NAME")
if [ -z "$DB_ID" ]; then
  $WRANGLER d1 create "$DB_NAME" >/dev/null
  DB_ID=$($WRANGLER d1 list --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const rows=JSON.parse(d);const row=(rows||[]).find(r=>r.name===process.argv[1]);process.stdout.write(row?(row.uuid||row.id||''):'')}catch{process.stdout.write('')}})" "$DB_NAME")
fi
[ -n "$DB_ID" ] || { echo "ساخت پایگاه D1 ناموفق بود." >&2; exit 1; }
node -e "const fs=require('fs');const p='wrangler.toml';let s=fs.readFileSync(p,'utf8');s=s.replace('REPLACE_WITH_DATABASE_ID',process.argv[1]);fs.writeFileSync(p,s)" "$DB_ID"

echo "[3/6] وارد کردن طرح‌واره و رکورد ربات"
$WRANGLER d1 execute "$DB_NAME" --remote --file=schema.sql --yes >/dev/null
$WRANGLER d1 execute "$DB_NAME" --remote --file=bot-row.sql --yes >/dev/null

echo "[4/6] ثبت رازها روی ورکر"
set -a; . ./.env; set +a
for KEY in $SECRETS; do
  printf '%s' "\${!KEY}" | $WRANGLER secret put "$KEY" --name "$WORKER_NAME" >/dev/null
done

echo "[5/6] انتشار ورکر"
$WRANGLER deploy

echo "[6/6] ثبت وب‌هوک روی پلتفرم"
WEBHOOK="$BASE_URL${webhookPath}"
case "${spec.platform}" in
  telegram|bale)
    HOST="${spec.platform === 'telegram' ? 'api.telegram.org' : 'tapi.bale.ai'}"
    curl -fsS "https://$HOST/bot$BOT_TOKEN/setWebhook" --data-urlencode "url=$WEBHOOK" >/dev/null && echo "وب‌هوک ثبت شد."
    ;;
  *)
    echo "آدرس زیر را در پنل ربات روبیکا ثبت کنید:"
    echo "$WEBHOOK"
    ;;
esac

echo "پایان. سلامت سرویس: $BASE_URL/health"
echo "کنسول مدیریت: https://amirsedighian071-stack.github.io/Botbuilder/admin/ را باز کنید و همین آدرس را وارد کنید."
`;
  }

  function railwayDeployScript(spec, webhookPath) {
    return `#!/usr/bin/env bash
# BotForge — استقرار خودکار روی Railway یا هر میزبان Docker
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/5] بررسی ابزارها"
if ! command -v docker >/dev/null 2>&1 && ! command -v railway >/dev/null 2>&1; then
  echo "نه Docker و نه Railway CLI نصب نیست؛ یکی از آن‌ها لازم است." >&2
  exit 1
fi

if command -v railway >/dev/null 2>&1 && [ -n "\${RAILWAY_TOKEN:-}" ]; then
  echo "[2/5] ساخت پروژه Railway"
  railway login --token "$RAILWAY_TOKEN" >/dev/null 2>&1 || true
  railway init --name "botforge-${spec.slug}" >/dev/null 2>&1 || true

  echo "[3/5] تنظیم متغیرها"
  set -a; . ./.env; set +a
  for KEY in $(grep -vE '^[[:space:]]*(#|$)' .env | cut -d= -f1); do
    [ -n "\${!KEY}" ] && railway variables --set "$KEY=\${!KEY}" >/dev/null 2>&1 || true
  done

  echo "[4/5] استقرار"
  railway up --detach

  echo "[5/5] دامنه"
  DOMAIN=$(railway domain 2>/dev/null | tail -n1 || true)
else
  echo "[2/5] ساخت ایمیج محلی"
  docker compose up -d --build
  DOMAIN="http://127.0.0.1:8080"
fi

BASE_URL="\${DOMAIN:-http://127.0.0.1:8080}"
BASE_URL="\${BASE_URL%/}"
echo "آدرس سرویس: $BASE_URL"

set -a; . ./.env; set +a
case "${spec.platform}" in
  telegram|bale)
    HOST="${spec.platform === 'telegram' ? 'api.telegram.org' : 'tapi.bale.ai'}"
    curl -fsS "https://$HOST/bot$BOT_TOKEN/setWebhook" --data-urlencode "url=$BASE_URL${webhookPath}" >/dev/null && echo "وب‌هوک ثبت شد."
    ;;
  *)
    echo "آدرس وب‌هوک: $BASE_URL${webhookPath}"
    ;;
esac

echo "سلامت: $BASE_URL/health"
echo "اگر دامنه بعداً تغییر کرد، PUBLIC_BASE_URL را در .env به‌روزرسانی و دوباره مستقر کنید."
`;
  }

  function dockerfile(spec) {
    return `# BotForge — تصویر نصب ${spec.name}
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \\
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/amirsedighian071-stack/Botbuilder.git . \\
  && npm ci --no-audit --no-fund --workspaces --include-workspace-root

FROM deps AS build
WORKDIR /app
RUN npm install --no-audit --no-fund typescript@5.7.2 tsx@4.19.2 esbuild@0.24.2 --no-save \\
  && node scripts/build.mjs

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG INSTALL_FFMPEG=true
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \\
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; \\
    fi
ENV NODE_ENV=production \\
    PORT=8080 \\
    HOST=0.0.0.0 \\
    RUN_MODE=install \\
    MEDIA_DIR=/app/.data/media
RUN groupadd --system --gid 1001 botforge \\
  && useradd --system --uid 1001 --gid botforge --create-home botforge \\
  && mkdir -p /app/.data/media && chown -R botforge:botforge /app/.data
COPY --from=build --chown=botforge:botforge /app/node_modules ./node_modules
COPY --from=build --chown=botforge:botforge /app/dist ./dist
COPY --from=build --chown=botforge:botforge /app/packages ./packages
COPY --from=build --chown=botforge:botforge /app/package.json /app/package-lock.json ./
COPY --from=build --chown=botforge:botforge /app/scripts ./scripts
USER botforge
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/install/main.js"]
`;
  }

  function composeFile(spec) {
    return `services:
  ${spec.slug}:
    build: .
    image: botforge-${spec.slug}:latest
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8080:8080"
    volumes:
      - ${spec.slug}-data:/app/.data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  ${spec.slug}-data:
`;
  }

  function readme(spec, template, webhookPath) {
    const provider = PROVIDERS[spec.provider];
    const list = template && Array.isArray(template.commandList) ? template.commandList : [];
    const commands = list.map((command) => `| /${command.command} | ${command.description} |`).join('\n');
    return `# ${spec.name}

بسته استقرار ربات ساخته‌شده با BotForge — قالب \`${spec.templateId}\` روی ${provider.name}.

## داخل این بسته چیست؟

| فایل | کار |
| --- | --- |
| \`.env\` | همه متغیرها، رازها و کلیدهای یکپارچه‌سازی |
| \`deploy.sh\` | استقرار کامل با یک دستور |
| \`.env.example\` | همان متغیرها بدون مقدار برای مرور |
| ${spec.provider === 'cloudflare' ? '`wrangler.toml` + `schema.sql` + `bot-row.sql`\n| پیکربندی ورکر، طرح‌واره D1 و رکورد آماده ربات |' : '`Dockerfile` + `docker-compose.yml` + `railway.json`\n| استقرار کانتینری |'}
| \`webhook.txt\` | آدرس و توضیح ثبت وب‌هوک |
| \`botforge.install.json\` | مشخصات نصب برای پیگیری در سایت |

## استقرار

\`\`\`bash
${spec.provider === 'cloudflare' ? 'export CLOUDFLARE_API_TOKEN=...\nbash deploy.sh' : 'export RAILWAY_TOKEN=...   # یا docker compose up -d --build\nbash deploy.sh'}
\`\`\`

آدرس وب‌هوک این ربات:

\`\`\`text
${webhookPath}
\`\`\`

## دستورها

| دستور | کار |
| --- | --- |
${commands || '| — | منوی دکمه‌ای |'}

## پس از استقرار

1. \`/health\` سرویس را باز کنید؛ باید وضعیت \`ok\` ببینید.
2. کنسول مدیریت را در https://amirsedighian071-stack.github.io/Botbuilder/admin/ باز کنید.
3. با ایمیل \`${spec.adminEmail}\` و گذرواژه‌ای که در \`.env\` آمده وارد شوید.

> \`.env\` را در جای امن نگه دارید و هرگز آن را در مخزن عمومی قرار ندهید.
`;
  }

  async function generateFiles(spec, template) {
    const token = spec.token || '';
    if (!token) throw new Error('توکن ربات در این نشست موجود نیست؛ نصب را دوباره از ویزارد بسازید.');
    const sealed = await sealToken(token, spec.masterKey);
    const pathSecret = await webhookPathSecret(spec.webhookSecret);
    const webhookPath = `/webhooks/${spec.platform}/${spec.botId}/${pathSecret}`;
    const files = [
      { path: 'README.md', content: readme(spec, template, webhookPath) },
      { path: '.env', content: envFile(spec) },
      { path: '.env.example', content: envFile({ ...spec, token: '', masterKey: '', jwtSecret: '', adminPassword: '', integrationKeys: {} }, { withSecrets: false }) },
      { path: 'deploy.sh', content: spec.provider === 'cloudflare' ? cloudflareDeployScript(spec, webhookPath) : railwayDeployScript(spec, webhookPath) },
      { path: 'webhook.txt', content: `${webhookPath}\n\n${spec.platform === 'rubika' ? 'این آدرس را در پنل ربات روبیکا ثبت کنید.' : `ثبت خودکار با ${PLATFORMS[spec.platform].name} و دستور setWebhook.`}\n` },
      { path: 'botforge.install.json', content: `${JSON.stringify(publicSpec(spec), null, 2)}\n` },
      { path: '.gitignore', content: '.env\n.data\ndist\nnode_modules\n.wrangler\n' }
    ];

    if (spec.provider === 'cloudflare') {
      const schema = await loadSchema();
      const worker = await loadWorkerBundle();
      files.push({ path: 'wrangler.toml', content: wranglerToml(spec) });
      files.push({ path: 'schema.sql', content: schema });
      files.push({ path: 'bot-row.sql', content: botRowSql(spec, sealed) });
      if (worker) files.push({ path: 'src/index.js', content: worker });
      else files.push({ path: 'src/README.txt', content: 'کد ورکر در زمان استقرار از مخزن BotForge ساخته می‌شود؛ اگر بسته باید خودکفا باشد، یک بار npm run build را اجرا کنید.\n' });
    } else {
      files.push({ path: 'Dockerfile', content: dockerfile(spec) });
      files.push({ path: 'docker-compose.yml', content: composeFile(spec) });
      files.push({
        path: 'railway.json',
        content: `${JSON.stringify(
          {
            $schema: 'https://railway.app/railway.schema.json',
            build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile', buildArgs: { INSTALL_FFMPEG: 'true' } },
            deploy: { startCommand: 'node dist/install/main.js', healthcheckPath: '/health', healthcheckTimeout: 180, restartPolicyType: 'ON_FAILURE', numReplicas: 1 }
          },
          null,
          2
        )}\n`
      });
    }

    return { files, webhookPath, sealed };
  }

  async function buildPackage(spec, template) {
    const result = await generateFiles(spec, template);
    const blob = buildZip(result.files);
    return { ...result, blob, fileName: `botforge-${spec.slug}-${spec.provider}.zip` };
  }

  window.BotForgeInstaller = {
    PLATFORMS,
    PROVIDERS,
    createSpec,
    publicSpec,
    suggestionFor,
    slugify,
    emptyForceMembership,
    rememberSecrets,
    recallSecrets,
    listInstallations,
    saveInstallation,
    updateInstallation,
    removeInstallation,
    activeInstallation,
    setActive,
    generateFiles,
    buildPackage,
    buildZip,
    downloadBlob,
    loadSchema,
    loadWorkerBundle,
    webhookPathSecret,
    sealToken,
    sha256Hex,
    maskToken,
    envFile
  };
})();
