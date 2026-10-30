/* BotForge deployment page — domain, health, deploy commands and package. */
(function () {
  'use strict';

  const BF = window.BF;
  const Installer = window.BotForgeInstaller;
  const Store = window.BotForgeInstallations;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const state = { installation: null, health: null };
  const el = {};

  function stepsFor(installation) {
    if (installation.provider === 'cloudflare') {
      return [
        {
          title: '۱. توکن Cloudflare را در ترمینال صادر کنید',
          body: 'export CLOUDFLARE_API_TOKEN="<توکن با دسترسی Workers Scripts:Edit، D1:Edit و Account Settings:Read>"\nexport CLOUDFLARE_ACCOUNT_ID="<شناسه حساب>"'
        },
        {
          title: '۲. بسته را باز و اسکریپت را اجرا کنید',
          body: 'unzip botforge-' + installation.slug + '-cloudflare.zip -d botforge-' + installation.slug + '\ncd botforge-' + installation.slug + '\nbash deploy.sh'
        },
        {
          title: '۳. خروجی اسکریپت را بررسی کنید',
          body: 'curl -sS https://<worker>.workers.dev/health'
        }
      ];
    }
    return [
      {
        title: '۱. بسته را باز کنید',
        body: 'unzip botforge-' + installation.slug + '-railway.zip -d botforge-' + installation.slug + '\ncd botforge-' + installation.slug
      },
      {
        title: '۲. با Railway یا Docker مستقر کنید',
        body: 'export RAILWAY_TOKEN="<توکن Railway>"\nbash deploy.sh\n\n# یا روی هر ماشین با Docker:\ndocker compose up -d --build'
      },
      {
        title: '۳. دامنه را در .env ثبت و دوباره مستقر کنید',
        body: 'PUBLIC_BASE_URL=https://<domain>\ncurl -sS https://<domain>/health'
      }
    ];
  }

  function renderProviders() {
    el.providersBox.innerHTML = Object.values(Installer.PROVIDERS)
      .map(
        (provider) => `<article class="card card-pad">
          <div class="row-between">
            <h4 style="margin:0">${icon(provider.icon, 'icon-sm')} ${esc(provider.name)}</h4>
            <a class="btn btn-ghost btn-sm" href="${esc(provider.tokenLink)}" target="_blank" rel="noopener noreferrer">${esc(provider.tokenLabel)}</a>
          </div>
          <p class="tiny dim mt-1">${esc(provider.summary)}</p>
          <p class="tiny dim">${esc(provider.note)}</p>
        </article>`
      )
      .join('');
  }

  function render() {
    const installation = state.installation;
    if (!installation) return;
    el.installProvider.textContent = Store.providerName(installation.provider);
    el.installFacts.innerHTML = Store.facts(installation)
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(value)}</strong></div>`)
      .join('');

    const hookPath = installation.webhookPath || '';
    const full = Store.webhookFullUrl(installation);
    el.webhookRow.innerHTML = full
      ? BF.copyRow(full, 'آدرس کامل وب‌هوک')
      : BF.copyRow(hookPath, 'مسیر وب‌هوک (پس از ثبت دامنه کامل می‌شود)');

    el.publicBaseUrl.value = Store.normalizedBase(installation);
    el.deployProviderLabel.textContent = Store.providerName(installation.provider);
    el.deploySteps.innerHTML = stepsFor(installation)
      .map((step) => `<h4>${esc(step.title)}</h4><pre class="code"><code>${esc(step.body)}</code></pre>`)
      .join('');

    el.fileChips.innerHTML = [
      '.env',
      'deploy.sh',
      installation.provider === 'cloudflare' ? 'wrangler.toml' : 'Dockerfile',
      installation.provider === 'cloudflare' ? 'bot-row.sql' : 'docker-compose.yml',
      'webhook.txt',
      'README.md'
    ]
      .map((file) => `<span class="chip"><code>${esc(file)}</code></span>`)
      .join('');

    const secrets = Installer.recallSecrets(installation.id);
    el.regenHint.textContent = secrets && secrets.token
      ? 'توکن این نصب تا زمانی که این تب باز است در حافظه نگه داشته می‌شود؛ بسته با همان مقادیر دوباره ساخته می‌شود.'
      : 'توکن ربات فقط در تب ویزارد نگه داشته می‌شود؛ برای ساخت دوباره بسته، یک نصب تازه بسازید.';

    renderProviders();
    BF.enhanceCopy(el.deploySteps);
    BF.enhanceCopy(el.webhookRow);
    renderHealth();
  }

  function renderHealth() {
    if (!state.health) {
      el.healthDetails.innerHTML = '';
      return;
    }
    const health = state.health;
    if (health.reason === 'missing-url') {
      el.healthDetails.innerHTML = '<p class="tiny dim">برای بررسی، ابتدا آدرس عمومی سرویس را ذخیره کنید.</p>';
      return;
    }
    const payload = health.payload || {};
    el.healthDetails.innerHTML = [
      ['وضعیت', health.ok ? 'سالم' : 'بدون پاسخ'],
      ['کد پاسخ', health.status ? fa(health.status) : '—'],
      ['تأخیر', health.latencyMs ? `${fa(health.latencyMs)} میلی‌ثانیه` : '—'],
      ['درایور ذخیره‌سازی', payload.storage && payload.storage.driver ? payload.storage.driver : '—'],
      ['نسخه', payload.version || '—']
    ]
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(String(value))}</strong></div>`)
      .join('');
  }

  function selectInstallation(id) {
    const installation = Store.byId(id) || Store.active() || Store.all()[0];
    if (!installation) return;
    state.installation = installation;
    Installer.setActive(installation.id);
    state.health = null;
    render();
  }

  function refreshSelect() {
    const items = Store.all();
    el.installSelect.innerHTML = items
      .map(
        (item) =>
          `<option value="${esc(item.id)}"${state.installation && item.id === state.installation.id ? ' selected' : ''}>${esc(item.name)} — ${esc(
            Store.providerName(item.provider)
          )}</option>`
      )
      .join('');
  }

  async function runHealth() {
    const installation = state.installation;
    if (!installation) return;
    const base = el.publicBaseUrl.value.trim();
    if (base && base !== Store.normalizedBase(installation)) {
      Installer.updateInstallation(installation.id, { publicBaseUrl: base });
      state.installation = Store.byId(installation.id);
    }
    el.healthBtn.disabled = true;
    BF.setStatus(el.healthStatus, 'در حال درخواست /health از سرویس...', 'busy', 'loader');
    const result = await Store.checkHealth(state.installation);
    state.health = result;
    el.healthBtn.disabled = false;
    if (result.ok) {
      BF.setStatus(el.healthStatus, `سرویس سالم است (کد ${fa(result.status)}، ${fa(result.latencyMs)} میلی‌ثانیه).`, 'ok', 'circle-check');
    } else if (result.reason === 'missing-url') {
      BF.setStatus(el.healthStatus, 'آدرس عمومی سرویس را وارد و ذخیره کنید.', 'error', 'alert-triangle');
    } else if (result.reason === 'network') {
      BF.setStatus(el.healthStatus, 'مرورگر به سرویس دسترسی نداشت؛ دامنه، HTTPS و CORS را بررسی کنید.', 'error', 'circle-x');
    } else if (result.reason === 'timeout') {
      BF.setStatus(el.healthStatus, 'پاسخ سرویس بیش از ۱۲ ثانیه طول کشید.', 'error', 'circle-x');
    } else {
      BF.setStatus(el.healthStatus, `سرویس پاسخ نداد (${result.reason}).`, 'error', 'circle-x');
    }
    renderHealth();
  }

  function cache() {
    el.installSelect = document.getElementById('installSelect');
    el.installProvider = document.getElementById('installProvider');
    el.installFacts = document.getElementById('installFacts');
    el.webhookRow = document.getElementById('webhookRow');
    el.publicBaseUrl = document.getElementById('publicBaseUrl');
    el.saveDomain = document.getElementById('saveDomain');
    el.healthBtn = document.getElementById('healthBtn');
    el.healthStatus = document.getElementById('healthStatus');
    el.healthDetails = document.getElementById('healthDetails');
    el.deployProviderLabel = document.getElementById('deployProviderLabel');
    el.deploySteps = document.getElementById('deploySteps');
    el.fileChips = document.getElementById('fileChips');
    el.regenHint = document.getElementById('regenHint');
    el.providersBox = document.getElementById('providersBox');
    el.app = document.getElementById('deployApp');
    el.empty = document.getElementById('deployEmpty');
  }

  function wire() {
    el.installSelect.addEventListener('change', () => {
      selectInstallation(el.installSelect.value);
      refreshSelect();
    });
    el.saveDomain.addEventListener('click', () => {
      const value = el.publicBaseUrl.value.trim().replace(/\/+$/, '');
      Installer.updateInstallation(state.installation.id, { publicBaseUrl: value });
      state.installation = Store.byId(state.installation.id);
      BF.setStatus(el.healthStatus, value ? 'آدرس سرویس ذخیره شد.' : 'آدرس سرویس پاک شد.', 'ok', 'circle-check');
      render();
    });
    el.healthBtn.addEventListener('click', runHealth);
    document.getElementById('regenerateBtn').addEventListener('click', async () => {
      try {
        await Store.regenerate(state.installation);
        BF.setStatus(el.healthStatus, 'بسته دوباره ساخته و دانلود شد.', 'ok', 'circle-check');
      } catch (error) {
        BF.setStatus(el.healthStatus, error.message, 'error', 'circle-x');
      }
    });
  }

  BF.ready(() => {
    if (!window.BotForgeInstallations) return;
    cache();
    const items = Store.all();
    if (!items.length) {
      el.app.hidden = true;
      Store.emptyState(el.empty, 'هنوز بسته‌ای ساخته نشده است؛ ابتدا در ویزارد یک ربات بسازید.', 'wizard.html', 'ساخت ربات', 'rocket');
      return;
    }
    el.empty.innerHTML = '';
    el.app.hidden = false;
    const param = new URLSearchParams(window.location.search).get('install');
    selectInstallation(param || (Store.active() && Store.active().id) || items[0].id);
    refreshSelect();
    wire();
    BF.hydrateIcons(document);
  });
})();
