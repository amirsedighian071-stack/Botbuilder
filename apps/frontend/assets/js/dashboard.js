/* BotForge dashboard — live metrics, users, broadcast, force membership, settings. */
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
    detail: null,
    dashboard: null,
    users: { items: [], total: 0, page: 1, pageSize: 10, search: '', blocked: '' },
    settings: null,
    forceMembership: { enabled: false, channels: [] },
    deployment: null,
    events: [],
    broadcastTimer: null,
    loading: false
  };

  const el = {};

  function platformLabel(platform) {
    return { telegram: 'تلگرام', bale: 'بله', rubika: 'روبیکا' }[platform] || platform || '—';
  }

  function statusTone(status) {
    return status === 'active' ? 'success' : status === 'maintenance' ? 'warn' : status === 'paused' ? 'warn' : 'danger';
  }

  /* --------------------------------------------------------------- gate */

  function renderGate() {
    const authed = Api.authenticated;
    el.gate.hidden = authed;
    el.app.hidden = !authed;
    if (!authed) {
      el.gateBase.value = Api.base || '';
      el.gateStatus.innerHTML = Api.configured
        ? 'آدرس کنترل‌پلین ذخیره شده است؛ برای مشاهده داشبورد وارد شوید.'
        : 'برای داشبورد زنده، آدرس کنترل‌پلین خود را وارد و با حساب مدیر وارد شوید.';
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
      BF.toast('ورود موفق؛ داشبورد در حال بارگذاری است.', 'success');
      window.dispatchEvent(new Event('botforge:connection'));
      await boot();
    } catch (error) {
      el.gateStatus.textContent = error.message;
    } finally {
      el.gateBtn.disabled = false;
    }
  }

  /* ---------------------------------------------------------------- data */

  function skeleton() {
    el.stats.innerHTML = Array.from({ length: 5 })
      .map(() => `<div class="stat"><div class="skeleton" style="width:60%;height:12px"></div><div class="skeleton mt-1" style="width:40%;height:22px"></div></div>`)
      .join('');
  }

  async function loadBots() {
    const result = await Api.get('/api/bots?pageSize=100');
    state.bots = result.items || [];
    if (!state.botId || !state.bots.some((bot) => bot.id === state.botId)) {
      const param = new URLSearchParams(location.search).get('bot');
      const match = param && state.bots.find((bot) => bot.id === param || bot.slug === param);
      state.botId = match ? match.id : state.bots[0] ? state.bots[0].id : '';
    }
    renderSwitcher();
  }

  function activeBot() {
    return state.bots.find((bot) => bot.id === state.botId) || null;
  }

  async function loadDashboard() {
    if (!state.botId) return;
    skeleton();
    const [dashboard, detail] = await Promise.all([
      Api.get(`/api/bots/${state.botId}/dashboard`),
      Api.get(`/api/bots/${state.botId}`)
    ]);
    state.dashboard = dashboard;
    state.detail = detail;
    state.events = dashboard.events || [];
    renderHeader();
    renderStats();
    renderEvents();
    renderHealthStrip();
    await Promise.all([loadUsers(), loadSettings(), loadForceMembership(), loadDeployment()]);
  }

  async function loadUsers() {
    if (!state.botId) return;
    const params = new URLSearchParams({ page: String(state.users.page), pageSize: String(state.users.pageSize) });
    if (state.users.search) params.set('search', state.users.search);
    if (state.users.blocked) params.set('blocked', state.users.blocked);
    try {
      const result = await Api.get(`/api/bots/${state.botId}/users?${params}`);
      state.users = { ...state.users, ...result, items: result.items || [] };
      renderUsers();
    } catch (error) {
      el.usersBody.innerHTML = `<tr><td colspan="6" data-label="">${esc(error.message)}</td></tr>`;
    }
  }

  async function loadSettings() {
    if (!state.botId) return;
    try {
      state.settings = await Api.get(`/api/bots/${state.botId}/settings`);
      renderSettings();
    } catch (error) {
      el.settingsBox.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  async function loadForceMembership() {
    if (!state.botId) return;
    try {
      const result = await Api.get(`/api/bots/${state.botId}/force-membership`);
      state.forceMembership = result.forceMembership || { enabled: false, channels: [] };
      renderForceMembership();
    } catch (error) {
      el.forceBox.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  async function loadDeployment() {
    if (!state.botId) return;
    try {
      const result = await Api.get(`/api/bots/${state.botId}/deployments`);
      state.deployment = (result.items || [])[0] || null;
      renderDeploymentCard();
    } catch {
      state.deployment = null;
      renderDeploymentCard();
    }
  }

  /* ------------------------------------------------------------- render */

  function renderSwitcher() {
    if (!state.bots.length) {
      el.switcher.innerHTML = `<div class="empty">${icon('bot')}<span>هنوز رباتی نساخته‌اید.</span><a class="btn btn-primary btn-sm" href="wizard.html">ساخت اولین ربات</a></div>`;
      el.empty.hidden = false;
      el.main.hidden = true;
      return;
    }
    el.empty.hidden = true;
    el.main.hidden = false;
    el.switcher.innerHTML = state.bots
      .map((bot) => {
        const active = bot.id === state.botId;
        return `<button type="button" class="bot-switch-item${active ? ' is-active' : ''}" data-bot="${esc(bot.id)}" aria-pressed="${active}">
          ${icon('bot', 'icon-sm')}
          <span class="bot-switch-name">${esc(bot.name)}</span>
          <span class="badge badge-${statusTone(bot.status)}">${esc(
            { active: 'فعال', paused: 'متوقف', maintenance: 'تعمیر', disabled: 'غیرفعال' }[bot.status] || bot.status
          )}</span>
        </button>`;
      })
      .join('');
  }

  function renderHeader() {
    const bot = state.dashboard ? state.dashboard.bot : activeBot();
    if (!bot) return;
    el.title.textContent = bot.name;
    el.subtitle.innerHTML = `
      <span class="badge badge-info">${esc(platformLabel(bot.platform))}</span>
      ${BF.statusBadge(bot.status)}
      <span class="tiny dim">شناسه: <code class="code-inline">${esc(bot.id)}</code></span>
      <span class="tiny dim">قالب: ${esc(bot.templateId)}</span>
      <span class="tiny dim">توکن: ${esc(bot.tokenHint || '—')}</span>`;

    el.webhook.innerHTML = BF.copyRow((state.dashboard && state.dashboard.webhookUrl) || 'در انتظار ثبت وب‌هوک', 'آدرس وب‌هوک');
    BF.enhanceCopy(el.webhook);

    el.statusSelect.value = bot.status;
    const forceText =
      bot.forceMembership && bot.forceMembership.enabled
        ? `فعال — ${fa(bot.forceMembership.channels || 0)} کانال`
        : 'غیرفعال';
    el.forceSummary.textContent = forceText;
    if (el.forceSummaryInline) el.forceSummaryInline.textContent = forceText;
  }

  function renderStats() {
    const metrics = (state.dashboard && state.dashboard.metrics) || {};
    const detailStats = (state.detail && state.detail.stats) || {};
    const cards = [
      { label: 'کاربران', value: metrics.users ?? detailStats.users ?? 0, icon: 'users' },
      { label: 'کاربر جدید ۲۴ ساعت', value: metrics.newUsers24h ?? 0, icon: 'user-plus' },
      { label: 'پیام ۲۴ ساعت', value: metrics.messages24h ?? detailStats.messagesToday ?? 0, icon: 'message-circle' },
      { label: 'خطا ۷ روز', value: metrics.errors7d ?? 0, icon: 'alert-triangle' },
      { label: 'کارهای در صف', value: metrics.jobsPending ?? detailStats.jobsPending ?? 0, icon: 'clock' },
      { label: 'مدیران ربات', value: detailStats.admins ?? 0, icon: 'shield-check' }
    ];
    el.stats.innerHTML = cards
      .map(
        (card) => `<div class="stat">
          <span class="stat-label">${icon(card.icon, 'icon-xs')} ${esc(card.label)}</span>
          <span class="stat-value">${fa(card.value)}</span>
        </div>`
      )
      .join('');
  }

  function renderHealthStrip() {
    const bot = state.dashboard ? state.dashboard.bot : null;
    if (!bot) return;
    const deployment = state.deployment;
    const health = deployment && deployment.health;
    const ok = health ? health.ok : false;
    el.healthRow.innerHTML = `
      <span class="dot ${ok ? 'is-ok' : health ? 'is-bad' : ''}"></span>
      <span>${
        deployment
          ? `آخرین استقرار: ${BF.statusBadge(deployment.status)}${health ? ` — پاسخ ${health.status || '—'} در ${fa(health.latencyMs || 0)} میلی‌ثانیه` : ' — سلامت هنوز بررسی نشده'}`
          : 'این ربات مستقر نشده است'
      }</span>
      <span class="spacer"></span>
      ${deployment ? `<button type="button" class="btn btn-outline btn-sm" id="recheckHealth">${icon('refresh-cw', 'icon-sm')} بررسی سلامت</button>` : ''}
      <a class="btn btn-secondary btn-sm" href="deployment.html?bot=${encodeURIComponent(state.botId)}">${icon('rocket', 'icon-sm')} صفحه استقرار</a>`;
    const recheck = document.getElementById('recheckHealth');
    if (recheck) recheck.addEventListener('click', recheckHealth);
  }

  function renderDeploymentCard() {
    if (!el.deploymentBox) return;
    const deployment = state.deployment;
    if (!deployment) {
      el.deploymentBox.innerHTML = `<div class="notice">${icon('info')}<div><strong>استقراری ثبت نشده است</strong>با ویزارد می‌توانید ربات را روی Cloudflare Workers یا Railway مستقر کنید.</div></div>
        <a class="btn btn-primary btn-sm mt-2" href="wizard.html?bot=${encodeURIComponent(state.botId)}">${icon('rocket', 'icon-sm')} آغاز استقرار</a>`;
      return;
    }
    const urls = deployment.urls || {};
    el.deploymentBox.innerHTML = `
      <div class="row-between">
        <span>${BF.statusBadge(deployment.status)}</span>
        <span class="tiny dim">${esc(deployment.provider)} — ${BF.formatDateTime(deployment.createdAt)}</span>
      </div>
      <div class="stack mt-2">
        ${urls.app ? BF.copyRow(urls.app, 'سرویس') : ''}
        ${urls.webhook ? BF.copyRow(urls.webhook, 'وب‌هوک') : ''}
        ${urls.health ? BF.copyRow(urls.health, 'سلامت') : ''}
      </div>`;
    BF.enhanceCopy(el.deploymentBox);
  }

  function renderEvents() {
    const events = state.events || [];
    const targets = [el.eventsBox, el.eventsBoard].filter(Boolean);
    if (!targets.length) return;
    if (!events.length) {
      const emptyMarkup = `<div class="empty">${icon('activity')}<span>رویدادی ثبت نشده است. پس از دریافت پیام، این بخش پر می‌شود.</span></div>`;
      targets.forEach((target) => {
        target.innerHTML = emptyMarkup;
      });
      return;
    }
    const markup = `<ul class="timeline">${events
      .map((event) => {
        const tone = event.level === 'error' ? 'is-failed' : event.level === 'warn' ? 'is-running' : 'is-done';
        return `<li class="timeline-item ${tone}">
          <span class="timeline-marker">${icon(event.level === 'error' ? 'alert-triangle' : event.level === 'warn' ? 'alert-circle' : 'check', 'icon-xs')}</span>
          <div class="timeline-body">
            <b>${esc(event.type)}</b>
            <p>${esc(Object.entries(event.payload || {}).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' — ') || 'بدون جزئیات')}</p>
            <span class="timeline-time">${BF.formatDateTime(event.createdAt)}</span>
          </div>
        </li>`;
      })
      .join('')}</ul>`;
    targets.forEach((target) => {
      target.innerHTML = markup;
    });
  }

  function renderUsers() {
    const { items, total, page, pageSize } = state.users;
    if (!items.length) {
      el.usersBody.innerHTML = `<tr><td colspan="7" data-label="">${state.users.search ? 'کاربری با این جست‌وجو پیدا نشد.' : 'هنوز کاربری به این ربات پیام نداده است.'}</td></tr>`;
    } else {
      el.usersBody.innerHTML = items
        .map(
          (user) => `<tr>
            <td data-label="کاربر"><strong>${esc(user.firstName || user.username || user.platformUserId)}</strong><br /><span class="tiny dim" dir="ltr">${esc(
              user.platformUserId
            )}</span></td>
            <td data-label="شناسه چت"><code class="code-inline">${esc(user.chatId)}</code></td>
            <td data-label="نقش">${esc({ user: 'کاربر', admin: 'مدیر', owner: 'مالک' }[user.role] || user.role)}</td>
            <td data-label="پیام‌ها" class="num">${fa(user.messageCount || 0)}</td>
            <td data-label="آخرین فعالیت">${BF.relativeTime(user.lastSeenAt)}</td>
            <td data-label="وضعیت">${
              user.isBlocked ? '<span class="badge badge-danger">مسدود</span>' : '<span class="badge badge-success">مجاز</span>'
            }</td>
            <td data-label="" class="stack-actions">
              <div class="table-actions">
                <button type="button" class="btn btn-sm ${user.isBlocked ? 'btn-secondary' : 'btn-outline'}" data-block="${esc(
                  user.platformUserId
                )}" data-blocked="${user.isBlocked ? 'false' : 'true'}">${user.isBlocked ? 'رفع مسدودی' : 'مسدودسازی'}</button>
                <button type="button" class="btn btn-sm btn-outline" data-role="${esc(user.platformUserId)}" data-current="${esc(
                  user.role
                )}">نقش</button>
                <button type="button" class="btn btn-sm btn-danger" data-delete-user="${esc(user.platformUserId)}">حذف</button>
              </div>
            </td>
          </tr>`
        )
        .join('');
    }

    const pages = Math.max(1, Math.ceil(total / pageSize));
    el.usersPager.innerHTML = `
      <span class="tiny dim">صفحه ${fa(page)} از ${fa(pages)} — ${fa(total)} کاربر</span>
      <div class="btn-row">
        <button type="button" class="btn btn-outline btn-sm" id="usersPrev" ${page <= 1 ? 'disabled' : ''}>${icon('chevron-right', 'icon-sm')} قبلی</button>
        <button type="button" class="btn btn-outline btn-sm" id="usersNext" ${page >= pages ? 'disabled' : ''}>بعدی ${icon('chevron-left', 'icon-sm')}</button>
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
      button.addEventListener('click', () => patchUser(button.getAttribute('data-block'), { blocked: button.getAttribute('data-blocked') === 'true' }));
    });
    el.usersBody.querySelectorAll('[data-role]').forEach((button) => {
      button.addEventListener('click', () => {
        const order = ['user', 'admin', 'owner'];
        const next = order[(order.indexOf(button.getAttribute('data-current')) + 1) % order.length];
        patchUser(button.getAttribute('data-role'), { role: next });
      });
    });
    el.usersBody.querySelectorAll('[data-delete-user]').forEach((button) => {
      button.addEventListener('click', () => removeUser(button.getAttribute('data-delete-user')));
    });
  }

  function renderForceMembership() {
    const fm = state.forceMembership || { enabled: false, channels: [] };
    el.forceBox.innerHTML = `
      <div class="notice">${icon('shield-check')}<div><strong>عضویت اجباری چیست؟</strong>ربات پیش از پاسخ دادن، عضویت کاربر در کانال‌های انتخابی را بررسی می‌کند؛ در صورت نبود عضویت، لینک ورود نمایش داده می‌شود.</div></div>
      <label class="check-row mt-2">
        <input type="checkbox" id="forceEnabled" ${fm.enabled ? 'checked' : ''} />
        <span>فعال بودن بررسی عضویت اجباری برای این ربات</span>
      </label>
      <div id="forceChannels" class="stack mt-2"></div>
      <div class="btn-row mt-2">
        <button type="button" class="btn btn-outline btn-sm" id="addChannel">${icon('plus', 'icon-sm')} افزودن کانال</button>
        <button type="button" class="btn btn-primary btn-sm" id="saveForce">${icon('save', 'icon-sm')} ذخیره تنظیمات</button>
      </div>`;

    renderChannelRows(fm.channels || []);

    document.getElementById('addChannel').addEventListener('click', () => {
      const channels = collectChannels();
      channels.push({ platform: 'telegram', chatId: '', title: '', inviteLink: '', required: true });
      renderChannelRows(channels);
    });
    document.getElementById('saveForce').addEventListener('click', saveForceMembership);
  }

  function renderChannelRows(channels) {
    const host = document.getElementById('forceChannels');
    if (!host) return;
    if (!channels.length) {
      host.innerHTML = `<div class="empty">${icon('layers')}<span>کانالی اضافه نشده است. با دکمه «افزودن کانال» شروع کنید.</span></div>`;
      return;
    }
    host.innerHTML = channels
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
                ${['telegram', 'bale', 'rubika']
                  .map((platform) => `<option value="${platform}" ${channel.platform === platform ? 'selected' : ''}>${platformLabel(platform)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label>شناسه چت</label>
              <input dir="ltr" data-field="chatId" value="${esc(channel.chatId || '')}" placeholder="@channel یا -100..." />
            </div>
            <div class="field">
              <label>عنوان کانال</label>
              <input data-field="title" value="${esc(channel.title || '')}" placeholder="کانال رسمی BotForge" />
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

    host.querySelectorAll('[data-remove-channel]').forEach((button) => {
      button.addEventListener('click', () => {
        const channels = collectChannels().filter((_, index) => index !== Number(button.getAttribute('data-remove-channel')));
        renderChannelRows(channels);
      });
    });
  }

  function collectChannels() {
    return Array.from(document.querySelectorAll('[data-channel]')).map((card, index) => ({
      id: `ch_${index + 1}`,
      platform: card.querySelector('[data-field="platform"]').value,
      chatId: card.querySelector('[data-field="chatId"]').value.trim(),
      title: card.querySelector('[data-field="title"]').value.trim(),
      inviteLink: card.querySelector('[data-field="inviteLink"]').value.trim() || undefined,
      required: card.querySelector('[data-field="required"]').checked
    }));
  }

  function renderSettings() {
    const data = state.settings;
    if (!data) return;
    const requirements = data.requirements || [];
    const settings = data.settings || {};
    el.settingsBox.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>${icon('key', 'icon-sm')} کلیدهای یکپارچه‌سازی</h3></div>
          <div class="card-body">
            ${
              requirements.length
                ? `<ul class="requirement-list">${requirements
                    .map(
                      (requirement) => `<li class="requirement">${icon(
                        requirement.configured ? 'circle-check' : 'circle-x',
                        'icon-sm'
                      )}<div><b>${esc(requirement.label)} ${requirement.configured ? '<span class="badge badge-success">تنظیم شده</span>' : '<span class="badge badge-warn">تنظیم نشده</span>'}</b><span>${esc(
                        requirement.description
                      )}</span>${requirement.env ? `<br /><code class="code-inline">${esc(requirement.env)}</code>` : ''}</div></li>`
                    )
                    .join('')}</ul>`
                : '<p class="tiny dim">این ربات کلید بیرونی ندارد.</p>'
            }
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('sliders', 'icon-sm')} قابلیت‌های فعال</h3></div>
          <div class="card-body">
            <div class="stack">
              <div class="summary-row"><span>هوش مصنوعی</span><strong>${data.available && data.available.ai ? 'فعال' : 'غیرفعال'}</strong></div>
              <div class="summary-row"><span>تبدیل گفتار به متن</span><strong>${data.available && data.available.speechToText ? 'فعال' : 'غیرفعال'}</strong></div>
              <div class="summary-row"><span>تبدیل متن به گفتار</span><strong>${data.available && data.available.textToSpeech ? 'فعال' : 'غیرفعال'}</strong></div>
              <div class="summary-row"><span>تعداد تنظیمات ذخیره‌شده</span><strong>${fa(Object.keys(settings).length)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-2">
        <div class="card-head"><h3>${icon('edit', 'icon-sm')} ثبت تنظیمات ربات</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field">
              <label for="settingKey">کلید</label>
              <input id="settingKey" dir="ltr" placeholder="welcome_text" />
              <span class="hint">حروف لاتین، عدد، نقطه، خط تیره و زیرخط، حداکثر ۶۴ کاراکتر.</span>
            </div>
            <div class="field">
              <label for="settingValue">مقدار</label>
              <input id="settingValue" placeholder="مقدار متنی، عدد یا JSON" />
              <span class="hint">برای JSON معتبر، ساختار ذخیره و بازخوانی می‌شود.</span>
            </div>
          </div>
          <div class="form-actions mt-2">
            <button type="button" class="btn btn-primary btn-sm" id="saveSetting">${icon('save', 'icon-sm')} ذخیره تنظیم</button>
          </div>
          <div class="mt-2">
            ${
              Object.keys(settings).length
                ? `<div class="table-wrap"><table class="data-table data-stack">
                    <thead><tr><th>کلید</th><th>مقدار</th><th>عملیات</th></tr></thead>
                    <tbody>${Object.entries(settings)
                      .map(
                        ([key, value]) => `<tr>
                          <td data-label="کلید"><code class="code-inline">${esc(key)}</code></td>
                          <td data-label="مقدار" dir="ltr">${esc(typeof value === 'object' ? JSON.stringify(value) : String(value))}</td>
                          <td data-label="" class="stack-actions"><button type="button" class="btn btn-sm btn-danger" data-delete-setting="${esc(key)}">حذف</button></td>
                        </tr>`
                      )
                      .join('')}</tbody>
                  </table></div>`
                : '<p class="tiny dim">هنوز تنظیمی ذخیره نشده است.</p>'
            }
          </div>
        </div>
      </div>`;

    document.getElementById('saveSetting').addEventListener('click', saveSetting);
    el.settingsBox.querySelectorAll('[data-delete-setting]').forEach((button) => {
      button.addEventListener('click', () => deleteSetting(button.getAttribute('data-delete-setting')));
    });
  }

  /* -------------------------------------------------------------- actions */

  function parseValue(raw) {
    const value = raw.trim();
    if (!value) return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  async function saveSetting() {
    const key = document.getElementById('settingKey').value.trim();
    const raw = document.getElementById('settingValue').value;
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
      BF.toast('کلید تنظیم نامعتبر است.', 'error');
      return;
    }
    try {
      await Api.put(`/api/bots/${state.botId}/settings`, { key, value: parseValue(raw) });
      BF.toast('تنظیم ذخیره شد.', 'success');
      await loadSettings();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function deleteSetting(key) {
    try {
      await Api.del(`/api/bots/${state.botId}/settings/${encodeURIComponent(key)}`);
      BF.toast('تنظیم حذف شد.', 'info');
      await loadSettings();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function patchUser(platformUserId, body) {
    try {
      await Api.patch(`/api/bots/${state.botId}/users/${encodeURIComponent(platformUserId)}`, body);
      BF.toast('کاربر به‌روزرسانی شد.', 'success');
      await loadUsers();
      await loadDashboard();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function removeUser(platformUserId) {
    if (!window.confirm(`کاربر ${platformUserId} و همه داده‌های آن حذف شود؟ این عمل بازگشت‌پذیر نیست.`)) return;
    try {
      await Api.del(`/api/bots/${state.botId}/users/${encodeURIComponent(platformUserId)}`);
      BF.toast('کاربر حذف شد.', 'info');
      await loadUsers();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function saveForceMembership() {
    const enabled = document.getElementById('forceEnabled').checked;
    const channels = collectChannels();
    if (enabled && !channels.length) {
      BF.toast('برای فعال‌سازی، حداقل یک کانال اضافه کنید.', 'error');
      return;
    }
    const invalid = channels.find((channel) => !channel.chatId || !channel.title);
    if (invalid) {
      BF.toast('شناسه چت و عنوان همه کانال‌ها الزامی است.', 'error');
      return;
    }
    try {
      const result = await Api.put(`/api/bots/${state.botId}/force-membership`, { enabled, channels });
      state.forceMembership = result.forceMembership;
      renderForceMembership();
      renderHeader();
      BF.toast('تنظیمات عضویت اجباری ذخیره شد.', 'success');
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function changeStatus(status) {
    try {
      await Api.patch(`/api/bots/${state.botId}`, { status });
      BF.toast('وضعیت ربات تغییر کرد.', 'success');
      await loadBots();
      await loadDashboard();
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function registerWebhook() {
    try {
      const result = await Api.post(`/api/bots/${state.botId}/webhook/register`, {});
      BF.toast(result.registered ? 'وب‌هوک روی پلتفرم ثبت شد.' : 'پلتفرم ثبت وب‌هوک را تأیید نکرد.', result.registered ? 'success' : 'error');
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function deleteWebhook() {
    if (!window.confirm('وب‌هوک این ربات از پلتفرم حذف شود؟ ربات تا ثبت مجدد پیام دریافت نمی‌کند.')) return;
    try {
      await Api.post(`/api/bots/${state.botId}/webhook/delete`, {});
      BF.toast('وب‌هوک حذف شد.', 'info');
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function recheckHealth() {
    if (!state.deployment) return;
    try {
      const result = await Api.post(
        `/api/bots/${state.botId}/deployments/${state.deployment.id}/health`,
        {}
      );
      state.deployment = result.deployment;
      renderHealthStrip();
      renderDeploymentCard();
      BF.toast(result.deployment.health && result.deployment.health.ok ? 'سرویس سالم است.' : 'سرویس پاسخ سالم نداد.', result.deployment.health && result.deployment.health.ok ? 'success' : 'error');
    } catch (error) {
      BF.toast(error.message, 'error');
    }
  }

  async function sendBroadcast() {
    const text = el.broadcastText.value.trim();
    const parseMode = el.broadcastMode.value;
    if (text.length < 1) {
      BF.toast('متن پیام همگانی را وارد کنید.', 'error');
      return;
    }
    if (!el.broadcastConfirm.checked) {
      BF.toast('برای ارسال، تأیید ارسال به همه کاربران را علامت بزنید.', 'error');
      return;
    }
    el.broadcastBtn.disabled = true;
    try {
      const result = await Api.post(`/api/bots/${state.botId}/broadcast`, { text, parseMode });
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
    if (state.broadcastTimer) window.clearTimeout(state.broadcastTimer);
    try {
      const result = await Api.get(`/api/bots/${state.botId}/broadcast`);
      const progress = result.progress;
      if (!progress) {
        el.broadcastProgress.innerHTML = '<p class="tiny dim">گزارشی از ارسال همگانی ثبت نشده است.</p>';
        return;
      }
      const total = Number(progress.total || 0);
      const sent = Number(progress.sent || 0);
      const failed = Number(progress.failed || 0);
      const percent = total ? Math.round(((sent + failed) / total) * 100) : 0;
      el.broadcastProgress.innerHTML = `
        <div class="summary-row"><span>وضعیت</span><strong>${esc(progress.status || 'در حال ارسال')}</strong></div>
        <div class="summary-row"><span>ارسال موفق</span><strong>${fa(sent)}</strong></div>
        <div class="summary-row"><span>ناموفق</span><strong>${fa(failed)}</strong></div>
        <div class="summary-row"><span>کل</span><strong>${fa(total)}</strong></div>
        <div class="mt-1"><div class="skeleton" style="width:100%;height:8px;animation:none;background:rgba(148,187,233,.12)"><div style="width:${percent}%;height:8px;border-radius:8px;background:linear-gradient(90deg,#3b82f6,#22d3ee)"></div></div></div>
        <p class="tiny dim mt-1">${fa(percent)}٪ تکمیل</p>`;
      if (progress.status === 'running' || progress.status === 'queued') {
        state.broadcastTimer = window.setTimeout(pollBroadcast, 4000);
      }
    } catch (error) {
      el.broadcastProgress.innerHTML = `<div class="notice notice-danger">${icon('alert-triangle')}<div>${esc(error.message)}</div></div>`;
    }
  }

  /* ---------------------------------------------------------------- tabs */

  function activateTab(key) {
    const buttons = el.tabs.querySelectorAll('[data-tab]');
    const panels = document.querySelectorAll('[data-tab-panel][data-group="dash"]');
    buttons.forEach((item) => {
      const active = item.getAttribute('data-tab') === key;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-tab-panel') !== key;
    });
    if (key === 'broadcast') pollBroadcast();
  }

  function initTabs() {
    el.tabs.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => activateTab(button.getAttribute('data-tab')));
    });
    document.querySelectorAll('[data-open-tab]').forEach((button) => {
      button.addEventListener('click', () => activateTab(button.getAttribute('data-open-tab')));
    });
  }

  /* ---------------------------------------------------------------- wire */

  async function selectBot(id) {
    state.botId = id;
    state.users = { ...state.users, page: 1, search: '' };
    el.usersSearch.value = '';
    renderSwitcher();
    const url = new URL(location.href);
    url.searchParams.set('bot', id);
    history.replaceState(null, '', url);
    await loadDashboard();
  }

  function wire() {
    el.switcher.addEventListener('click', (event) => {
      const button = event.target.closest('[data-bot]');
      if (!button) return;
      selectBot(button.getAttribute('data-bot'));
    });

    el.refresh.addEventListener('click', async () => {
      el.refresh.classList.add('is-busy');
      try {
        await loadBots();
        await loadDashboard();
        BF.toast('داده‌ها به‌روزرسانی شد.', 'success');
      } catch (error) {
        BF.toast(error.message, 'error');
      } finally {
        el.refresh.classList.remove('is-busy');
      }
    });

    el.statusSelect.addEventListener('change', () => changeStatus(el.statusSelect.value));
    el.registerWebhook.addEventListener('click', registerWebhook);
    el.deleteWebhook.addEventListener('click', deleteWebhook);
    el.usersSearch.addEventListener('input', () => {
      window.clearTimeout(el.usersSearch._timer);
      el.usersSearch._timer = window.setTimeout(() => {
        state.users.search = el.usersSearch.value.trim();
        state.users.page = 1;
        loadUsers();
      }, 350);
    });
    el.usersBlocked.addEventListener('change', () => {
      state.users.blocked = el.usersBlocked.value;
      state.users.page = 1;
      loadUsers();
    });
    el.broadcastBtn.addEventListener('click', sendBroadcast);
    el.broadcastRefresh.addEventListener('click', pollBroadcast);
    el.gateBtn.addEventListener('click', gateLogin);
    el.gateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      gateLogin();
    });
  }

  function cache() {
    el.gate = document.getElementById('dashGate');
    el.app = document.getElementById('dashApp');
    el.gateForm = document.getElementById('gateForm');
    el.gateBase = document.getElementById('gateBase');
    el.gateEmail = document.getElementById('gateEmail');
    el.gatePassword = document.getElementById('gatePassword');
    el.gateBtn = document.getElementById('gateLoginBtn');
    el.gateStatus = document.getElementById('gateStatus');
    el.switcher = document.getElementById('botSwitcher');
    el.main = document.getElementById('dashMain');
    el.empty = document.getElementById('dashEmpty');
    el.title = document.getElementById('botTitle');
    el.subtitle = document.getElementById('botSubtitle');
    el.webhook = document.getElementById('webhookBox');
    el.stats = document.getElementById('dashStats');
    el.healthRow = document.getElementById('healthRow');
    el.deploymentBox = document.getElementById('deploymentBox');
    el.eventsBox = document.getElementById('eventsBox');
    el.usersBody = document.getElementById('usersBody');
    el.usersPager = document.getElementById('usersPager');
    el.usersSearch = document.getElementById('usersSearch');
    el.usersBlocked = document.getElementById('usersBlocked');
    el.settingsBox = document.getElementById('settingsBox');
    el.forceBox = document.getElementById('forceBox');
    el.forceSummary = document.getElementById('forceSummary');
    el.forceSummaryInline = document.getElementById('forceSummaryInline');
    el.eventsBoard = document.getElementById('eventsBoard');
    el.tabs = document.getElementById('dashTabs');
    el.refresh = document.getElementById('refreshDash');
    el.statusSelect = document.getElementById('statusSelect');
    el.registerWebhook = document.getElementById('registerWebhook');
    el.deleteWebhook = document.getElementById('deleteWebhook');
    el.broadcastText = document.getElementById('broadcastText');
    el.broadcastMode = document.getElementById('broadcastMode');
    el.broadcastConfirm = document.getElementById('broadcastConfirm');
    el.broadcastBtn = document.getElementById('broadcastBtn');
    el.broadcastRefresh = document.getElementById('broadcastRefresh');
    el.broadcastProgress = document.getElementById('broadcastProgress');
  }

  async function boot() {
    renderGate();
    if (!Api.authenticated) return;
    try {
      await Api.verifySession();
      renderGate();
      await loadBots();
      if (state.botId) await loadDashboard();
      else renderSwitcher();
    } catch (error) {
      BF.toast(error.message, 'error');
      renderGate();
    }
  }

  function init() {
    if (!document.getElementById('dashApp')) return;
    cache();
    initTabs();
    wire();
    boot();
  }

  BF.ready(init);
})();
