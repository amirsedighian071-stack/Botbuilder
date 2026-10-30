/* BotForge wizard — six steps from template choice to automated deployment. */
(function () {
  'use strict';

  const BF = window.BF;
  const Api = window.BotForgeApi;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;
  const CATALOG = window.BOTFORGE_CATALOG || { bots: [], categories: [], totals: {} };

  const DRAFT_KEY = 'botforge.wizardDraft';
  const SECRET_KEY = 'botforge.wizardSecrets';

  const STEP_TITLES = [
    'انتخاب ربات',
    'پلتفرم و توکن',
    'هویت ربات',
    'کلیدهای یکپارچه‌سازی',
    'میزبانی و استقرار',
    'بازبینی و تأیید'
  ];

  const PLATFORMS = [
    {
      id: 'telegram',
      name: 'تلگرام',
      icon: 'send',
      hint: 'توکن BotFather با الگوی ۱۲۳۴۵۶۷۸۹:AA...',
      link: 'https://t.me/BotFather',
      linkLabel: 'دریافت توکن از BotFather',
      docs: 'https://core.telegram.org/bots/tutorial'
    },
    {
      id: 'bale',
      name: 'بله',
      icon: 'message-circle',
      hint: 'توکن ربات بله از BotFather بله',
      link: 'https://web.bale.ai/',
      linkLabel: 'ورود به بله و BotFather',
      docs: 'https://dev.bale.ai/'
    },
    {
      id: 'rubika',
      name: 'روبیکا',
      icon: 'smartphone',
      hint: 'توکن ربات روبیکا از BotFather روبیکا',
      link: 'https://web.rubika.ir/',
      linkLabel: 'ورود به روبیکا و BotFather',
      docs: 'https://rubika.ir/'
    }
  ];

  const PROVIDERS = [
    {
      id: 'cloudflare',
      name: 'Cloudflare Workers',
      icon: 'cloud',
      description: 'استقرار سریع روی لبه شبکه با پایگاه‌داده D1 و کرون داخلی. مناسب وب‌هوک پرترافیک.',
      link: 'https://dash.cloudflare.com/profile/api-tokens',
      linkLabel: 'ساخت API Token در Cloudflare',
      fields: [
        {
          key: 'apiToken',
          label: 'Cloudflare API Token',
          placeholder: 'توکن ۴۰ کاراکتری با دسترسی Workers و D1',
          hint: 'دسترسی‌های لازم: Workers Scripts:Edit، D1:Edit، Account Settings:Read',
          secret: true,
          required: true,
          ltr: true
        },
        {
          key: 'accountId',
          label: 'Account ID (اختیاری)',
          placeholder: 'شناسه حساب Cloudflare',
          hint: 'اگر فقط یک حساب دارید، خالی بگذارید تا خودکار انتخاب شود.',
          required: false,
          ltr: true
        }
      ]
    },
    {
      id: 'railway',
      name: 'Railway',
      icon: 'server',
      description: 'اجرای کامل کنترل‌پلین Node.js با PostgreSQL، رسانه و ffmpeg. پشتیبان همه ۳۲ ربات.',
      link: 'https://railway.com/account/tokens',
      linkLabel: 'ساخت API Token در Railway',
      fields: [
        {
          key: 'apiToken',
          label: 'Railway API Token',
          placeholder: 'توکن حساب Railway',
          hint: 'از Account Settings → Tokens ساخته می‌شود و به پروژه‌های حساب دسترسی دارد.',
          secret: true,
          required: true,
          ltr: true
        },
        {
          key: 'databaseUrl',
          label: 'DATABASE_URL (اختیاری)',
          placeholder: 'postgresql://user:pass@host:5432/db',
          hint: 'در صورت خالی بودن از SQLite روی ولوم استفاده می‌شود.',
          required: false,
          ltr: true
        }
      ]
    }
  ];

  const state = {
    step: 0,
    templateId: '',
    platform: 'telegram',
    token: '',
    tokenInfo: null,
    tokenState: 'idle',
    name: '',
    slug: '',
    integrationKeys: {},
    provider: 'cloudflare',
    credentials: {},
    providerInfo: null,
    providerState: 'idle',
    botId: null,
    deploymentId: null,
    deployment: null,
    pollTimer: null,
    deploying: false
  };

  const el = {};

  /* ------------------------------------------------------------ helpers */

  function template() {
    return (CATALOG.bots || []).find((bot) => bot.id === state.templateId) || null;
  }

  function platform() {
    return PLATFORMS.find((item) => item.id === state.platform) || PLATFORMS[0];
  }

  function provider() {
    return PROVIDERS.find((item) => item.id === state.provider) || PROVIDERS[0];
  }

  function randomSlugSuffix() {
    return Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
  }

  function defaultSlug(bot) {
    return `${String(bot ? bot.id : 'botforge').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${randomSlugSuffix()}`;
  }

  function setStatus(node, text, tone, iconName) {
    if (!node) return;
    node.className = `field-status${tone ? ` is-${tone}` : ''}`;
    node.innerHTML = `${icon(iconName || (tone === 'ok' ? 'circle-check' : tone === 'error' ? 'circle-x' : tone === 'busy' ? 'loader' : 'info'), 'icon-xs')}<span>${esc(
      text
    )}</span>`;
  }

  /* --------------------------------------------------------------- draft */

  function saveDraft() {
    const draft = {
      step: state.step,
      templateId: state.templateId,
      platform: state.platform,
      name: state.name,
      slug: state.slug,
      integrationKeys: state.integrationKeys,
      provider: state.provider,
      botId: state.botId,
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage can be disabled; the wizard still works in memory */
    }
    const secrets = {
      token: state.token,
      credentials: state.credentials
    };
    try {
      sessionStorage.setItem(SECRET_KEY, JSON.stringify(secrets));
    } catch {
      /* secrets stay in memory only */
    }
  }

  function loadDraft() {
    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch {
      draft = null;
    }
    if (!draft) return;
    const known = (CATALOG.bots || []).some((bot) => bot.id === draft.templateId);
    if (known) state.templateId = draft.templateId;
    if (PLATFORMS.some((item) => item.id === draft.platform)) state.platform = draft.platform;
    if (PROVIDERS.some((item) => item.id === draft.provider)) state.provider = draft.provider;
    if (typeof draft.name === 'string') state.name = draft.name;
    if (typeof draft.slug === 'string') state.slug = draft.slug;
    if (draft.integrationKeys && typeof draft.integrationKeys === 'object') state.integrationKeys = draft.integrationKeys;
    if (typeof draft.botId === 'string') state.botId = draft.botId;
    if (Number.isInteger(draft.step)) state.step = Math.max(0, Math.min(STEP_TITLES.length - 1, draft.step));

    try {
      const secrets = JSON.parse(sessionStorage.getItem(SECRET_KEY) || 'null');
      if (secrets) {
        if (typeof secrets.token === 'string') state.token = secrets.token;
        if (secrets.credentials && typeof secrets.credentials === 'object') state.credentials = secrets.credentials;
      }
    } catch {
      /* ignore corrupted session storage */
    }
  }

  function readQuery() {
    const params = new URLSearchParams(location.search);
    const bot = params.get('bot');
    if (bot && (CATALOG.bots || []).some((item) => item.id === bot)) {
      state.templateId = bot;
      const found = template();
      state.name = found.name;
      state.slug = state.slug || defaultSlug(found);
    }
  }

  /* ---------------------------------------------------------- connection */

  function renderConnection() {
    if (!el.connectionPanel) return;
    const connected = Api.configured;
    const authed = Api.authenticated;
    el.connectionState.innerHTML = authed
      ? `${icon('circle-check', 'icon-xs')} به ${esc(Api.base)} متصل و وارد شده‌اید${Api.admin ? ` — ${esc(Api.admin.email)}` : ''}`
      : connected
        ? `${icon('alert-triangle', 'icon-xs')} آدرس ${esc(Api.base)} ذخیره شده اما ورود انجام نشده است`
        : `${icon('info', 'icon-xs')} کنترل‌پلین تنظیم نشده است؛ استقرار خودکار به سرور نیاز دارد`;
    el.connectionState.className = `field-status ${authed ? 'is-ok' : connected ? 'is-busy' : ''}`;
    el.apiBase.value = Api.base || '';
    if (authed && Api.admin) {
      el.email.value = Api.admin.email;
      el.password.value = '';
    }
    el.logoutBtn.hidden = !authed;
  }

  async function testConnection() {
    const base = Api.setBase(el.apiBase.value);
    if (!base) {
      BF.toast('آدرس کنترل‌پلین را وارد کنید.', 'error');
      return;
    }
    setStatus(el.connectionTest, 'در حال بررسی سلامت سرور...', 'busy', 'loader');
    try {
      const response = await fetch(`${base}/health`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`کد ${response.status}`);
      const payload = await response.json();
      const startedAt = payload.uptimeSeconds
        ? new Date(Date.now() - Number(payload.uptimeSeconds) * 1000).toISOString()
        : null;
      setStatus(
        el.connectionTest,
        `سرور پاسخ داد — وضعیت ${payload.status || 'ok'}، نسخه ${payload.version || '1'}${
          startedAt ? `، فعال از ${BF.relativeTime(startedAt)}` : ''
        }`,
        'ok',
        'circle-check'
      );
      BF.toast('اتصال به کنترل‌پلین برقرار است.', 'success');
      window.dispatchEvent(new Event('botforge:connection'));
      renderConnection();
    } catch (error) {
      setStatus(el.connectionTest, `اتصال برقرار نشد: ${error.message}`, 'error', 'circle-x');
    }
  }

  async function login() {
    const base = Api.setBase(el.apiBase.value);
    if (!base) {
      BF.toast('آدرس کنترل‌پلین را وارد کنید.', 'error');
      return;
    }
    const email = el.email.value.trim();
    const password = el.password.value;
    if (!email || !password) {
      BF.toast('ایمیل و گذرواژه مدیر را وارد کنید.', 'error');
      return;
    }
    setStatus(el.connectionTest, 'در حال ورود...', 'busy', 'loader');
    el.loginBtn.disabled = true;
    try {
      const result = await Api.login(email, password);
      setStatus(el.connectionTest, `ورود موفق: ${result.admin.email} (${result.admin.role})`, 'ok', 'circle-check');
      BF.toast('ورود انجام شد؛ اعتبارسنجی زنده فعال است.', 'success');
      window.dispatchEvent(new Event('botforge:connection'));
      renderConnection();
    } catch (error) {
      setStatus(el.connectionTest, error.message, 'error', 'circle-x');
    } finally {
      el.loginBtn.disabled = false;
    }
  }

  function logout() {
    Api.clearSession();
    BF.toast('از حساب خارج شدید.', 'info');
    window.dispatchEvent(new Event('botforge:connection'));
    renderConnection();
  }

  /* ------------------------------------------------------ step 1: pick */

  function renderTemplateGrid() {
    el.templateList.innerHTML = (CATALOG.bots || [])
      .map((bot) => {
        const active = bot.id === state.templateId;
        return `<button type="button" class="template-option${active ? ' is-active' : ''}" data-template="${esc(bot.id)}" aria-pressed="${active}">
          <span class="bot-icon" aria-hidden="true">${icon(bot.icon || 'bot', 'icon-lg')}</span>
          <span class="template-body">
            <b><span class="bot-index">${fa(bot.number)}</span> ${esc(bot.name)}</b>
            <span>${esc(bot.summary)}</span>
            <span class="tiny dim">${fa(bot.commands)} دستور — ${esc(BF.categoryName(bot.category))}</span>
          </span>
        </button>`;
      })
      .join('');
  }

  function renderCategoryChips() {
    el.templateChips.innerHTML = `<button type="button" class="chip chip-button chip-active" data-filter="all">همه</button>${(CATALOG.categories || [])
      .map((category) => `<button type="button" class="chip chip-button" data-filter="${esc(category.id)}">${esc(category.title)}</button>`)
      .join('')}`;
  }

  function filterTemplates(filter, query) {
    el.templateList.querySelectorAll('[data-template]').forEach((node) => {
      const id = node.getAttribute('data-template');
      const bot = (CATALOG.bots || []).find((item) => item.id === id);
      if (!bot) return;
      const inCategory = filter === 'all' || bot.category === filter;
      const needle = (query || '').toLowerCase();
      const inQuery =
        !needle ||
        `${bot.name} ${bot.summary} ${bot.id} ${(bot.tags || []).join(' ')}`.toLowerCase().includes(needle);
      node.hidden = !(inCategory && inQuery);
    });
  }

  function selectTemplate(id) {
    state.templateId = id;
    state.botId = null;
    const bot = template();
    if (bot) {
      state.name = bot.name;
      state.slug = defaultSlug(bot);
      state.integrationKeys = {};
      for (const requirement of bot.requirements || []) {
        if (requirement.required && !state.integrationKeys[requirement.key]) state.integrationKeys[requirement.key] = '';
      }
    }
    el.templateList.querySelectorAll('[data-template]').forEach((node) => {
      const active = node.getAttribute('data-template') === id;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', String(active));
    });
    renderIdentity();
    renderIntegration();
    renderReview();
    saveDraft();
  }

  /* ----------------------------------------------------- step 2: token */

  function renderPlatforms() {
    el.platformOptions.innerHTML = PLATFORMS.map((item) => {
      const active = item.id === state.platform;
      return `<label class="option">
        <input type="radio" name="platform" value="${esc(item.id)}"${active ? ' checked' : ''} />
        <span class="option-body">${icon(item.icon, 'icon-lg')}<span><b>${esc(item.name)}</b><span>${esc(
          item.hint
        )}</span></span></span>
      </label>`;
    }).join('');

    el.platformOptions.querySelectorAll('input[name="platform"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.platform = input.value;
        state.tokenInfo = null;
        state.tokenState = 'idle';
        state.botId = null;
        renderTokenHelp();
        renderTokenStatus();
        saveDraft();
      });
    });
    renderTokenHelp();
  }

  function renderTokenHelp() {
    const current = platform();
    el.platformLink.href = current.link;
    el.platformLink.innerHTML = `${icon('external-link', 'icon-sm')} ${esc(current.linkLabel)}`;
    el.platformDocs.href = current.docs;
    if (el.tokenHint) el.tokenHint.textContent = current.hint;
  }

  function renderTokenStatus() {
    if (!state.token) {
      setStatus(el.tokenStatus, 'توکن را وارد کنید تا اعتبارسنجی شود.', null, 'key');
      return;
    }
    if (state.tokenState === 'busy') {
      setStatus(el.tokenStatus, 'در حال اعتبارسنجی زنده با پلتفرم...', 'busy', 'loader');
      return;
    }
    if (state.tokenState === 'ok' && state.tokenInfo) {
      setStatus(
        el.tokenStatus,
        `توکن معتبر است — @${state.tokenInfo.username || state.tokenInfo.id} (شناسه ${state.tokenInfo.id})`,
        'ok',
        'circle-check'
      );
      return;
    }
    if (state.tokenState === 'error') {
      setStatus(el.tokenStatus, state.tokenError || 'توکن نامعتبر است.', 'error', 'circle-x');
      return;
    }
    setStatus(el.tokenStatus, 'توکن وارد شده اما هنوز اعتبارسنجی نشده است.', null, 'info');
  }

  function localTokenCheck(token) {
    const value = token.trim();
    if (!value) return 'توکن خالی است.';
    if (value.length < 20) return 'طول توکن کمتر از حد انتظار است.';
    if (/\s/.test(value)) return 'توکن نباید فاصله داشته باشد.';
    if (state.platform === 'telegram' || state.platform === 'bale') {
      if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(value)) return 'الگوی توکن تلگرام/بله باید عدد:رشته باشد.';
    }
    if (state.platform === 'rubika' && !/^[A-Za-z0-9]+$/.test(value)) {
      return 'توکن روبیکا فقط شامل حروف و ارقام لاتین است.';
    }
    return null;
  }

  async function validateToken() {
    const localError = localTokenCheck(state.token);
    if (localError) {
      state.tokenState = 'error';
      state.tokenError = localError;
      renderTokenStatus();
      return;
    }
    if (!Api.authenticated) {
      state.tokenState = 'error';
      state.tokenError = 'برای اعتبارسنجی زنده باید به کنترل‌پلین وارد شوید. فرمت توکن درست است.';
      renderTokenStatus();
      return;
    }
    state.tokenState = 'busy';
    renderTokenStatus();
    try {
      const result = await Api.post('/api/deploy/validate-token', { platform: state.platform, token: state.token.trim() });
      state.tokenInfo = result.bot;
      state.tokenState = 'ok';
      state.botId = null;
      renderTokenStatus();
      BF.toast(`توکن ${platform().name} معتبر است.`, 'success');
    } catch (error) {
      state.tokenState = 'error';
      state.tokenError = error.message;
      renderTokenStatus();
    }
  }

  /* ---------------------------------------------------- step 3: ident */

  function renderIdentity() {
    if (!el.name) return;
    const bot = template();
    el.name.value = state.name || (bot ? bot.name : '');
    el.slug.value = state.slug || '';
    if (!state.slug && bot) {
      state.slug = defaultSlug(bot);
      el.slug.value = state.slug;
    }
    el.identityTemplate.textContent = bot ? `${bot.name} (${bot.id})` : 'رباتی انتخاب نشده است';
  }

  function slugError(value) {
    if (!value) return 'شناسه ربات الزامی است.';
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value)) return 'شناسه باید ۳ تا ۴۰ کاراکتر لاتین، عدد یا خط تیره باشد.';
    return null;
  }

  /* ------------------------------------------------ step 4: integrations */

  function renderIntegration() {
    const bot = template();
    if (!bot) {
      el.integrationFields.innerHTML = `<div class="empty">${icon('plug')}<span>ابتدا در مرحله اول یک ربات انتخاب کنید.</span></div>`;
      return;
    }
    if (!(bot.requirements || []).length) {
      el.integrationFields.innerHTML = `<div class="notice notice-success">${icon('circle-check')}<div><strong>این ربات کلید بیرونی نمی‌خواهد</strong>همه چیز با منابع عمومی و تنظیمات پیش‌فرض کار می‌کند. می‌توانید مستقیم به مرحله استقرار بروید.</div></div>`;
      return;
    }
    el.integrationFields.innerHTML = `<div class="form-grid">${bot.requirements
      .map((requirement) => {
        const value = state.integrationKeys[requirement.key] || '';
        const hasLink = requirement.link || (/(OPENAI|GEMINI|WEATHER|GOLD|METAL|NEWS)/.test(requirement.key || '') ? true : false);
        return `<div class="field">
          <label for="env-${esc(requirement.key)}">${esc(requirement.label)}${
            requirement.required ? ' <span class="req">*</span>' : ''
          }</label>
          <div class="input-group">
            <input class="input" id="env-${esc(requirement.key)}" data-env="${esc(requirement.key)}" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${
              requirement.env || requirement.key
            }" value="${esc(value)}" />
            ${hasLink ? `<a class="btn btn-outline btn-sm" href="${integrationLink(requirement)}" target="_blank" rel="noopener noreferrer">${icon('external-link', 'icon-sm')} دریافت API</a>` : ''}
          </div>
          <span class="hint">${esc(requirement.description)}${
            requirement.env ? ` — متغیر <code class="code-inline">${esc(requirement.env)}</code>` : ''
          }</span>
        </div>`;
      })
      .join('')}</div>
      <div class="notice mt-2">${icon('shield-check')}<div><strong>کلیدها کجا ذخیره می‌شوند؟</strong>کلیدها هنگام استقرار روی سرور به‌عنوان متغیر محیطی رمزنگاری‌شده ذخیره می‌شوند و هرگز در HTML یا آدرس‌ها قرار نمی‌گیرند. در حالت آفلاین فقط در همین مرورگر می‌مانند.</div></div>`;

    el.integrationFields.querySelectorAll('[data-env]').forEach((input) => {
      input.addEventListener('input', () => {
        state.integrationKeys[input.getAttribute('data-env')] = input.value.trim();
        saveDraft();
      });
    });
    BF.enhanceCopy(el.integrationFields);
  }

  function integrationLink(requirement) {
    if (requirement.link) return requirement.link;
    if (/OPENAI/.test(requirement.key)) return 'https://platform.openai.com/api-keys';
    if (/GEMINI|GOOGLE/.test(requirement.key)) return 'https://aistudio.google.com/app/apikey';
    if (/WEATHER|OPENWEATHER/.test(requirement.key)) return 'https://openweathermap.org/api';
    if (/GOLD/.test(requirement.key)) return 'https://www.metals.dev/';
    if (/NEWS/.test(requirement.key)) return 'https://newsapi.org/register';
    if (/RAPID/.test(requirement.key)) return 'https://rapidapi.com/';
    return 'https://github.com/amirsedighian071-stack/Botbuilder/blob/main/README.md';
  }

  /* -------------------------------------------------- step 5: hosting */

  function renderProviders() {
    el.providerOptions.innerHTML = PROVIDERS.map((item) => {
      const active = item.id === state.provider;
      return `<label class="option">
        <input type="radio" name="provider" value="${esc(item.id)}"${active ? ' checked' : ''} />
        <span class="option-body">${icon(item.icon, 'icon-lg')}<span><b>${esc(item.name)}</b><span>${esc(
          item.description
        )}</span></span></span>
      </label>`;
    }).join('');

    el.providerOptions.querySelectorAll('input[name="provider"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.provider = input.value;
        state.providerInfo = null;
        state.providerState = 'idle';
        renderProviderFields();
        saveDraft();
      });
    });
    renderProviderFields();
  }

  function renderProviderFields() {
    const current = provider();
    el.providerLink.href = current.link;
    el.providerLink.innerHTML = `${icon('external-link', 'icon-sm')} ${esc(current.linkLabel)}`;
    el.providerNote.textContent = current.description;
    el.providerFields.innerHTML = current.fields
      .map(
        (field) => `<div class="field">
          <label for="provider-${esc(field.key)}">${esc(field.label)}${field.required ? ' <span class="req">*</span>' : ''}</label>
          <div class="input-group">
            <input class="input" id="provider-${esc(field.key)}" data-credential="${esc(field.key)}" type="${
              field.secret ? 'password' : 'text'
            }" ${field.ltr ? 'dir="ltr"' : ''} autocomplete="off" spellcheck="false" placeholder="${esc(field.placeholder || '')}" value="${esc(
              state.credentials[field.key] || ''
            )}" />
            ${
              field.secret
                ? `<button type="button" class="btn btn-outline btn-sm" data-reveal="${esc(field.key)}">${icon(
                    'eye',
                    'icon-sm'
                  )} نمایش</button>`
                : ''
            }
          </div>
          <span class="hint">${esc(field.hint)}</span>
        </div>`
      )
      .join('');

    el.providerFields.querySelectorAll('[data-credential]').forEach((input) => {
      input.addEventListener('input', () => {
        state.credentials[input.getAttribute('data-credential')] = input.value.trim();
        state.providerInfo = null;
        state.providerState = 'idle';
        saveDraft();
      });
    });

    el.providerFields.querySelectorAll('[data-reveal]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = el.providerFields.querySelector(`[data-credential="${button.getAttribute('data-reveal')}"]`);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.innerHTML = `${icon(show ? 'eye-off' : 'eye', 'icon-sm')} ${show ? 'پنهان' : 'نمایش'}`;
      });
    });

    if (state.providerInfo) {
      setStatus(
        el.providerStatus,
        `اتصال تأیید شد — ${state.providerInfo.accountName || state.providerInfo.accountId || provider().name}`,
        'ok',
        'circle-check'
      );
    } else {
      setStatus(el.providerStatus, 'توکن میزبانی را وارد و اعتبارسنجی کنید.', null, 'key');
    }
  }

  async function validateProvider() {
    const current = provider();
    const missing = current.fields.filter((field) => field.required && !state.credentials[field.key]);
    if (missing.length) {
      setStatus(el.providerStatus, `فیلد الزامی خالی است: ${missing.map((item) => item.label).join('، ')}`, 'error', 'circle-x');
      return;
    }
    if (!Api.authenticated) {
      setStatus(el.providerStatus, 'برای اعتبارسنجی زنده باید به کنترل‌پلین وارد شوید.', 'error', 'circle-x');
      return;
    }
    setStatus(el.providerStatus, 'در حال بررسی حساب میزبانی...', 'busy', 'loader');
    try {
      const result = await Api.post('/api/deploy/validate-provider', {
        provider: state.provider,
        credentials: state.credentials
      });
      state.providerInfo = result;
      state.providerState = 'ok';
      renderProviderFields();
      BF.toast(`حساب ${current.name} تأیید شد.`, 'success');
    } catch (error) {
      state.providerState = 'error';
      setStatus(el.providerStatus, error.message, 'error', 'circle-x');
    }
  }

  /* -------------------------------------------------- step 6: review */

  function envPreview() {
    const bot = template();
    const required = (bot && bot.requirements) || [];
    const lines = [
      'NODE_ENV=production',
      `BOT_TEMPLATE=${state.templateId || 'unset'}`,
      `BOT_PLATFORM=${state.platform}`,
      `BOT_SLUG=${state.slug || 'unset'}`,
      'WEBHOOK_PATH_PREFIX=/webhooks',
      `CORS_ORIGINS=${Api.base || 'https://your-control-plane.example'}`
    ];
    for (const requirement of required) {
      if (state.integrationKeys[requirement.key]) lines.push(`${requirement.env || requirement.key}=***`);
    }
    lines.push('SECRET_MASTER_KEY=***', 'JWT_SECRET=***', 'ADMIN_SEED_EMAIL=admin@botforge.local', 'ADMIN_SEED_PASSWORD=***');
    return lines.join('\n');
  }

  function renderReview() {
    const bot = template();
    if (!el.reviewSummary) return;
    if (!bot) {
      el.reviewSummary.innerHTML = `<div class="empty">${icon('clipboard-list')}<span>برای مشاهده بازبینی، ابتدا ربات را انتخاب کنید.</span></div>`;
      return;
    }
    const rows = [
      ['ربات انتخابی', `${bot.name} (${bot.id})`],
      ['دسته', BF.categoryName(bot.category)],
      ['پلتفرم', platform().name],
      ['توکن ربات', state.token ? 'دریافت شد و در حافظه نگه داشته می‌شود' : 'وارد نشده'],
      ['نام ربات', state.name || bot.name],
      ['شناسه', state.slug ? `botforge-${state.slug}` : 'تعیین نشده'],
      ['کلیدهای یکپارچه‌سازی', `${Object.values(state.integrationKeys).filter(Boolean).length} کلید وارد شده`],
      ['میزبان', provider().name],
      ['حساب میزبانی', state.providerInfo ? state.providerInfo.accountName || state.providerInfo.accountId || 'تأیید شده' : 'تأیید نشده'],
      ['دستورهای ربات', fa(bot.commands)]
    ];
    el.reviewSummary.innerHTML = rows
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
      .join('');

    el.envPreview.innerHTML = `<code>${esc(envPreview())}</code>`;
    BF.enhanceCopy(el.reviewPanel);
    renderDeployAvailability();
  }

  function renderDeployAvailability() {
    if (!el.deployBtn) return;
    const ready = canDeploy();
    el.deployBtn.disabled = !ready || state.deploying;
    el.deployHint.textContent = !Api.authenticated
      ? 'برای استقرار خودکار ابتدا در بخش «اتصال به سرور» وارد شوید. بدون سرور می‌توانید بسته استقرار را دانلود و دستی اجرا کنید.'
      : ready
        ? 'همه پیش‌نیازها کامل است؛ دکمه زیر ربات را می‌سازد، بسته را می‌فرستد، وب‌هوک را وصل می‌کند و سلامت را بررسی می‌کند.'
        : 'برای فعال شدن استقرار، توکن ربات، نام، شناسه و توکن میزبانی را کامل کنید.';
  }

  /* ------------------------------------------------------ deployment */

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(pollDeployment, 3000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function pollDeployment() {
    if (!state.botId || !state.deploymentId) return;
    try {
      const result = await Api.get(`/api/bots/${state.botId}/deployments/${state.deploymentId}`);
      state.deployment = result.deployment;
      renderDeployment();
      if (['healthy', 'failed'].includes(result.deployment.status)) {
        stopPolling();
        state.deploying = false;
        renderDeployAvailability();
        if (result.deployment.status === 'healthy') {
          BF.toast('استقرار با موفقیت انجام شد و سرویس سالم است.', 'success');
          state.step = 5;
          renderReview();
        } else {
          BF.toast('استقرار ناموفق بود؛ گزارش گام‌ها را بررسی کنید.', 'error');
        }
      }
    } catch (error) {
      stopPolling();
      state.deploying = false;
      renderDeployAvailability();
      BF.toast(error.message, 'error');
    }
  }

  function renderDeployment() {
    const deployment = state.deployment;
    if (!deployment || !el.deployProgress) return;
    el.deployPanel.hidden = false;
    el.deployStatus.innerHTML = `${BF.statusBadge(deployment.status)} <span class="tiny dim">شناسه استقرار: <code class="code-inline">${esc(
      deployment.id
    )}</code></span>`;

    el.deployProgress.innerHTML = (deployment.steps || [])
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
      .join('');

    el.deployLogs.innerHTML = (deployment.logs || [])
      .map(
        (log) => `<div class="log-line is-${esc(log.level)}"><span class="log-time">${esc(
          new Date(log.at).toLocaleTimeString('en-GB')
        )}</span><span>${esc(log.message)}</span></div>`
      )
      .join('');

    const urls = deployment.urls || {};
    if (deployment.status === 'healthy' || urls.app) {
      const rows = [
        urls.app ? BF.copyRow(urls.app, 'آدرس سرویس') : '',
        urls.webhook ? BF.copyRow(urls.webhook, 'آدرس وب‌هوک') : '',
        urls.health ? BF.copyRow(urls.health, 'آدرس سلامت') : ''
      ].filter(Boolean);
      el.deployUrls.innerHTML = rows.length
        ? `<div class="stack">${rows.join('')}</div>`
        : '<p class="tiny dim">آدرس‌ها پس از پایان استقرار نمایش داده می‌شوند.</p>';
      BF.enhanceCopy(el.deployUrls);
    }

    if (deployment.error) {
      el.deployError.hidden = false;
      el.deployError.innerHTML = `${icon('alert-triangle')}<div><strong>خطا</strong>${esc(deployment.error)}</div>`;
    } else {
      el.deployError.hidden = true;
    }

    el.deployLinks.hidden = false;
    el.dashboardLink.href = `dashboard.html?bot=${encodeURIComponent(state.botId || '')}`;
  }

  async function deploy() {
    if (state.deploying) return;
    if (state.tokenState === 'error') {
      BF.toast('توکن ربات معتبر نیست؛ پیش از استقرار آن را اصلاح و دوباره اعتبارسنجی کنید.', 'error');
      setStep(1, true);
      return;
    }
    if (!Api.authenticated) {
      BF.toast('برای استقرار خودکار باید وارد کنترل‌پلین شوید.', 'error');
      el.connectionPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    state.deploying = true;
    renderDeployAvailability();
    el.deployBtn.classList.add('is-busy');
    el.deployProgress.innerHTML = '';
    el.deployLogs.innerHTML = '';
    el.deployError.hidden = true;
    el.deployPanel.hidden = false;
    el.deployStatus.innerHTML = `${icon('loader', 'icon-sm')} در حال ارسال درخواست استقرار...`;

    try {
      if (!state.botId) {
        const created = await Api.post('/api/bots', {
          templateId: state.templateId,
          name: state.name,
          slug: state.slug,
          platform: state.platform,
          token: state.token.trim(),
          config: {}
        });
        state.botId = created.bot.id;
        el.webhookUrl.innerHTML = BF.copyRow(created.webhookUrl, 'وب‌هوک این ربات');
        BF.enhanceCopy(el.webhookUrl);
        el.webhookBox.hidden = false;
        BF.toast('ربات ساخته شد؛ استقرار آغاز می‌شود.', 'success');
      }
      const result = await Api.post(`/api/bots/${state.botId}/deploy`, {
        provider: state.provider,
        credentials: state.credentials,
        integrationKeys: state.integrationKeys,
        corsOrigins: Api.base || undefined
      });
      state.deploymentId = result.deployment.id;
      state.deployment = result.deployment;
      renderDeployment();
      startPolling();
      saveDraft();
      BF.toast('استقرار در صف قرار گرفت و گام‌ها اجرا می‌شوند.', 'info');
    } catch (error) {
      state.deploying = false;
      el.deployBtn.classList.remove('is-busy');
      renderDeployAvailability();
      el.deployError.hidden = false;
      el.deployError.innerHTML = `${icon('alert-triangle')}<div><strong>استقرار شروع نشد</strong>${esc(error.message)}</div>`;
      BF.toast(error.message, 'error');
    }
  }

  /* ------------------------------------------------- local blueprint */

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function blueprint() {
    const bot = template();
    return {
      generator: 'BotForge static wizard',
      generatedAt: new Date().toISOString(),
      repository: 'https://github.com/amirsedighian071-stack/Botbuilder',
      bot: {
        templateId: state.templateId,
        name: state.name,
        slug: state.slug,
        platform: state.platform,
        commands: bot ? bot.commandList : []
      },
      provider: state.provider,
      environment: envPreview().split('\n').map((line) => line.split('=')[0]),
      integrationKeys: Object.keys(state.integrationKeys).filter((key) => state.integrationKeys[key]),
      deploy: {
        controlPlane: Api.base || null,
        endpoints: [
          'POST /api/bots',
          'POST /api/bots/:id/deploy',
          'GET /api/bots/:id/deployments/:deploymentId'
        ]
      }
    };
  }

  function downloadBlueprint() {
    if (!state.templateId) {
      BF.toast('ابتدا ربات را انتخاب کنید.', 'error');
      return;
    }
    downloadFile(`botforge-${state.slug || state.templateId}.json`, JSON.stringify(blueprint(), null, 2), 'application/json');
    BF.toast('فایل نقشه استقرار دانلود شد.', 'success');
  }

  function downloadEnv() {
    if (!state.templateId) {
      BF.toast('ابتدا ربات را انتخاب کنید.', 'error');
      return;
    }
    const bot = template();
    const lines = envPreview().split('\n');
    const filled = lines.map((line) => {
      if (!line.endsWith('=***')) return line;
      const key = line.split('=')[0];
      return `${key}=${BF.randomHex(24)}`;
    });
    for (const requirement of bot.requirements || []) {
      if (state.integrationKeys[requirement.key]) {
        filled.push(`${requirement.env || requirement.key}=${state.integrationKeys[requirement.key]}`);
      }
    }
    downloadFile('.env', `${filled.join('\n')}\n`);
    BF.toast('فایل .env با کلیدهای تازه ساخته شد؛ آن را محرمانه نگه دارید.', 'success');
  }

  function downloadScript() {
    if (!state.templateId) {
      BF.toast('ابتدا ربات را انتخاب کنید.', 'error');
      return;
    }
    const current = provider();
    const script =
      state.provider === 'cloudflare'
        ? [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            '',
            '# BotForge — deployment helper generated by the static wizard',
            `# Bot: ${state.name} (${state.templateId})`,
            `# Provider: ${current.name}`,
            '',
            ': "${CLOUDFLARE_API_TOKEN:?export CLOUDFLARE_API_TOKEN first}"',
            ': "${CONTROL_PLANE_URL:?export CONTROL_PLANE_URL first}"',
            ': "${ADMIN_TOKEN:?export ADMIN_TOKEN first}"',
            '',
            'BOT_JSON=$(curl -fsS -X POST "$CONTROL_PLANE_URL/api/bots" \\',
            '  -H "Authorization: Bearer $ADMIN_TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            `  -d '{"templateId":"${state.templateId}","name":"${state.name}","slug":"${state.slug}","platform":"${state.platform}","token":"'"$BOT_TOKEN"'"}' )`,
            '',
            'BOT_ID=$(printf \'%s\' "$BOT_JSON" | sed -n \'s/.*"id":"\\([^"]*\\)".*/\\1/p\')',
            'echo "bot created: $BOT_ID"',
            '',
            'curl -fsS -X POST "$CONTROL_PLANE_URL/api/bots/$BOT_ID/deploy" \\',
            '  -H "Authorization: Bearer $ADMIN_TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            `  -d '{"provider":"${state.provider}","credentials":{"apiToken":"'"$CLOUDFLARE_API_TOKEN"'"}}'`,
            '',
            'echo "poll: $CONTROL_PLANE_URL/api/bots/$BOT_ID/deployments"'
          ].join('\n')
        : [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            '',
            '# BotForge — deployment helper generated by the static wizard',
            `# Bot: ${state.name} (${state.templateId})`,
            `# Provider: ${current.name}`,
            '',
            ': "${RAILWAY_API_TOKEN:?export RAILWAY_API_TOKEN first}"',
            ': "${CONTROL_PLANE_URL:?export CONTROL_PLANE_URL first}"',
            ': "${ADMIN_TOKEN:?export ADMIN_TOKEN first}"',
            '',
            'BOT_JSON=$(curl -fsS -X POST "$CONTROL_PLANE_URL/api/bots" \\',
            '  -H "Authorization: Bearer $ADMIN_TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            `  -d '{"templateId":"${state.templateId}","name":"${state.name}","slug":"${state.slug}","platform":"${state.platform}","token":"'"$BOT_TOKEN"'"}' )`,
            '',
            'BOT_ID=$(printf \'%s\' "$BOT_JSON" | sed -n \'s/.*"id":"\\([^"]*\\)".*/\\1/p\')',
            'echo "bot created: $BOT_ID"',
            '',
            'curl -fsS -X POST "$CONTROL_PLANE_URL/api/bots/$BOT_ID/deploy" \\',
            '  -H "Authorization: Bearer $ADMIN_TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            `  -d '{"provider":"railway","credentials":{"apiToken":"'"$RAILWAY_API_TOKEN"'"}}'`,
            '',
            'echo "poll: $CONTROL_PLANE_URL/api/bots/$BOT_ID/deployments"'
          ].join('\n');
    downloadFile(`botforge-deploy-${state.slug || state.templateId}.sh`, `${script}\n`);
    BF.toast('اسکریپت استقرار دانلود شد.', 'success');
  }

  /* ------------------------------------------------------------- steps */

  function setStep(index, silent) {
    const target = Math.max(0, Math.min(STEP_TITLES.length - 1, index));
    if (!silent) {
      const error = validateStep(state.step, target);
      if (error) {
        BF.toast(error, 'error');
        return;
      }
    }
    state.step = target;
    document.querySelectorAll('.wizard-step').forEach((node) => {
      node.classList.toggle('is-active', Number(node.getAttribute('data-step')) === target);
    });
    document.querySelectorAll('.stepper-item').forEach((node) => {
      const step = Number(node.getAttribute('data-step'));
      node.classList.toggle('is-active', step === target);
      node.classList.toggle('is-done', step < target);
      node.setAttribute('aria-current', step === target ? 'step' : 'false');
    });
    if (target === 5) renderReview();
    if (target === 4) renderDeployAvailability();
    if (!silent) {
      const panel = document.querySelector('.wizard-panel');
      if (panel && typeof panel.scrollIntoView === 'function') {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    saveDraft();
  }

  function canDeploy() {
    return Boolean(state.templateId && state.token && state.name && state.slug && state.credentials.apiToken);
  }

  function validateStep(from, to) {
    if (to <= from) return null;
    if (from === 0 && !state.templateId) return 'ابتدا یکی از ۳۲ ربات را انتخاب کنید.';
    if (from === 1) {
      if (!state.token) return 'توکن ربات را وارد کنید.';
      const error = localTokenCheck(state.token);
      if (error) return error;
    }
    if (from === 2) {
      if (!state.name || state.name.trim().length < 2) return 'نام ربات باید حداقل ۲ کاراکتر باشد.';
      const error = slugError(state.slug);
      if (error) return error;
    }
    if (from === 3) {
      const bot = template();
      const missing = (bot && bot.requirements ? bot.requirements : []).filter(
        (requirement) => requirement.required && !state.integrationKeys[requirement.key]
      );
      if (missing.length) return `کلید الزامی وارد نشده: ${missing.map((item) => item.label).join('، ')}`;
    }
    if (from === 4) {
      const current = provider();
      const missing = current.fields.filter((field) => field.required && !state.credentials[field.key]);
      if (missing.length) return `اعتبارنامه میزبانی کامل نیست: ${missing.map((item) => item.label).join('، ')}`;
    }
    return null;
  }

  /* -------------------------------------------------------------- init */

  function cacheElements() {
    el.stepper = document.getElementById('wizardStepper');
    el.templateList = document.getElementById('templateList');
    el.templateChips = document.getElementById('templateChips');
    el.templateSearch = document.getElementById('templateSearch');
    el.platformOptions = document.getElementById('platformOptions');
    el.token = document.getElementById('botToken');
    el.tokenHint = document.getElementById('tokenHint');
    el.tokenStatus = document.getElementById('tokenStatus');
    el.platformLink = document.getElementById('platformLink');
    el.platformDocs = document.getElementById('platformDocs');
    el.validateTokenBtn = document.getElementById('validateTokenBtn');
    el.name = document.getElementById('botName');
    el.slug = document.getElementById('botSlug');
    el.identityTemplate = document.getElementById('identityTemplate');
    el.integrationFields = document.getElementById('integrationFields');
    el.providerOptions = document.getElementById('providerOptions');
    el.providerFields = document.getElementById('providerFields');
    el.providerLink = document.getElementById('providerLink');
    el.providerNote = document.getElementById('providerNote');
    el.providerStatus = document.getElementById('providerStatus');
    el.reviewPanel = document.getElementById('reviewPanel');
    el.reviewSummary = document.getElementById('reviewSummary');
    el.envPreview = document.getElementById('envPreview');
    el.deployBtn = document.getElementById('deployBtn');
    el.deployHint = document.getElementById('deployHint');
    el.deployPanel = document.getElementById('deployPanel');
    el.deployStatus = document.getElementById('deployStatus');
    el.deployProgress = document.getElementById('deployProgress');
    el.deployLogs = document.getElementById('deployLogs');
    el.deployUrls = document.getElementById('deployUrls');
    el.deployError = document.getElementById('deployError');
    el.deployLinks = document.getElementById('deployLinks');
    el.dashboardLink = document.getElementById('dashboardLink');
    el.webhookBox = document.getElementById('webhookBox');
    el.webhookUrl = document.getElementById('webhookUrl');
    el.connectionPanel = document.getElementById('connectionPanel');
    el.connectionState = document.getElementById('connectionState');
    el.connectionTest = document.getElementById('connectionTest');
    el.apiBase = document.getElementById('apiBase');
    el.email = document.getElementById('adminEmail');
    el.password = document.getElementById('adminPassword');
    el.loginBtn = document.getElementById('loginBtn');
    el.logoutBtn = document.getElementById('logoutBtn');
  }

  function wireEvents() {
    el.stepper.querySelectorAll('[data-step]').forEach((button) => {
      button.addEventListener('click', () => setStep(Number(button.getAttribute('data-step'))));
    });
    document.querySelectorAll('[data-next]').forEach((button) =>
      button.addEventListener('click', () => setStep(state.step + 1))
    );
    document.querySelectorAll('[data-prev]').forEach((button) =>
      button.addEventListener('click', () => setStep(state.step - 1))
    );

    el.templateChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      el.templateChips.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('chip-active', item === button));
      el.templateList.dataset.filter = button.getAttribute('data-filter');
      filterTemplates(button.getAttribute('data-filter'), el.templateSearch.value.trim());
    });

    el.templateSearch.addEventListener('input', () => {
      filterTemplates(el.templateList.dataset.filter || 'all', el.templateSearch.value.trim());
    });

    el.templateList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-template]');
      if (!button) return;
      selectTemplate(button.getAttribute('data-template'));
    });

    el.token.addEventListener('input', () => {
      state.token = el.token.value.trim();
      state.tokenState = 'idle';
      state.tokenInfo = null;
      state.botId = null;
      renderTokenStatus();
      saveDraft();
      if (state.token.length >= 20 && !localTokenCheck(state.token) && Api.authenticated) {
        window.clearTimeout(el.token._timer);
        el.token._timer = window.setTimeout(validateToken, 650);
      }
    });
    el.validateTokenBtn.addEventListener('click', validateToken);

    el.name.addEventListener('input', () => {
      state.name = el.name.value.trim();
      saveDraft();
      renderReview();
    });
    el.slug.addEventListener('input', () => {
      state.slug = el.slug.value.trim().toLowerCase();
      const error = slugError(state.slug);
      el.slug.classList.toggle('is-invalid', Boolean(error));
      el.slug.classList.toggle('is-valid', !error);
      saveDraft();
      renderReview();
    });

    document.getElementById('slugSuggest').addEventListener('click', () => {
      const bot = template();
      if (!bot) return;
      state.slug = defaultSlug(bot);
      el.slug.value = state.slug;
      el.slug.classList.remove('is-invalid');
      el.slug.classList.add('is-valid');
      saveDraft();
    });

    document.getElementById('validateProviderBtn').addEventListener('click', validateProvider);
    el.deployBtn.addEventListener('click', deploy);
    document.getElementById('downloadBlueprint').addEventListener('click', downloadBlueprint);
    document.getElementById('downloadEnv').addEventListener('click', downloadEnv);
    document.getElementById('downloadScript').addEventListener('click', downloadScript);
    document.getElementById('refreshDeployment').addEventListener('click', () => {
      if (!state.deploymentId) {
        BF.toast('هنوز استقراری آغاز نشده است.', 'info');
        return;
      }
      pollDeployment();
    });

    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);
    el.loginBtn.addEventListener('click', login);
    el.logoutBtn.addEventListener('click', logout);
    el.connectionPanel.addEventListener('submit', (event) => {
      event.preventDefault();
      login();
    });
  }

  function restoreDeployment() {
    if (!state.botId || !Api.authenticated) return;
    Api.get(`/api/bots/${state.botId}/deployments`)
      .then((result) => {
        const latest = (result.items || [])[0];
        if (!latest) return;
        state.deploymentId = latest.id;
        state.deployment = latest;
        renderDeployment();
        if (!['healthy', 'failed'].includes(latest.status)) startPolling();
      })
      .catch(() => {
        /* the bot may have been removed from the control plane */
      });
  }

  function init() {
    if (!document.getElementById('templateList')) return;
    cacheElements();
    readQuery();
    loadDraft();
    renderCategoryChips();
    renderTemplateGrid();
    renderPlatforms();
    renderIdentity();
    renderIntegration();
    renderProviders();
    wireEvents();
    renderConnection();
    renderTokenStatus();
    renderReview();
    setStep(state.step, true);
    if (state.token) {
      el.token.value = state.token;
      if (state.tokenState === 'ok') renderTokenStatus();
    }
    restoreDeployment();
  }

  BF.ready(init);
})();
