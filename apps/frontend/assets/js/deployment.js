/* BotForge deployment page — provider catalog, deployment history, live steps, package export. */
(function () {
  'use strict';

  const BF = window.BF;
  const Api = window.BotForgeApi;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const state = {
    bots: [],
    botId: '',
    deployments: [],
    selectedId: '',
    selected: null,
    packageFiles: null,
    providers: null,
    timer: null
  };

  const el = {};

  function statusTone(status) {
    if (status === 'healthy') return 'success';
    if (status === 'failed') return 'danger';
    if (['validating', 'provisioning', 'uploading', 'deploying', 'registering'].includes(status)) return 'info';
    return 'muted';
  }

  function statusLabel(status) {
    return (
      {
        queued: 'در صف',
        validating: 'اعتبارسنجی',
        provisioning: 'آماده‌سازی منابع',
        uploading: 'بارگذاری کد',
        deploying: 'استقرار',
        registering: 'اتصال وب‌هوک',
        healthy: 'سالم و فعال',
        failed: 'ناموفق'
      }[status] || status
    );
  }

  function renderGate() {
    const authed = Api.authenticated;
    el.gate.hidden = authed;
    el.app.hidden = !authed;
    if (!authed) {
      el.gateBase.value = Api.base || '';
      el.gateStatus.textContent = Api.configured
        ? 'آدرس کنترل‌پلین ذخیره شده است؛ برای دیدن استقرارها وارد شوید.'
        : 'فهرست استقرارها و بسته‌های خروجی از کنترل‌پلین خوانده می‌شوند؛ ابتدا آدرس سرور را وارد و وارد شوید.';
    }
  }

  async function gateLogin() {
    const base = Api.setBase(el.gateBase.value);
    if (!base) {
      BF.toast('آدرس کنترل‌پلین را وارد کنید.', 'error');
      return;
    }
    el.gateBtn.disabled = true;
    el.gateStatus.textContent = 'در حال ورود...';
    try {
      await Api.login(el.gateEmail.value.trim(), el.gatePassword.value);
      BF.toast('ورود موفق.', 'success');
      window.dispatchEvent(new Event('botforge:connection'));
      await boot();
    } catch (error) {
      el.gateStatus.textContent = error.message;
    } finally {
      el.gateBtn.disabled = false;
    }
  }

  async function loadProviders() {
    try {
      state.providers = await Api.get('/api/deploy/providers');
      renderProviders();
    } catch (error) {
      el.providersBox.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  function renderProviders() {
    if (!state.providers || !el.providersBox) return;
    el.providersBox.innerHTML = `<div class="grid grid-2">${(state.providers.providers || [])
      .map(
        (provider) => `<article class="card card-pad">
          <div class="row-between">
            <h3 style="margin:0">${icon(provider.id === 'cloudflare' ? 'cloud' : 'server', 'icon-sm')} ${esc(provider.name)}</h3>
            <span class="badge badge-info">${esc(provider.capabilities.slice(0, 2).join(' · '))}</span>
          </div>
          <p class="tiny muted mt-1">${esc(provider.description)}</p>
          <div class="chips mt-1">${provider.capabilities.map((item) => `<span class="chip chip-active">${esc(item)}</span>`).join('')}</div>
          <div class="mt-2 stack">
            ${provider.credentials
              .map(
                (credential) => `<div class="requirement">${icon('key', 'icon-sm')}<div><b>${esc(credential.label)}</b><span>${esc(
                  credential.hint
                )}</span><br /><a class="link-arrow" href="${esc(credential.link)}" target="_blank" rel="noopener noreferrer">${icon(
                  'external-link',
                  'icon-xs'
                )} دریافت API</a></div></div>`
              )
              .join('')}
          </div>
          <p class="tiny dim mt-1">محدودیت: ${esc((provider.limitations || []).join('، '))}</p>
        </article>`
      )
      .join('')}</div>`;
  }

  async function loadBots() {
    const result = await Api.get('/api/bots?pageSize=100');
    state.bots = result.items || [];
    const param = new URLSearchParams(location.search).get('bot');
    const match = param && state.bots.find((bot) => bot.id === param || bot.slug === param);
    state.botId = match ? match.id : state.botId && state.bots.some((bot) => bot.id === state.botId) ? state.botId : state.bots[0] ? state.bots[0].id : '';
    renderBotSelect();
  }

  function renderBotSelect() {
    if (!state.bots.length) {
      el.botSelect.innerHTML = '<option value="">رباتی وجود ندارد</option>';
      el.noBots.hidden = false;
      return;
    }
    el.noBots.hidden = true;
    el.botSelect.innerHTML = state.bots
      .map((bot) => `<option value="${esc(bot.id)}" ${bot.id === state.botId ? 'selected' : ''}>${esc(bot.name)} — ${esc(bot.platform)}</option>`)
      .join('');
  }

  async function loadDeployments() {
    if (!state.botId) {
      el.history.innerHTML = `<div class="empty">${icon('rocket')}<span>برای مشاهده تاریخچه، ابتدا یک ربات بسازید.</span><a class="btn btn-primary btn-sm" href="wizard.html">ساخت ربات</a></div>`;
      return;
    }
    try {
      const result = await Api.get(`/api/bots/${state.botId}/deployments`);
      state.deployments = result.items || [];
      renderHistory();
      if (state.deployments.length) {
        const param = new URLSearchParams(location.search).get('deployment');
        const target = param && state.deployments.find((item) => item.id === param);
        await openDeployment(target ? target.id : state.deployments[0].id);
      } else {
        el.detail.innerHTML = `<div class="empty">${icon('info')}<span>برای این ربات استقراری ثبت نشده است. با ویزارد استقرار خودکار را آغاز کنید.</span><a class="btn btn-primary btn-sm" href="wizard.html?bot=${encodeURIComponent(
          state.botId
        )}">${icon('rocket', 'icon-sm')} آغاز استقرار</a></div>`;
        el.detailTitle.textContent = 'جزئیات استقرار';
      }
    } catch (error) {
      el.history.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  function renderHistory() {
    if (!state.deployments.length) {
      el.history.innerHTML = `<div class="empty">${icon('info')}<span>تاریخچه‌ای موجود نیست.</span></div>`;
      return;
    }
    el.history.innerHTML = `<div class="stack">${state.deployments
      .map((deployment) => {
        const active = deployment.id === state.selectedId;
        return `<button type="button" class="deploy-item${active ? ' is-active' : ''}" data-deployment="${esc(deployment.id)}">
          <span class="deploy-item-top">
            <span class="badge badge-${statusTone(deployment.status)}">${esc(statusLabel(deployment.status))}</span>
            <span class="tiny dim">${esc(deployment.provider)}</span>
          </span>
          <span class="deploy-item-url" dir="ltr">${esc(deployment.urls && deployment.urls.app ? deployment.urls.app : 'بدون آدرس')}</span>
          <span class="tiny dim">${BF.formatDateTime(deployment.createdAt)}${
            deployment.durationMs ? ` — ${fa(Math.round(deployment.durationMs / 1000))} ثانیه` : ''
          }</span>
        </button>`;
      })
      .join('')}</div>`;

    el.history.querySelectorAll('[data-deployment]').forEach((button) => {
      button.addEventListener('click', () => openDeployment(button.getAttribute('data-deployment')));
    });
  }

  async function openDeployment(id) {
    state.selectedId = id;
    renderHistory();
    try {
      const result = await Api.get(`/api/bots/${state.botId}/deployments/${id}`);
      state.selected = result.deployment;
      state.packageFiles = null;
      renderDetail();
      const url = new URL(location.href);
      url.searchParams.set('bot', state.botId);
      url.searchParams.set('deployment', id);
      history.replaceState(null, '', url);
      if (!['healthy', 'failed'].includes(result.deployment.status)) startPolling();
      else stopPolling();
    } catch (error) {
      el.detail.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  function startPolling() {
    stopPolling();
    state.timer = window.setInterval(async () => {
      if (!state.selectedId) return;
      try {
        const result = await Api.get(`/api/bots/${state.botId}/deployments/${state.selectedId}`);
        state.selected = result.deployment;
        renderDetail();
        renderHistory();
        if (['healthy', 'failed'].includes(result.deployment.status)) {
          stopPolling();
          BF.toast(result.deployment.status === 'healthy' ? 'استقرار کامل شد و سرویس سالم است.' : 'استقرار ناموفق بود.', result.deployment.status === 'healthy' ? 'success' : 'error');
          await loadDeployments();
        }
      } catch (error) {
        stopPolling();
        BF.toast(error.message, 'error');
      }
    }, 4000);
  }

  function stopPolling() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  function renderDetail() {
    const deployment = state.selected;
    if (!deployment) return;
    el.detailTitle.innerHTML = `استقرار <code class="code-inline">${esc(deployment.id)}</code>`;
    const urls = deployment.urls || {};
    const health = deployment.health;

    el.detail.innerHTML = `
      <div class="row-between">
        <div class="row-between" style="gap:.4rem">
          ${BF.statusBadge(deployment.status)}
          <span class="badge badge-muted">${esc(deployment.provider)}</span>
          ${health ? `<span class="badge badge-${health.ok ? 'success' : 'danger'}">${health.ok ? 'سلامت تأیید شد' : 'سلامت ناموفق'}</span>` : ''}
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-outline btn-sm" id="detailRefresh">${icon('refresh-cw', 'icon-sm')} به‌روزرسانی</button>
          ${health || urls.health ? `<button type="button" class="btn btn-secondary btn-sm" id="detailHealth">${icon('activity', 'icon-sm')} بررسی سلامت</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" id="detailPackage">${icon('download', 'icon-sm')} بسته استقرار</button>
        </div>
      </div>

      <div class="summary-row mt-2"><span>حساب میزبانی</span><strong>${esc(deployment.accountName || deployment.accountId || '—')}</strong></div>
      <div class="summary-row"><span>زمان شروع</span><strong>${BF.formatDateTime(deployment.createdAt)}</strong></div>
      <div class="summary-row"><span>پایان</span><strong>${deployment.finishedAt ? BF.formatDateTime(deployment.finishedAt) : 'در حال اجرا'}</strong></div>
      <div class="summary-row"><span>مدت</span><strong>${deployment.durationMs ? `${fa(Math.round(deployment.durationMs / 1000))} ثانیه` : '—'}</strong></div>
      ${health ? `<div class="summary-row"><span>کد پاسخ سلامت</span><strong>${fa(health.status || 0)} — ${fa(health.latencyMs || 0)} میلی‌ثانیه</strong></div>` : ''}

      ${
        urls.app || urls.webhook || urls.health
          ? `<div class="stack mt-2">
              ${urls.app ? BF.copyRow(urls.app, 'سرویس') : ''}
              ${urls.webhook ? BF.copyRow(urls.webhook, 'وب‌هوک') : ''}
              ${urls.health ? BF.copyRow(urls.health, 'سلامت') : ''}
            </div>`
          : ''
      }

      ${deployment.error ? `<div class="notice notice-danger mt-2">${icon('alert-triangle')}<div><strong>خطای استقرار</strong>${esc(deployment.error)}</div></div>` : ''}

      <h4 class="mt-3">گام‌های اجرا</h4>
      <ul class="timeline">${(deployment.steps || [])
        .map((step) => {
          const cls =
            step.status === 'done' ? 'is-done' : step.status === 'failed' ? 'is-failed' : step.status === 'running' ? 'is-running' : '';
          const marker =
            step.status === 'done'
              ? icon('check', 'icon-xs')
              : step.status === 'failed'
                ? icon('x', 'icon-xs')
                : step.status === 'running'
                  ? icon('loader', 'icon-xs')
                  : icon('circle', 'icon-xs');
          return `<li class="timeline-item ${cls}">
            <span class="timeline-marker">${marker}</span>
            <div class="timeline-body">
              <b>${esc(step.title)}</b>
              ${step.detail ? `<p>${esc(step.detail)}</p>` : ''}
              <span class="timeline-time">${step.finishedAt ? BF.formatDateTime(step.finishedAt) : step.startedAt ? 'در حال اجرا' : 'در انتظار'}</span>
            </div>
          </li>`;
        })
        .join('')}</ul>

      <h4 class="mt-3">گزارش زنده</h4>
      <div class="log-box">${(deployment.logs || [])
        .map(
          (log) =>
            `<div class="log-line is-${esc(log.level)}"><span class="log-time">${esc(
              new Date(log.at).toLocaleTimeString('en-GB')
            )}</span><span>${esc(log.message)}</span></div>`
        )
        .join('') || '<div class="log-line is-info">هنوز گزارشی ثبت نشده است.</div>'}</div>

      <div id="packageBox" class="mt-3"></div>`;

    BF.enhanceCopy(el.detail);

    document.getElementById('detailRefresh').addEventListener('click', () => openDeployment(deployment.id));
    const healthBtn = document.getElementById('detailHealth');
    if (healthBtn) healthBtn.addEventListener('click', checkHealth);
    document.getElementById('detailPackage').addEventListener('click', loadPackage);
  }

  async function checkHealth() {
    if (!state.selected) return;
    try {
      const result = await Api.post(`/api/bots/${state.botId}/deployments/${state.selected.id}/health`, {});
      state.selected = result.deployment;
      renderDetail();
      BF.toast(result.deployment.health && result.deployment.health.ok ? 'سرویس سالم است.' : 'سرویس پاسخ سالم نداد.', result.deployment.health && result.deployment.health.ok ? 'success' : 'error');
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadPackage() {
    if (!state.selected) return;
    const box = document.getElementById('packageBox');
    box.innerHTML = '<p class="tiny dim">در حال ساخت بسته...</p>';
    try {
      const result = await Api.get(`/api/bots/${state.botId}/deployments/${state.selected.id}/package`);
      state.packageFiles = result.files || [];
      box.innerHTML = `
        <div class="row-between">
          <h4 style="margin:0">بسته استقرار (${fa(state.packageFiles.length)} فایل)</h4>
          <button type="button" class="btn btn-outline btn-sm" id="downloadAll">${icon('download', 'icon-sm')} دانلود همه</button>
        </div>
        <p class="tiny dim mt-1">این فایل‌ها همان چیزی است که سرور برای استقرار ساخته است؛ قبل از انتشار، دسترسی فایل‌ها را محدود نگه دارید.</p>
        <div class="stack mt-2">${state.packageFiles
          .map(
            (file) => `<div class="code-wrap selectable">
              <div class="code-bar">
                <span dir="ltr"><code>${esc(file.fileName)}</code></span>
                <span class="btn-row">
                  <button type="button" class="copy-btn" data-copy-file="${esc(file.fileName)}">${icon('copy', 'icon-sm')} کپی</button>
                  <button type="button" class="copy-btn" data-download-file="${esc(file.fileName)}">${icon('download', 'icon-sm')} دانلود</button>
                </span>
              </div>
              <pre class="code selectable"><code>${esc(file.content)}</code></pre>
            </div>`
          )
          .join('')}</div>`;
      BF.enhanceCopy(box);

      box.querySelectorAll('[data-copy-file]').forEach((button) => {
        button.addEventListener('click', () => {
          const file = state.packageFiles.find((item) => item.fileName === button.getAttribute('data-copy-file'));
          if (file) BF.copyText(file.content, button);
        });
      });
      box.querySelectorAll('[data-download-file]').forEach((button) => {
        button.addEventListener('click', () => {
          const file = state.packageFiles.find((item) => item.fileName === button.getAttribute('data-download-file'));
          if (file) download(file.fileName, file.content);
        });
      });
      document.getElementById('downloadAll').addEventListener('click', () => {
        state.packageFiles.forEach((file, index) => window.setTimeout(() => download(file.fileName, file.content), index * 350));
      });
    } catch (error) {
      box.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  function download(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function cache() {
    el.gate = document.getElementById('deployGate');
    el.app = document.getElementById('deployApp');
    el.gateBase = document.getElementById('gateBase');
    el.gateEmail = document.getElementById('gateEmail');
    el.gatePassword = document.getElementById('gatePassword');
    el.gateBtn = document.getElementById('gateLoginBtn');
    el.gateStatus = document.getElementById('gateStatus');
    el.botSelect = document.getElementById('botSelect');
    el.botSelectWrap = document.getElementById('botSelectWrap');
    el.history = document.getElementById('deployHistory');
    el.detail = document.getElementById('deployDetail');
    el.detailTitle = document.getElementById('deployDetailTitle');
    el.providersBox = document.getElementById('providersBox');
    el.noBots = document.getElementById('noBots');
    el.refresh = document.getElementById('refreshDeployments');
    el.newDeploy = document.getElementById('newDeploy');
  }

  function wire() {
    el.gateBtn.addEventListener('click', gateLogin);
    document.getElementById('gateForm').addEventListener('submit', (event) => {
      event.preventDefault();
      gateLogin();
    });
    el.botSelect.addEventListener('change', () => {
      state.botId = el.botSelect.value;
      state.selectedId = '';
      const url = new URL(location.href);
      url.searchParams.set('bot', state.botId);
      url.searchParams.delete('deployment');
      history.replaceState(null, '', url);
      loadDeployments();
    });
    el.refresh.addEventListener('click', async () => {
      el.refresh.classList.add('is-busy');
      try {
        await loadDeployments();
        BF.toast('فهرست استقرارها به‌روزرسانی شد.', 'success');
      } catch (error) {
        BF.toast(error.message, 'error');
      } finally {
        el.refresh.classList.remove('is-busy');
      }
    });
    el.newDeploy.addEventListener('click', () => {
      location.href = state.botId ? `wizard.html?bot=${encodeURIComponent(state.botId)}` : 'wizard.html';
    });
  }

  async function boot() {
    renderGate();
    if (!Api.authenticated) return;
    try {
      await Api.verifySession();
      renderGate();
      await loadBots();
      await Promise.all([loadProviders(), loadDeployments()]);
    } catch (error) {
      BF.toast(error.message, 'error');
      renderGate();
    }
  }

  function init() {
    if (!document.getElementById('deployApp')) return;
    cache();
    wire();
    boot();
  }

  BF.ready(init);
})();
