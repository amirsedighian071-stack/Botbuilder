/* BotForge dashboard — the installations this browser produced. */
(function () {
  'use strict';

  const BF = window.BF;
  const Installer = window.BotForgeInstaller;
  const Store = window.BotForgeInstallations;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const healthCache = new Map();

  function emptyHost() {
    return document.getElementById('dashboardEmpty');
  }

  function renderStats(items) {
    const node = document.getElementById('installStats');
    if (!items.length) {
      node.innerHTML = '';
      return;
    }
    const healthy = items.filter((item) => {
      const health = healthCache.get(item.id);
      return health && health.ok;
    }).length;
    const cards = [
      ['نصب‌ها', items.length, 'layers'],
      ['Cloudflare', items.filter((item) => item.provider === 'cloudflare').length, 'cloud'],
      ['Railway / Docker', items.filter((item) => item.provider !== 'cloudflare').length, 'server'],
      ['سالم', healthy, 'shield-check']
    ];
    node.innerHTML = cards
      .map(
        ([label, value, iconName]) => `<div class="stat">
          <span class="stat-label">${icon(iconName, 'icon-xs')} ${esc(label)}</span>
          <span class="stat-value">${fa(value)}</span>
        </div>`
      )
      .join('');
  }

  function card(item) {
    const health = healthCache.get(item.id);
    const template = Store.templateOf(item);
    return `<article class="card" data-install="${esc(item.id)}">
      <div class="card-head">
        <div>
          <h3>${esc(item.name)}</h3>
          <span class="tiny dim">${esc(template ? template.name : item.templateId)} • ${esc(Store.platformName(item.platform))}</span>
        </div>
        <span class="badge badge-info">${esc(Store.providerName(item.provider))}</span>
      </div>
      <div class="card-body">
        <div class="selection-summary">
          <div class="summary-row"><span>خدمت</span><strong dir="ltr">${esc(Store.serviceName(item))}</strong></div>
          <div class="summary-row"><span>وب‌هوک</span><strong dir="ltr">${esc(item.webhookPath || '—')}</strong></div>
          <div class="summary-row"><span>سلامت</span><strong>${Store.statusBadge(item, health)}</strong></div>
        </div>

        <div class="field mt-2">
          <label for="base_${esc(item.id)}">آدرس سرویس مستقرشده</label>
          <div class="input-group">
            <input id="base_${esc(item.id)}" class="input" dir="ltr" data-base value="${esc(item.publicBaseUrl || '')}" placeholder="https://botforge-${esc(
              item.slug
            )}.workers.dev" />
            <button type="button" class="btn btn-outline btn-sm" data-save>ذخیره</button>
          </div>
        </div>

        <div class="btn-row mt-2">
          <button type="button" class="btn btn-primary btn-sm" data-health>${icon('activity', 'icon-xs')} بررسی سلامت</button>
          <a class="btn btn-outline btn-sm" href="deployment.html?install=${encodeURIComponent(item.id)}">استقرار</a>
          <a class="btn btn-ghost btn-sm" href="admin/index.html?install=${encodeURIComponent(item.id)}">کنسول مدیریت</a>
          <button type="button" class="btn btn-ghost btn-sm" data-regenerate>دانلود دوباره بسته</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove>حذف</button>
        </div>
        <div class="field-status mt-1" data-status role="status" aria-live="polite"></div>
      </div>
    </article>`;
  }

  function render() {
    const items = Store.all();
    const grid = document.getElementById('installGrid');
    const empty = emptyHost();
    if (!items.length) {
      grid.innerHTML = '';
      renderStats([]);
      Store.emptyState(empty, 'هنوز رباتی نساخته‌اید. در چهار گام بسته کامل استقرار را بگیرید.', 'wizard.html', 'ساخت ربات', 'rocket');
      return;
    }
    empty.innerHTML = '';
    grid.innerHTML = items.map(card).join('');
    renderStats(items);
    BF.hydrateIcons(grid);
    grid.querySelectorAll('[data-install]').forEach((node) => {
      const id = node.getAttribute('data-install');
      const item = Store.byId(id);
      if (!item) return;
      const status = node.querySelector('[data-status]');

      node.querySelector('[data-save]').addEventListener('click', () => {
        const value = node.querySelector('[data-base]').value.trim();
        Installer.updateInstallation(id, { publicBaseUrl: value });
        BF.setStatus(status, value ? 'آدرس سرویس ذخیره شد.' : 'آدرس سرویس پاک شد.', value ? 'ok' : '', 'circle-check');
        render();
      });

      node.querySelector('[data-health]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        BF.setStatus(status, 'در حال بررسی /health ...', 'busy', 'loader');
        const result = await Store.checkHealth(Store.byId(id));
        healthCache.set(id, result);
        button.disabled = false;
        if (result.ok) {
          BF.setStatus(status, `سرویس سالم است (کد ${fa(result.status)}، ${fa(result.latencyMs)} میلی‌ثانیه).`, 'ok', 'circle-check');
        } else {
          const reason =
            result.reason === 'missing-url'
              ? 'ابتدا آدرس سرویس را ثبت کنید.'
              : result.reason === 'network'
                ? 'مرورگر به سرویس دسترسی نداشت؛ دامنه و HTTPS را بررسی کنید.'
                : result.reason === 'timeout'
                  ? 'پاسخ سرویس بیش از حد طول کشید.'
                  : `سرویس پاسخ نداد (${result.reason}).`;
          BF.setStatus(status, reason, 'error', 'circle-x');
        }
        render();
      });

      node.querySelector('[data-regenerate]').addEventListener('click', async () => {
        try {
          await Store.regenerate(Store.byId(id));
          BF.setStatus(status, 'بسته دوباره ساخته و دانلود شد.', 'ok', 'circle-check');
        } catch (error) {
          BF.setStatus(status, error.message, 'error', 'circle-x');
        }
      });

      node.querySelector('[data-remove]').addEventListener('click', () => {
        if (!window.confirm('این نصب از این مرورگر حذف شود؟ سرویس مستقرشده حذف نمی‌شود.')) return;
        Installer.removeInstallation(id);
        healthCache.delete(id);
        BF.toast('نصب از این مرورگر حذف شد.', 'success');
        render();
      });
    });
  }

  BF.ready(() => {
    if (!window.BotForgeInstallations) return;
    render();
  });
})();
