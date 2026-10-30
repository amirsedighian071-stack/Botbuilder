/* BotForge installations — shared helpers for the console pages.
 *
 * An "installation" is the package this browser produced in the wizard. It is
 * stored without secrets; the sealed outputs live in the ZIP the user
 * downloaded. The console can probe the deployed instance over HTTPS and, when
 * the user shares the generated admin password, manage it live. */
(function () {
  'use strict';

  const BF = window.BF;
  const Installer = window.BotForgeInstaller;
  const Api = window.BotForgeApi;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const HEALTH_TIMEOUT = 12000;
  const PASSWORD_KEY = 'botforge.adminPassword';

  function all() {
    return Installer.listInstallations();
  }

  function active() {
    return Installer.activeInstallation();
  }

  function byId(id) {
    return all().find((item) => item.id === id) || null;
  }

  function templateOf(installation) {
    return (window.BOTFORGE_CATALOG || { bots: [] }).bots.find((bot) => bot.id === installation.templateId) || null;
  }

  function normalizedBase(installation) {
    if (!installation || !installation.publicBaseUrl) return '';
    return String(installation.publicBaseUrl).trim().replace(/\/+$/, '');
  }

  function webhookFullUrl(installation) {
    const base = normalizedBase(installation);
    const path = installation.webhookPath || '';
    if (!path) return '';
    return base ? `${base}${path}` : path;
  }

  function serviceName(installation) {
    return `botforge-${installation.slug}`;
  }

  /** Real health probe against the deployed instance (CORS is open on the runtime). */
  async function checkHealth(installation) {
    const base = normalizedBase(installation);
    if (!base) return { ok: false, reason: 'missing-url' };
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${base}/health`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        payload,
        reason: response.ok ? null : `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        ok: false,
        reason: error.name === 'AbortError' ? 'timeout' : 'network',
        latencyMs: Date.now() - startedAt
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function statusBadge(installation, health) {
    if (!normalizedBase(installation)) return '<span class="badge badge-warn">آدرس تنظیم نشده</span>';
    if (!health) return '<span class="badge badge-muted">بررسی نشده</span>';
    return health.ok
      ? `<span class="badge badge-success">${icon('circle-check', 'icon-xs')} سالم</span>`
      : `<span class="badge badge-danger">${icon('circle-x', 'icon-xs')} پاسخ نداد</span>`;
  }

  function platformName(id) {
    const platform = Installer.PLATFORMS[id];
    return platform ? platform.name : id;
  }

  function providerName(id) {
    const provider = Installer.PROVIDERS[id];
    return provider ? provider.name : id;
  }

  function emptyState(target, message, actionHref, actionLabel, actionIcon) {
    if (!target) return;
    target.innerHTML = `<div class="empty">
      ${icon(actionIcon || 'rocket')}
      <span>${esc(message)}</span>
      ${actionHref ? `<a class="btn btn-primary btn-sm" href="${esc(actionHref)}">${esc(actionLabel || 'ساخت ربات')}</a>` : ''}
    </div>`;
  }

  function facts(installation) {
    const template = templateOf(installation);
    return [
      ['ربات', installation.name || (template ? template.name : installation.templateId)],
      ['قالب', `${installation.templateId}${template ? ` — ${template.name}` : ''}`],
      ['پلتفرم', platformName(installation.platform)],
      ['میزبان', providerName(installation.provider)],
      ['نام سرویس', serviceName(installation)],
      ['شناسه ربات', installation.botId],
      ['آدرس سرویس', normalizedBase(installation) || 'ثبت نشده'],
      ['ساخته‌شده', BF.formatDateTime(installation.createdAt)],
      ['ایمیل مدیر', installation.adminEmail || '—']
    ];
  }

  /** Remember the admin password for this tab only (it never touches localStorage). */
  function rememberPassword(installation, password) {
    try {
      const raw = window.sessionStorage.getItem(PASSWORD_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[installation.id] = password;
      window.sessionStorage.setItem(PASSWORD_KEY, JSON.stringify(map));
    } catch {
      /* sessionStorage may be blocked */
    }
  }

  function recallPassword(installation) {
    try {
      const raw = window.sessionStorage.getItem(PASSWORD_KEY);
      const map = raw ? JSON.parse(raw) : {};
      if (map[installation.id]) return map[installation.id];
    } catch {
      /* ignore */
    }
    const secrets = Installer.recallSecrets(installation.id);
    return (secrets && secrets.adminPassword) || '';
  }

  /**
   * Signs in to the deployed instance with the credentials generated for this
   * installation, so the console never asks for a server address or a login.
   */
  async function connect(installation, password) {
    const base = normalizedBase(installation);
    if (!base) throw new Error('ابتدا آدرس سرویس مستقرشده را در صفحه استقرار ثبت کنید.');
    const pass = password || recallPassword(installation);
    if (!pass) throw new Error('گذرواژه مدیر را وارد کنید (در فایل .env بسته آمده است).');
    Api.setBase(base);
    const result = await Api.login(installation.adminEmail || `admin@${installation.slug}.botforge.local`, pass);
    rememberPassword(installation, pass);
    window.dispatchEvent(new Event('botforge:connection'));
    return result;
  }

  /** Rebuilds the package for an installation while the tab still holds the token. */
  async function regenerate(installation) {
    const secrets = Installer.recallSecrets(installation.id);
    if (!secrets || !secrets.token) {
      throw new Error('توکن ربات در این تب موجود نیست؛ برای بسته جدید یک نصب تازه در ویزارد بسازید.');
    }
    const spec = {
      ...installation,
      token: secrets.token,
      masterKey: secrets.masterKey,
      jwtSecret: secrets.jwtSecret,
      adminPassword: secrets.adminPassword,
      integrationKeys: secrets.keys || {}
    };
    const result = await Installer.generateFiles(spec, templateOf(installation));
    const blob = Installer.buildZip(result.files);
    Installer.downloadBlob(blob, `botforge-${installation.slug}-${installation.provider}.zip`);
    return result.files;
  }

  window.BotForgeInstallations = {
    all,
    active,
    byId,
    templateOf,
    normalizedBase,
    webhookFullUrl,
    serviceName,
    checkHealth,
    statusBadge,
    platformName,
    providerName,
    emptyState,
    facts,
    rememberPassword,
    recallPassword,
    connect,
    regenerate,
    fa
  };
})();
