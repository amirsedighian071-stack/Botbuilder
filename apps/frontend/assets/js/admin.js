/* BotForge bot console — local installation profile plus live management of the
 * deployed instance (stats, users, broadcast, force membership). */
(function () {
  'use strict';

  const BF = window.BF;
  const Installer = window.BotForgeInstaller;
  const Store = window.BotForgeInstallations;
  const Api = window.BotForgeApi;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const state = {
    installation: null,
    channels: [],
    users: { items: [], total: 0, page: 1, pageSize: 10, search: '' },
    connected: false,
    botId: '',
    live: null,
    broadcastTimer: null,
    systemLoaded: false,
    jobStatus: 'pending'
  };

  const el = {};

  /* --------------------------------------------------------- local part */

  function renderSelect() {
    const items = Store.all();
    el.installSelect.innerHTML = items
      .map(
        (item) =>
          `<option value="${esc(item.id)}"${state.installation && item.id === state.installation.id ? ' selected' : ''}>${esc(
            item.name
          )} — ${esc(Store.platformName(item.platform))}</option>`
      )
      .join('');
  }

  function renderProfile() {
    const installation = state.installation;
    if (!installation) return;
    el.adminProvider.textContent = Store.providerName(installation.provider);
    el.adminFacts.innerHTML = Store.facts(installation)
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(value)}</strong></div>`)
      .join('');

    const hook = Store.webhookFullUrl(installation);
    el.adminWebhook.innerHTML = hook
      ? BF.copyRow(hook, 'آدرس وب‌هوک')
      : BF.copyRow(installation.webhookPath || '', 'مسیر وب‌هوک (بدون دامنه)');

    const keys = Object.entries(installation.integrationKeys || {});
    el.adminKeys.innerHTML = keys.length
      ? keys
          .map(
            ([key, value]) =>
              `<span class="chip ${value === 'set' ? 'chip-active' : ''}"><code>${esc(key)}</code>${
                value === 'set' ? '' : ' — خالی'
              }</span>`
          )
      : '<span class="chip">این ربات کلید بیرونی ندارد</span>';

    el.instanceUrl.value = Store.normalizedBase(installation);
    el.adminEmail.value = installation.adminEmail || '';
    const secrets = Installer.recallSecrets(installation.id);
    el.adminPassword.value = (secrets && secrets.adminPassword) || '';
    el.forceEnabled.checked = Boolean(installation.forceMembership && installation.forceMembership.enabled);
    el.forceMessage.value = (installation.forceMembership && installation.forceMembership.message) || 'برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید.';
    state.channels = (installation.forceMembership && installation.forceMembership.channels) || [];
    renderChannels();
    BF.enhanceCopy(el.adminWebhook);
  }

  function renderChannels() {
    if (!state.channels.length) {
      el.forceChannels.innerHTML = `<div class="empty">${icon('layers')}<span>کانالی اضافه نشده است.</span></div>`;
      return;
    }
    el.forceChannels.innerHTML = state.channels
      .map(
        (channel, index) => `<div class="card card-pad" data-channel="${index}">
          <div class="row-between">
            <strong>کانال ${fa(index + 1)}</strong>
            <button type="button" class="btn btn-sm btn-danger" data-remove-channel="${index}">${icon('trash-2', 'icon-sm')} حذف</button>
          </div>
          <div class="form-grid mt-1">
            <div class="field">
              <label>پلتفرم</label>
              <select data-field="platform">
                ${Object.values(Installer.PLATFORMS)
                  .map((platform) => `<option value="${platform.id}"${channel.platform === platform.id ? ' selected' : ''}>${esc(platform.name)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label>شناسه چت</label>
              <input dir="ltr" data-field="chatId" value="${esc(channel.chatId || '')}" placeholder="@channel" />
            </div>
            <div class="field">
              <label>عنوان کانال</label>
              <input data-field="title" value="${esc(channel.title || '')}" placeholder="کانال رسمی" />
            </div>
            <div class="field">
              <label>لینک دعوت</label>
              <input dir="ltr" data-field="inviteLink" value="${esc(channel.inviteLink || '')}" placeholder="https://t.me/..." />
            </div>
          </div>
          <label class="check-row mt-1">
            <input type="checkbox" data-field="required" ${channel.required !== false ? 'checked' : ''} />
            <span>عضویت در این کانال الزامی است</span>
          </label>
        </div>`
      )
      .join('');
    el.forceChannels.querySelectorAll('[data-remove-channel]').forEach((button) => {
      button.addEventListener('click', () => {
        collectChannels();
        state.channels.splice(Number(button.getAttribute('data-remove-channel')), 1);
        renderChannels();
      });
    });
  }

  function collectChannels() {
    const cards = Array.from(el.forceChannels.querySelectorAll('[data-channel]'));
    state.channels = cards.map((card, index) => ({
      id: `ch_${index + 1}`,
      platform: card.querySelector('[data-field="platform"]').value,
      chatId: card.querySelector('[data-field="chatId"]').value.trim(),
      title: card.querySelector('[data-field="title"]').value.trim(),
      inviteLink: card.querySelector('[data-field="inviteLink"]').value.trim() || undefined,
      required: card.querySelector('[data-field="required"]').checked
    }));
    return state.channels;
  }

  function forcePayload() {
    const channels = collectChannels();
    return {
      enabled: el.forceEnabled.checked,
      channels,
      message: el.forceMessage.value.trim() || 'برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید.',
      buttonLabel: 'بررسی عضویت',
      recheckLabel: 'عضو شدم',
      bypassAdmins: true,
      cacheSeconds: 60
    };
  }

  function saveForceLocal() {
    const payload = forcePayload();
    if (payload.enabled && !payload.channels.length) {
      BF.setStatus(el.forceStatus, 'برای فعال‌سازی حداقل یک کانال اضافه کنید.', 'error', 'circle-x');
      return null;
    }
    const invalid = payload.channels.find((channel) => !channel.chatId || !channel.title);
    if (invalid) {
      BF.setStatus(el.forceStatus, 'شناسه چت و عنوان همه کانال‌ها الزامی است.', 'error', 'circle-x');
      return null;
    }
    const updated = Installer.updateInstallation(state.installation.id, {
      forceMembership: payload,
      status: 'regenerate-needed'
    });
    state.installation = updated;
    BF.setStatus(el.forceStatus, 'در نصب ذخیره شد؛ برای اعمال در بسته، آن را دوباره بسازید.', 'ok', 'circle-check');
    BF.toast('تنظیمات عضویت اجباری در نصب ذخیره شد.', 'success');
    return payload;
  }

  async function pushForceLive() {
    if (!state.connected || !state.botId) {
      BF.setStatus(el.forceStatus, 'ابتدا به ربات مستقرشده وصل شوید.', 'error', 'alert-triangle');
      return;
    }
    const payload = forcePayload();
    try {
      await Api.put(`/api/bots/${state.botId}/force-membership`, payload);
      BF.setStatus(el.forceStatus, 'روی ربات زنده اعمال شد.', 'ok', 'circle-check');
      BF.toast('عضویت اجباری روی ربات اعمال شد.', 'success');
    } catch (error) {
      BF.setStatus(el.forceStatus, error.message, 'error', 'circle-x');
    }
  }

  /* ---------------------------------------------------------- live part */

  async function connect() {
    const url = el.instanceUrl.value.trim();
    if (!url) {
      BF.setStatus(el.loginStatus, 'آدرس سرویس را وارد کنید (خروجی deploy.sh).', 'error', 'circle-x');
      return;
    }
    el.loginBtn.disabled = true;
    BF.setStatus(el.loginStatus, 'در حال اتصال و ورود با گذرواژه بسته...', 'busy', 'loader');
    try {
      Installer.updateInstallation(state.installation.id, { publicBaseUrl: url.replace(/\/+$/, '') });
      state.installation = Store.byId(state.installation.id);
      const password = el.adminPassword.value || Store.recallPassword(state.installation);
      const email = el.adminEmail.value.trim() || state.installation.adminEmail;
      const result = await Store.connect({ ...state.installation, adminEmail: email }, password);
      state.connected = true;
      el.connectionBadge.className = 'badge badge-success';
      el.connectionBadge.textContent = 'متصل';
      el.logoutBtn.hidden = false;
      if (result.admin && result.admin.email) el.whoami.textContent = result.admin.email;
      BF.setStatus(el.loginStatus, `ورود موفق: ${result.admin ? result.admin.email : email}`, 'ok', 'circle-check');
      await loadLive();
      el.livePanel.hidden = false;
    } catch (error) {
      BF.setStatus(el.loginStatus, error.message, 'error', 'circle-x');
    } finally {
      el.loginBtn.disabled = false;
    }
  }

  function disconnect() {
    Api.clearSession();
    state.connected = false;
    state.botId = '';
    el.connectionBadge.className = 'badge badge-info';
    el.connectionBadge.textContent = 'وصل نشده';
    el.logoutBtn.hidden = true;
    el.livePanel.hidden = true;
    el.whoami.textContent = '';
    state.systemLoaded = false;
    BF.setStatus(el.loginStatus, 'اتصال قطع شد.', '', 'info');
  }

  async function loadLive() {
    const bots = await Api.get('/api/bots?pageSize=100');
    const items = bots.items || [];
    if (!items.length) throw new Error('روی این سرویس رباتی ثبت نشده است.');
    state.botId = items[0].id;
    await refreshLive();
    await loadUsers();
  }

  async function refreshLive() {
    if (!state.connected || !state.botId) return;
    try {
      const [dashboard, detail] = await Promise.all([
        Api.get(`/api/bots/${state.botId}/dashboard`),
        Api.get(`/api/bots/${state.botId}`)
      ]);
      state.live = { dashboard, detail };
      const metrics = dashboard.metrics || {};
      const cards = [
        { label: 'کاربران', value: metrics.users || 0, icon: 'users' },
        { label: 'کاربر جدید ۲۴h', value: metrics.newUsers24h || 0, icon: 'user-plus' },
        { label: 'پیام ۲۴h', value: metrics.messages24h || 0, icon: 'message-circle' },
        { label: 'خطا ۷ روز', value: metrics.errors7d || 0, icon: 'alert-triangle' },
        { label: 'کارهای در صف', value: metrics.jobsPending || 0, icon: 'clock' }
      ];
      el.liveStats.innerHTML = cards
        .map(
          (card) => `<div class="stat">
            <span class="stat-label">${icon(card.icon, 'icon-xs')} ${esc(card.label)}</span>
            <span class="stat-value">${fa(card.value)}</span>
          </div>`
        )
        .join('');
      renderEvents(dashboard.events || []);
      renderBroadcast(dashboard.broadcast || null);
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  function renderEvents(events) {
    if (!events.length) {
      el.eventsBox.innerHTML = `<div class="empty">${icon('activity')}<span>رویدادی ثبت نشده است.</span></div>`;
      return;
    }
    el.eventsBox.innerHTML = `<ul class="timeline">${events
      .map((event) => {
        const tone = event.level === 'error' ? 'is-failed' : event.level === 'warn' ? 'is-running' : 'is-done';
        return `<li class="timeline-item ${tone}">
          <span class="timeline-marker">${icon(event.level === 'error' ? 'alert-triangle' : 'check', 'icon-xs')}</span>
          <div class="timeline-body">
            <b>${esc(event.type)}</b>
            <p>${esc(
              Object.entries(event.payload || {})
                .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                .join(' — ') || 'بدون جزئیات'
            )}</p>
            <span class="timeline-time">${BF.formatDateTime(event.createdAt)}</span>
          </div>
        </li>`;
      })
      .join('')}</ul>`;
  }

  function renderBroadcast(progress) {
    if (!progress) {
      el.broadcastProgress.innerHTML = '<p class="tiny dim">ارسال همگانی ثبت نشده است.</p>';
      return;
    }
    const total = Number(progress.total || 0);
    const sent = Number(progress.sent || 0);
    const failed = Number(progress.failed || 0);
    const percent = total ? Math.round(((sent + failed) / total) * 100) : 0;
    el.broadcastProgress.innerHTML = `
      <div class="summary-row"><span>وضعیت</span><strong>${esc(progress.status || 'در حال ارسال')}</strong></div>
      <div class="summary-row"><span>موفق</span><strong>${fa(sent)}</strong></div>
      <div class="summary-row"><span>ناموفق</span><strong>${fa(failed)}</strong></div>
      <div class="summary-row"><span>کل</span><strong>${fa(total)}</strong></div>
      <p class="tiny dim mt-1">${fa(percent)}٪ تکمیل</p>`;
  }

  async function loadUsers() {
    if (!state.connected || !state.botId) return;
    const params = new URLSearchParams({ page: String(state.users.page), pageSize: String(state.users.pageSize) });
    if (state.users.search) params.set('search', state.users.search);
    try {
      const result = await Api.get(`/api/bots/${state.botId}/users?${params}`);
      state.users = { ...state.users, ...result, items: result.items || [] };
      renderUsers();
    } catch (error) {
      el.usersBody.innerHTML = `<tr><td colspan="5" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  function renderUsers() {
    const { items, total, page, pageSize } = state.users;
    el.usersBody.innerHTML = items.length
      ? items
          .map(
            (user) => `<tr>
            <td data-label="کاربر"><strong>${esc(user.firstName || user.username || user.platformUserId)}</strong><br /><span class="tiny dim" dir="ltr">${esc(
              user.platformUserId
            )}</span></td>
            <td data-label="پیام" class="num">${fa(user.messageCount || 0)}</td>
            <td data-label="آخرین فعالیت">${BF.relativeTime(user.lastSeenAt)}</td>
            <td data-label="وضعیت">${
              user.isBlocked ? '<span class="badge badge-danger">مسدود</span>' : '<span class="badge badge-success">مجاز</span>'
            }</td>
            <td data-label="" class="stack-actions">
              <button type="button" class="btn btn-sm ${user.isBlocked ? 'btn-secondary' : 'btn-outline'}" data-block="${esc(
                user.platformUserId
              )}" data-blocked="${user.isBlocked ? 'false' : 'true'}">${user.isBlocked ? 'رفع مسدودی' : 'مسدودسازی'}</button>
            </td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" data-label="">کاربری برای این ربات ثبت نشده است.</td></tr>';

    const pages = Math.max(1, Math.ceil(total / pageSize));
    el.usersPager.innerHTML = `
      <span class="tiny dim">صفحه ${fa(page)} از ${fa(pages)} — ${fa(total)} کاربر</span>
      <div class="btn-row">
        <button type="button" class="btn btn-outline btn-sm" id="usersPrev" ${page <= 1 ? 'disabled' : ''}>قبلی</button>
        <button type="button" class="btn btn-outline btn-sm" id="usersNext" ${page >= pages ? 'disabled' : ''}>بعدی</button>
      </div>`;
    document.getElementById('usersPrev').addEventListener('click', () => {
      state.users.page = Math.max(1, state.users.page - 1);
      loadUsers();
    });
    document.getElementById('usersNext').addEventListener('click', () => {
      state.users.page += 1;
      loadUsers();
    });
    el.usersBody.querySelectorAll('[data-block]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await Api.patch(`/api/bots/${state.botId}/users/${encodeURIComponent(button.getAttribute('data-block'))}`, {
            blocked: button.getAttribute('data-blocked') === 'true'
          });
          BF.toast('وضعیت کاربر به‌روزرسانی شد.', 'success');
          await loadUsers();
        } catch (error) {
          BF.toast(error.message, 'error');
        }
      });
    });
  }

  async function sendBroadcast() {
    const text = el.broadcastText.value.trim();
    if (!text) {
      BF.toast('متن پیام را وارد کنید.', 'error');
      return;
    }
    if (!el.broadcastConfirm.checked) {
      BF.toast('ارسال را تأیید کنید.', 'error');
      return;
    }
    el.broadcastBtn.disabled = true;
    try {
      const result = await Api.post(`/api/bots/${state.botId}/broadcast`, { text, parseMode: 'HTML' });
      BF.toast(`ارسال برای ${fa(result.total)} کاربر در صف قرار گرفت.`, 'success');
      el.broadcastConfirm.checked = false;
      pollBroadcast();
    } catch (error) {
      BF.toast(error.message, 'error');
    } finally {
      el.broadcastBtn.disabled = false;
    }
  }

  async function pollBroadcast() {
    if (!state.connected || !state.botId) return;
    try {
      const result = await Api.get(`/api/bots/${state.botId}/broadcast`);
      renderBroadcast(result.progress || null);
      if (result.progress && ['running', 'queued'].includes(result.progress.status)) {
        window.clearTimeout(state.broadcastTimer);
        state.broadcastTimer = window.setTimeout(pollBroadcast, 4000);
      }
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  /* -------------------------------------------------------- system part */

  function statCard(label, value, iconName) {
    return `<div class="stat">
      <span class="stat-label">${icon(iconName, 'icon-xs')} ${esc(label)}</span>
      <span class="stat-value">${fa(value)}</span>
    </div>`;
  }

  async function loadSystem() {
    if (!state.connected) return;
    try {
      const stats = await Api.get('/api/system/stats');
      el.systemStats.innerHTML = [
        statCard('ربات‌ها', stats.bots, 'bot'),
        statCard('کاربران', stats.users, 'users'),
        statCard('پیام ۲۴h', stats.messages24h, 'message-circle'),
        statCard('مدیران', stats.admins, 'shield-check'),
        statCard('کارهای در صف', stats.jobsPending, 'clock'),
        statCard('قالب‌ها', stats.templates, 'layers')
      ].join('');
      el.systemConfig.innerHTML = [
        ['درایور پایگاه‌داده', stats.storageDriver],
        ['محیط اجرا', stats.environment],
        ['ربات‌های بارگذاری‌شده', fa(stats.loadedRuntimes)],
        ['دسته‌بندی قالب‌ها', fa(stats.categories)]
      ]
        .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(value)}</strong></div>`)
        .join('');
    } catch (error) {
      el.systemStats.innerHTML = `<div class="empty">${icon('alert-triangle')}<span>${esc(error.message)}</span></div>`;
    }

    try {
      const config = await Api.get('/api/system/config');
      const integrations = config.integrations || {};
      const labels = { ai: 'هوش مصنوعی', speech: 'گفتار', weather: 'آب‌وهوا', news: 'اخبار', gold: 'طلا و ارز' };
      el.systemIntegrations.innerHTML = Object.entries(labels)
        .map(
          ([key, label]) =>
            `<span class="chip ${integrations[key] ? 'chip-active' : ''}">${icon(integrations[key] ? 'circle-check' : 'circle-x', 'icon-xs')} ${esc(label)}</span>`
        )
        .join('');
    } catch (error) {
      el.systemIntegrations.innerHTML = `<span class="chip">${esc(error.message)}</span>`;
    }

    await Promise.all([loadJobs(), loadAdmins(), loadKeys(), loadAudits()]);
    state.systemLoaded = true;
  }

  async function loadJobs() {
    try {
      const params = new URLSearchParams({ status: state.jobStatus });
      const result = await Api.get(`/api/system/jobs?${params}`);
      const items = result.items || [];
      el.jobsBody.innerHTML = items.length
        ? items
            .map(
              (job) => `<tr>
              <td data-label="ربات">${esc(job.botName || job.botId || '—')}</td>
              <td data-label="نوع" dir="ltr" class="mono">${esc(job.type || job.name || '—')}</td>
              <td data-label="وضعیت">${esc(job.status || '—')}</td>
              <td data-label="تلاش" class="num">${fa(`${job.attempts || 0}/${job.maxAttempts || 0}`)}</td>
              <td data-label="زمان">${BF.formatDateTime(job.createdAt)}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" data-label="">کاری با این وضعیت نیست.</td></tr>';
    } catch (error) {
      el.jobsBody.innerHTML = `<tr><td colspan="5" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  async function purgeJobs() {
    try {
      const result = await Api.post('/api/system/jobs/purge', { olderThanHours: 168 });
      BF.toast(`${fa(result.removed || 0)} کار قدیمی حذف شد.`, 'success');
      await loadJobs();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadAdmins() {
    try {
      const result = await Api.get('/api/auth/admins');
      const items = result.items || [];
      el.adminsBody.innerHTML = items.length
        ? items
            .map(
              (admin) => `<tr>
              <td data-label="ایمیل" dir="ltr">${esc(admin.email)}</td>
              <td data-label="نقش">${esc(admin.role)}</td>
              <td data-label="وضعیت">${
                admin.isActive === false || admin.active === false
                  ? '<span class="badge badge-danger">غیرفعال</span>'
                  : '<span class="badge badge-success">فعال</span>'
              }</td>
              <td data-label="آخرین ورود">${admin.lastLoginAt ? BF.formatDateTime(admin.lastLoginAt) : '—'}</td>
              <td data-label="" class="stack-actions">
                <button type="button" class="btn btn-sm btn-outline" data-admin="${esc(admin.id)}" data-active="${
                admin.isActive === false || admin.active === false ? 'true' : 'false'
              }">${admin.isActive === false || admin.active === false ? 'فعال‌سازی' : 'غیرفعال‌سازی'}</button>
              </td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" data-label="">مدیری ثبت نشده است.</td></tr>';
      el.adminsBody.querySelectorAll('[data-admin]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            await Api.patch(`/api/auth/admins/${encodeURIComponent(button.getAttribute('data-admin'))}`, {
              active: button.getAttribute('data-active') === 'true'
            });
            BF.toast('وضعیت مدیر به‌روزرسانی شد.', 'success');
            await loadAdmins();
          } catch (error) {
            BF.toast(error.message, 'error');
          }
        });
      });
    } catch (error) {
      el.adminsBody.innerHTML = `<tr><td colspan="5" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  async function createAdmin() {
    const email = el.newAdminEmail.value.trim();
    const password = el.newAdminPassword.value;
    const role = el.newAdminRole.value;
    if (!email || password.length < 8) {
      BF.setStatus(el.adminStatus, 'ایمیل و گذرواژه حداقل ۸ کاراکتری لازم است.', 'error', 'circle-x');
      return;
    }
    try {
      await Api.post('/api/auth/admins', { email, password, role });
      BF.setStatus(el.adminStatus, 'مدیر جدید ساخته شد.', 'ok', 'circle-check');
      el.newAdminEmail.value = '';
      el.newAdminPassword.value = '';
      await loadAdmins();
    } catch (error) {
      BF.setStatus(el.adminStatus, error.message, 'error', 'circle-x');
    }
  }

  async function loadKeys() {
    try {
      const result = await Api.get('/api/keys');
      const items = result.items || [];
      el.keysBody.innerHTML = items.length
        ? items
            .map(
              (key) => `<tr>
              <td data-label="نام">${esc(key.name)}</td>
              <td data-label="پیشوند" dir="ltr" class="mono">${esc(key.prefix)}…</td>
              <td data-label="دسترسی" dir="ltr" class="mono">${esc((key.scopes || []).join(', '))}</td>
              <td data-label="آخرین استفاده">${key.lastUsedAt ? BF.relativeTime(key.lastUsedAt) : '—'}</td>
              <td data-label="" class="stack-actions">${
                key.revokedAt
                  ? '<span class="badge badge-muted">لغو شده</span>'
                  : `<button type="button" class="btn btn-sm btn-danger" data-key="${esc(key.id)}">لغو کلید</button>`
              }</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" data-label="">کلیدی ساخته نشده است.</td></tr>';
      el.keysBody.querySelectorAll('[data-key]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            await Api.del(`/api/keys/${encodeURIComponent(button.getAttribute('data-key'))}`);
            BF.toast('کلید لغو شد.', 'success');
            await loadKeys();
          } catch (error) {
            BF.toast(error.message, 'error');
          }
        });
      });
    } catch (error) {
      el.keysBody.innerHTML = `<tr><td colspan="5" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  async function createKey() {
    const name = el.newKeyName.value.trim();
    const scopes = el.newKeyScopes.value
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (!name || !scopes.length) {
      BF.toast('نام و دسترسی‌های کلید را وارد کنید.', 'error');
      return;
    }
    try {
      const result = await Api.post('/api/keys', { name, scopes });
      el.newKeyBox.innerHTML = `${BF.copyRow(result.key, 'کلید کامل (فقط همین بار)')}
        <p class="tiny dim mt-1">همین حالا آن را ذخیره کنید؛ مقدار کامل دیگر نمایش داده نمی‌شود.</p>`;
      BF.enhanceCopy(el.newKeyBox);
      el.newKeyName.value = '';
      await loadKeys();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function loadAudits() {
    try {
      const result = await Api.get('/api/audits?page=1&pageSize=25');
      const items = result.items || [];
      el.auditsBody.innerHTML = items.length
        ? items
            .map(
              (entry) => `<tr>
              <td data-label="زمان">${BF.formatDateTime(entry.createdAt)}</td>
              <td data-label="عملیات" dir="ltr" class="mono">${esc(entry.action)}</td>
              <td data-label="هدف" dir="auto">${esc(entry.target || '—')}</td>
              <td data-label="کاربر" dir="ltr">${esc(entry.actorId || '—')}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="4" data-label="">رکوردی ثبت نشده است.</td></tr>';
    } catch (error) {
      el.auditsBody.innerHTML = `<tr><td colspan="4" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  /* ---------------------------------------------------------------- wire */

  function cache() {
    el.installSelect = document.getElementById('installSelect');
    el.adminEmpty = document.getElementById('adminEmpty');
    el.adminApp = document.getElementById('adminApp');
    el.adminProvider = document.getElementById('adminProvider');
    el.adminFacts = document.getElementById('adminFacts');
    el.adminWebhook = document.getElementById('adminWebhook');
    el.adminKeys = document.getElementById('adminKeys');
    el.forceEnabled = document.getElementById('forceEnabled');
    el.forceMessage = document.getElementById('forceMessage');
    el.forceChannels = document.getElementById('forceChannels');
    el.forceStatus = document.getElementById('forceStatus');
    el.instanceUrl = document.getElementById('instanceUrl');
    el.adminEmail = document.getElementById('adminEmail');
    el.adminPassword = document.getElementById('adminPassword');
    el.loginBtn = document.getElementById('loginBtn');
    el.logoutBtn = document.getElementById('logoutBtn');
    el.loginStatus = document.getElementById('loginStatus');
    el.connectionBadge = document.getElementById('connectionBadge');
    el.livePanel = document.getElementById('livePanel');
    el.liveStats = document.getElementById('liveStats');
    el.usersBody = document.getElementById('usersBody');
    el.usersPager = document.getElementById('usersPager');
    el.userSearch = document.getElementById('userSearch');
    el.broadcastText = document.getElementById('broadcastText');
    el.broadcastConfirm = document.getElementById('broadcastConfirm');
    el.broadcastBtn = document.getElementById('broadcastBtn');
    el.broadcastProgress = document.getElementById('broadcastProgress');
    el.eventsBox = document.getElementById('eventsBox');
    el.whoami = document.getElementById('whoami');
    el.systemStats = document.getElementById('systemStats');
    el.systemIntegrations = document.getElementById('systemIntegrations');
    el.systemConfig = document.getElementById('systemConfig');
    el.jobsBody = document.getElementById('jobsBody');
    el.jobStatus = document.getElementById('jobStatus');
    el.adminsBody = document.getElementById('adminsBody');
    el.newAdminEmail = document.getElementById('newAdminEmail');
    el.newAdminPassword = document.getElementById('newAdminPassword');
    el.newAdminRole = document.getElementById('newAdminRole');
    el.adminStatus = document.getElementById('adminStatus');
    el.keysBody = document.getElementById('keysBody');
    el.newKeyName = document.getElementById('newKeyName');
    el.newKeyScopes = document.getElementById('newKeyScopes');
    el.newKeyBox = document.getElementById('newKeyBox');
    el.auditsBody = document.getElementById('auditsBody');
  }

  function wire() {
    el.installSelect.addEventListener('change', () => {
      state.installation = Installer.setActive(el.installSelect.value);
      renderProfile();
      disconnect();
    });
    document.getElementById('addChannelBtn').addEventListener('click', () => {
      collectChannels();
      state.channels.push({ id: `ch_${state.channels.length + 1}`, platform: 'telegram', chatId: '', title: '', inviteLink: '', required: true });
      renderChannels();
    });
    document.getElementById('saveForceBtn').addEventListener('click', saveForceLocal);
    document.getElementById('pushForceBtn').addEventListener('click', pushForceLive);
    el.loginBtn.addEventListener('click', connect);
    el.logoutBtn.addEventListener('click', disconnect);
    el.userSearch.addEventListener('input', () => {
      window.clearTimeout(el.userSearch._timer);
      el.userSearch._timer = window.setTimeout(() => {
        state.users.search = el.userSearch.value.trim();
        state.users.page = 1;
        loadUsers();
      }, 350);
    });
    el.broadcastBtn.addEventListener('click', sendBroadcast);
    document.getElementById('broadcastRefresh').addEventListener('click', pollBroadcast);
    document.getElementById('refreshLive').addEventListener('click', refreshLive);
    document.querySelectorAll('[data-tabs="admin"] [data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('data-tab') === 'system' && !state.systemLoaded) void loadSystem();
      });
    });
    el.jobStatus.addEventListener('change', () => {
      state.jobStatus = el.jobStatus.value;
      void loadJobs();
    });
    document.getElementById('purgeJobs').addEventListener('click', purgeJobs);
    document.getElementById('createAdminBtn').addEventListener('click', createAdmin);
    document.getElementById('createKeyBtn').addEventListener('click', createKey);
    document.getElementById('refreshAudits').addEventListener('click', loadAudits);
  }

  function boot() {
    const items = Store.all();
    if (!items.length) {
      el.adminApp.hidden = true;
      Store.emptyState(el.adminEmpty, 'هنوز نصبی ساخته نشده است؛ ابتدا با ویزارد یک ربات بسازید.', '../wizard.html', 'ساخت ربات');
      return;
    }
    el.adminEmpty.innerHTML = '';
    el.adminApp.hidden = false;
    const param = new URLSearchParams(location.search).get('install');
    state.installation = (param && Installer.setActive(param)) || Store.active() || items[0];
    renderSelect();
    renderProfile();
    BF.hydrateIcons(document);
  }

  BF.ready(() => {
    if (!document.getElementById('adminApp')) return;
    if (!window.BotForgeInstallations) {
      window.location.href = '../wizard.html';
      return;
    }
    cache();
    wire();
    boot();
  });
})();
