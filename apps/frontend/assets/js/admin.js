/* BotForge system administration — stats, admins, API keys, jobs, audits, config. */
(function () {
  'use strict';

  const BF = window.BF;
  const Api = window.BotForgeApi;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const ALL_SCOPES = [
    { id: 'bots:read', label: 'خواندن ربات‌ها' },
    { id: 'bots:write', label: 'نوشتن ربات‌ها' },
    { id: 'users:read', label: 'خواندن کاربران' },
    { id: 'users:write', label: 'نوشتن کاربران' },
    { id: 'broadcast', label: 'ارسال همگانی' },
    { id: 'system:read', label: 'خواندن سامانه' }
  ];

  const state = {
    auditsPage: 1,
    auditsPages: 1,
    jobsStatus: 'pending',
    admin: null
  };

  const el = {};

  function renderGate() {
    const authed = Api.authenticated;
    el.gate.hidden = authed;
    el.app.hidden = !authed;
    if (!authed) {
      el.gateBase.value = Api.base || '';
      el.gateStatus.textContent = Api.configured
        ? 'آدرس ذخیره شده است؛ با حساب مدیر ارشد وارد شوید.'
        : 'برای مدیریت سامانه، آدرس کنترل‌پلین و حساب مدیر را وارد کنید.';
    }
  }

  async function login() {
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

  async function loadStats() {
    const stats = await Api.get('/api/system/stats');
    const cards = [
      { label: 'ربات‌ها', value: stats.bots, icon: 'bot' },
      { label: 'کاربران', value: stats.users, icon: 'users' },
      { label: 'پیام ۲۴ ساعت', value: stats.messages24h, icon: 'message-circle' },
      { label: 'کارهای در صف', value: stats.jobsPending, icon: 'clock' },
      { label: 'مدیران', value: stats.admins, icon: 'shield-check' },
      { label: 'قالب‌ها', value: stats.templates, icon: 'layers' }
    ];
    el.statGrid.innerHTML = cards
      .map(
        (card) => `<div class="stat">
          <span class="stat-label">${icon(card.icon, 'icon-xs')} ${esc(card.label)}</span>
          <span class="stat-value">${fa(card.value ?? 0)}</span>
        </div>`
      )
      .join('');

    el.envLine.innerHTML = `
      <span class="badge badge-info">محیط: ${esc(stats.environment || '—')}</span>
      <span class="badge badge-muted">ذخیره‌سازی: ${esc(stats.storageDriver || '—')}</span>
      <span class="badge badge-muted">ربات‌های بارگذاری‌شده: ${fa(stats.loadedRuntimes || 0)}</span>
      <span class="badge badge-muted">دسته‌ها: ${fa(stats.categories || 0)}</span>`;
  }

  async function loadAdmins() {
    const result = await Api.get('/api/auth/admins');
    const items = result.items || [];
    el.adminsBody.innerHTML = items
      .map(
        (admin) => `<tr>
          <td data-label="ایمیل" dir="ltr">${esc(admin.email)}</td>
          <td data-label="نقش">${esc({ superadmin: 'مدیر ارشد', operator: 'اپراتور', viewer: 'بازدیدکننده' }[admin.role] || admin.role)}</td>
          <td data-label="وضعیت">${
            admin.isActive ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-danger">غیرفعال</span>'
          }</td>
          <td data-label="آخرین ورود">${admin.lastLoginAt ? BF.formatDateTime(admin.lastLoginAt) : '—'}</td>
          <td data-label="" class="stack-actions">
            <button type="button" class="btn btn-sm ${admin.isActive ? 'btn-outline' : 'btn-secondary'}" data-toggle-admin="${esc(
              admin.id
            )}" data-active="${admin.isActive ? 'false' : 'true'}">${admin.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button>
          </td>
        </tr>`
      )
      .join('');

    el.adminsBody.querySelectorAll('[data-toggle-admin]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await Api.patch(`/api/auth/admins/${button.getAttribute('data-toggle-admin')}`, {
            active: button.getAttribute('data-active') === 'true'
          });
          BF.toast('وضعیت مدیر تغییر کرد.', 'success');
          await loadAdmins();
        } catch (error) {
          BF.toast(error.message, 'error');
        }
      });
    });
  }

  async function createAdmin() {
    const email = document.getElementById('newAdminEmail').value.trim();
    const password = document.getElementById('newAdminPassword').value;
    const role = document.getElementById('newAdminRole').value;
    if (!email || password.length < 10) {
      BF.toast('ایمیل معتبر و گذرواژه حداقل ۱۰ کاراکتری لازم است.', 'error');
      return;
    }
    try {
      await Api.post('/api/auth/admins', { email, password, role });
      BF.toast('مدیر جدید ساخته شد.', 'success');
      document.getElementById('newAdminEmail').value = '';
      document.getElementById('newAdminPassword').value = '';
      await loadAdmins();
      await loadStats();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadKeys() {
    const result = await Api.get('/api/keys');
    const items = result.items || [];
    el.keysBody.innerHTML = items.length
      ? items
          .map(
            (key) => `<tr>
              <td data-label="نام">${esc(key.name)}</td>
              <td data-label="پیشوند"><code class="code-inline">${esc(key.prefix)}…</code></td>
              <td data-label="دسترسی‌ها">${key.scopes.map((scope) => `<span class="chip">${esc(scope)}</span>`).join(' ')}</td>
              <td data-label="آخرین استفاده">${key.lastUsedAt ? BF.relativeTime(key.lastUsedAt) : '—'}</td>
              <td data-label="وضعیت">${
                key.revokedAt ? '<span class="badge badge-danger">لغو شده</span>' : '<span class="badge badge-success">فعال</span>'
              }</td>
              <td data-label="" class="stack-actions">${
                key.revokedAt
                  ? ''
                  : `<button type="button" class="btn btn-sm btn-danger" data-revoke-key="${esc(key.id)}">لغو کلید</button>`
              }</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" data-label="">کلید API ساخته نشده است.</td></tr>';

    el.keysBody.querySelectorAll('[data-revoke-key]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('این کلید لغو شود؟ سرویس‌هایی که از آن استفاده می‌کنند از دسترسی محروم می‌شوند.')) return;
        try {
          await Api.del(`/api/keys/${button.getAttribute('data-revoke-key')}`);
          BF.toast('کلید لغو شد.', 'info');
          await loadKeys();
        } catch (error) {
          BF.toast(error.message, 'error');
        }
      });
    });
  }

  function renderScopeChoices() {
    el.scopeChoices.innerHTML = ALL_SCOPES.map(
      (scope, index) => `<label class="check-row">
        <input type="checkbox" value="${esc(scope.id)}" ${index < 2 ? 'checked' : ''} />
        <span>${esc(scope.label)} — <code class="code-inline">${esc(scope.id)}</code></span>
      </label>`
    ).join('');
  }

  async function createKey() {
    const name = document.getElementById('newKeyName').value.trim();
    const scopes = Array.from(el.scopeChoices.querySelectorAll('input:checked')).map((input) => input.value);
    if (name.length < 2) {
      BF.toast('نام کلید حداقل ۲ کاراکتر باشد.', 'error');
      return;
    }
    if (!scopes.length) {
      BF.toast('حداقل یک دسترسی انتخاب کنید.', 'error');
      return;
    }
    try {
      const result = await Api.post('/api/keys', { name, scopes });
      el.newKeyBox.innerHTML = `<div class="notice notice-success">${icon('key')}<div><strong>کلید ساخته شد — فقط همین یک بار نمایش داده می‌شود</strong>${esc(
        result.warning || ''
      )}</div></div>${BF.copyRow(result.key, 'کلید API')}`;
      BF.enhanceCopy(el.newKeyBox);
      document.getElementById('newKeyName').value = '';
      BF.toast('کلید API ساخته شد.', 'success');
      await loadKeys();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadJobs() {
    const result = await Api.get(`/api/system/jobs?status=${encodeURIComponent(state.jobsStatus)}`);
    const items = result.items || [];
    el.jobsBody.innerHTML = items.length
      ? items
          .map(
            (job) => `<tr>
              <td data-label="ربات">${esc(job.botName || job.botId || '—')}</td>
              <td data-label="نوع">${esc(job.type || '—')}</td>
              <td data-label="تلاش" class="num">${fa(job.attempts || 0)}</td>
              <td data-label="زمان اجرا">${job.runAt ? BF.formatDateTime(job.runAt) : '—'}</td>
              <td data-label="خطا" dir="ltr">${job.lastError ? esc(String(job.lastError).slice(0, 120)) : '—'}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" data-label="">کاری با این وضعیت وجود ندارد.</td></tr>';
  }

  async function purgeJobs() {
    if (!window.confirm('کارهای قدیمی‌تر از ۷ روز حذف شوند؟')) return;
    try {
      const result = await Api.post('/api/system/jobs/purge', { olderThanHours: 168 });
      BF.toast(`${fa(result.removed)} کار حذف شد.`, 'info');
      await loadJobs();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadAudits(page) {
    state.auditsPage = page || 1;
    const result = await Api.get(`/api/audits?page=${state.auditsPage}&pageSize=20`);
    state.auditsPages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 20)));
    el.auditsBody.innerHTML = (result.items || []).length
      ? result.items
          .map(
            (record) => `<tr>
              <td data-label="زمان">${BF.formatDateTime(record.createdAt)}</td>
              <td data-label="عملیات"><code class="code-inline">${esc(record.action)}</code></td>
              <td data-label="هدف" dir="ltr">${esc(record.target)}</td>
              <td data-label="عامل" dir="ltr">${esc(record.actorId)}</td>
              <td data-label="IP" dir="ltr">${esc(record.ip || '—')}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" data-label="">رکوردی ثبت نشده است.</td></tr>';
    el.auditsPager.innerHTML = `
      <span class="tiny dim">صفحه ${fa(state.auditsPage)} از ${fa(state.auditsPages)}</span>
      <div class="btn-row">
        <button type="button" class="btn btn-outline btn-sm" id="auditsPrev" ${state.auditsPage <= 1 ? 'disabled' : ''}>قبلی</button>
        <button type="button" class="btn btn-outline btn-sm" id="auditsNext" ${state.auditsPage >= state.auditsPages ? 'disabled' : ''}>بعدی</button>
      </div>`;
    document.getElementById('auditsPrev').addEventListener('click', () => loadAudits(state.auditsPage - 1));
    document.getElementById('auditsNext').addEventListener('click', () => loadAudits(state.auditsPage + 1));
  }

  async function loadConfig() {
    const result = await Api.get('/api/system/config');
    const config = result.config || {};
    const entries = Object.entries(config).sort((a, b) => a[0].localeCompare(b[0]));
    el.configBox.innerHTML = `
      <div class="stack mb-2">
        ${Object.entries(result.integrations || {})
          .map(
            ([key, value]) =>
              `<div class="summary-row"><span>یکپارچه‌سازی ${esc(key)}</span><strong>${
                value ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-warn">تنظیم نشده</span>'
              }</strong></div>`
          )
          .join('')}
      </div>
      <h4>متغیرهای الزامی</h4>
      <div class="chips mb-2">${(result.requiredEnv || [])
        .map((key) => `<span class="chip chip-active"><code>${esc(key)}</code></span>`)
        .join('')}</div>
      <h4>پیکربندی جاری (مقادیر حساس ماسک شده‌اند)</h4>
      <div class="table-wrap">
        <table class="data-table data-stack">
          <thead><tr><th>کلید</th><th>مقدار</th></tr></thead>
          <tbody>${entries
            .map(
              ([key, value]) =>
                `<tr><td data-label="کلید"><code class="code-inline">${esc(key)}</code></td><td data-label="مقدار" dir="ltr">${esc(
                  typeof value === 'object' ? JSON.stringify(value) : String(value)
                )}</td></tr>`
            )
            .join('')}</tbody>
        </table>
      </div>`;
  }

  function cache() {
    el.gate = document.getElementById('adminGate');
    el.app = document.getElementById('adminApp');
    el.gateBase = document.getElementById('gateBase');
    el.gateEmail = document.getElementById('gateEmail');
    el.gatePassword = document.getElementById('gatePassword');
    el.gateBtn = document.getElementById('gateLoginBtn');
    el.gateStatus = document.getElementById('gateStatus');
    el.statGrid = document.getElementById('statGrid');
    el.envLine = document.getElementById('envLine');
    el.adminsBody = document.getElementById('adminsBody');
    el.keysBody = document.getElementById('keysBody');
    el.scopeChoices = document.getElementById('scopeChoices');
    el.newKeyBox = document.getElementById('newKeyBox');
    el.jobsBody = document.getElementById('jobsBody');
    el.auditsBody = document.getElementById('auditsBody');
    el.auditsPager = document.getElementById('auditsPager');
    el.configBox = document.getElementById('configBox');
    el.whoami = document.getElementById('whoami');
  }

  function wire() {
    el.gateBtn.addEventListener('click', login);
    document.getElementById('gateForm').addEventListener('submit', (event) => {
      event.preventDefault();
      login();
    });
    document.getElementById('createAdminBtn').addEventListener('click', createAdmin);
    document.getElementById('createKeyBtn').addEventListener('click', createKey);
    document.getElementById('jobsRefresh').addEventListener('click', loadJobs);
    document.getElementById('jobsPurge').addEventListener('click', purgeJobs);
    document.getElementById('jobsStatus').addEventListener('change', (event) => {
      state.jobsStatus = event.target.value;
      loadJobs();
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
      Api.clearSession();
      BF.toast('از حساب خارج شدید.', 'info');
      location.reload();
    });
  }

  async function boot() {
    renderGate();
    if (!Api.authenticated) return;
    try {
      const me = await Api.verifySession();
      state.admin = me.admin || null;
      if (state.admin) {
        el.whoami.textContent = `${state.admin.email} — ${state.admin.role}`;
      }
      renderGate();
      renderScopeChoices();
      await Promise.all([loadStats(), loadAdmins(), loadKeys(), loadJobs(), loadAudits(1), loadConfig()]);
    } catch (error) {
      BF.toast(error.message, 'error');
      renderGate();
    }
  }

  BF.ready(() => {
    if (!document.getElementById('adminApp')) return;
    cache();
    wire();
    boot();
  });
})();
