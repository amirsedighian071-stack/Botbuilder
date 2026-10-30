/* BotForge wizard — four steps, no server, no control plane.
 *
 *  1. pick a template from the 32-bot catalog
 *  2. choose the platform and verify the bot token from the browser
 *  3. fill the integration keys that template needs
 *  4. name it, pick a host and build a ready-to-deploy package
 */
(function () {
  'use strict';

  const BF = window.BF;
  const Installer = window.BotForgeInstaller;
  const CATALOG = window.BOTFORGE_CATALOG || { bots: [], categories: [] };
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const fa = BF.faDigits;

  const KEY_LINKS = {
    GOLD_API_KEY: { href: 'https://metals.dev/', label: 'ساخت کلید metals.dev' },
    NEWS_API_KEY: { href: 'https://newsapi.org/register', label: 'ثبت‌نام در NewsAPI' },
    AI_API_KEY: { href: 'https://platform.openai.com/api-keys', label: 'ساخت کلید در OpenAI' },
    MEDIA_API_KEY: { href: 'https://rapidapi.com/hub', label: 'سرویس دانلود در RapidAPI' },
    MEDIA_API_URL: { href: 'https://rapidapi.com/hub', label: 'سرویس دانلود در RapidAPI' },
    SPEECH_TTS_URL: { href: 'https://platform.openai.com/docs/guides/text-to-speech', label: 'مستندات سرویس گفتار' }
  };

  const STEPS = [
    { label: 'انتخاب ربات', short: 'ربات' },
    { label: 'پلتفرم و توکن', short: 'پلتفرم' },
    { label: 'کلیدهای API', short: 'کلیدها' },
    { label: 'ساخت بسته', short: 'بسته' }
  ];

  const state = {
    step: 0,
    templateId: '',
    search: '',
    category: '',
    platform: 'telegram',
    token: '',
    tokenState: 'idle',
    tokenInfo: null,
    tokenError: '',
    keys: {},
    name: '',
    slug: '',
    provider: 'cloudflare',
    forceEnabled: false,
    channels: [],
    built: null,
    busy: false
  };

  const el = {};

  /* ------------------------------------------------------------ helpers */

  function templates() {
    return CATALOG.bots || [];
  }

  function template() {
    return templates().find((item) => item.id === state.templateId) || null;
  }

  function platform() {
    return Installer.PLATFORMS[state.platform];
  }

  function provider() {
    return Installer.PROVIDERS[state.provider];
  }

  function requirements() {
    const bot = template();
    return (bot && bot.requirements) || [];
  }

  function missingRequiredKeys() {
    return requirements().filter((item) => item.required && !String(state.keys[item.key] || '').trim());
  }

  function setStatus(node, text, tone, iconName) {
    BF.setStatus(node, text, tone, iconName);
  }

  /* -------------------------------------------------------------- steps */

  function renderStepper() {
    el.stepper.innerHTML = STEPS.map(
      (step, index) =>
        `<button type="button" class="stepper-item${index === state.step ? ' is-active' : ''}${
          index < state.step ? ' is-done' : ''
        }" data-step="${index}" ${index === state.step ? 'aria-current="step"' : ''}>
          <span class="step-num">${fa(index + 1)}</span>
          <span class="step-label">${esc(step.label)}</span>
        </button>`
    ).join('');
    el.stepper.querySelectorAll('[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = Number(button.getAttribute('data-step'));
        if (target <= state.step) goTo(target);
        else if (validate(state.step)) goTo(Math.min(target, state.step + 1));
      });
    });
  }

  function goTo(step) {
    state.step = Math.max(0, Math.min(STEPS.length - 1, step));
    document.querySelectorAll('.wizard-step').forEach((section) => {
      const active = Number(section.getAttribute('data-step')) === state.step;
      section.classList.toggle('is-active', active);
      section.hidden = !active;
    });
    renderStepper();
    if (state.step === 2) renderKeys();
    if (state.step === 3) renderReview();
    const panel = document.querySelector('.wizard-panel');
    if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validate(step) {
    if (step === 0) {
      if (!state.templateId) {
        BF.toast('یک قالب انتخاب کنید.', 'error');
        return false;
      }
      return true;
    }
    if (step === 1) {
      const value = state.token.trim();
      if (!value) {
        setStatus(el.tokenStatus, 'توکن ربات را وارد کنید.', 'error', 'circle-x');
        return false;
      }
      if (!platform().tokenPattern.test(value)) {
        setStatus(el.tokenStatus, platform().tokenHint, 'error', 'circle-x');
        return false;
      }
      if (state.tokenState === 'error') {
        setStatus(el.tokenStatus, state.tokenError || 'توکن معتبر نیست.', 'error', 'circle-x');
        return false;
      }
      return true;
    }
    if (step === 2) {
      const missing = missingRequiredKeys();
      if (missing.length) {
        BF.toast(`${fa(missing.length)} کلید الزامی باقی مانده است.`, 'error');
        return false;
      }
      return true;
    }
    return true;
  }

  /* ------------------------------------------------------------ step 1 */

  function renderCategories() {
    const categories = CATALOG.categories || [];
    el.categoryChips.innerHTML = [
      `<button type="button" class="chip-button${state.category === '' ? ' chip-active' : ''}" data-category="">همه</button>`,
      ...categories.map(
        (category) =>
          `<button type="button" class="chip-button${state.category === category.id ? ' chip-active' : ''}" data-category="${esc(
            category.id
          )}">${esc(category.title)} <span class="tiny dim">${fa((CATALOG.bots || []).filter((bot) => bot.category === category.id).length)}</span></button>`
      )
    ].join('');
    el.categoryChips.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state.category = button.getAttribute('data-category');
        renderCategories();
        renderTemplates();
      });
    });
  }

  function visibleTemplates() {
    const term = state.search.trim().toLowerCase();
    return templates().filter((bot) => {
      if (state.category && bot.category !== state.category) return false;
      if (!term) return true;
      const haystack = [bot.name, bot.summary, bot.id, ...(bot.tags || []), ...(bot.commandList || []).map((command) => command.command)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  function renderTemplates() {
    const list = visibleTemplates();
    el.templateCount.textContent = `${fa(templates().length)} قالب`;
    if (!list.length) {
      el.templateList.innerHTML = `<div class="empty">${icon('search')}<span>قالبی با این جست‌وجو پیدا نشد.</span></div>`;
      return;
    }
    el.templateList.innerHTML = list
      .map((bot) => {
        const active = bot.id === state.templateId;
        return `<label class="template-option${active ? ' is-active' : ''}" data-id="${esc(bot.id)}">
          <input type="radio" name="template" value="${esc(bot.id)}" ${active ? 'checked' : ''} />
          <span class="bot-icon" aria-hidden="true">${icon(bot.icon || 'bot', 'icon-lg')}</span>
          <div class="template-body">
            <div class="row-between">
              <strong>${esc(bot.name)}</strong>
              <span class="badge badge-muted">${fa(bot.number || '')}</span>
            </div>
            <p>${esc(bot.summary)}</p>
            <span class="tiny dim">${fa((bot.commandList || []).length)} دستور • ${
              (bot.requirements || []).length ? `${fa((bot.requirements || []).length)} کلید` : 'بدون کلید'
            }</span>
          </div>
        </label>`;
      })
      .join('');
    el.templateList.querySelectorAll('[data-id]').forEach((node) => {
      node.addEventListener('click', () => {
        state.templateId = node.getAttribute('data-id');
        const bot = template();
        if (bot) {
          state.name = bot.name;
          state.slug = Installer.suggestionFor(bot.id, state.platform);
        }
        renderTemplates();
        el.step1Note.textContent = `انتخاب شد: ${bot ? bot.name : ''}`;
        const badge = el.templateList.querySelector(`[data-id="${state.templateId}"]`);
        if (badge) badge.classList.add('is-active');
      });
    });
  }

  /* ------------------------------------------------------------ step 2 */

  function renderPlatforms() {
    el.platformOptions.innerHTML = Object.values(Installer.PLATFORMS)
      .map(
        (item) => `<label class="option">
          <input type="radio" name="platform" value="${item.id}" ${item.id === state.platform ? 'checked' : ''} />
          <span class="option-body">
            ${icon(item.id === 'telegram' ? 'send' : item.id === 'bale' ? 'message-circle' : 'smartphone', 'icon-sm')}
            <span>
              <b>${esc(item.name)}</b>
              <span>${esc(item.id === 'rubika' ? 'وب‌هوک و getMe روی botapi.rubika.ir' : `وب‌هوک روی ${item.host}`)}</span>
            </span>
          </span>
        </label>`
      )
      .join('');
    el.platformOptions.querySelectorAll('input[name="platform"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.platform = input.value;
        state.tokenState = 'idle';
        state.tokenInfo = null;
        if (template()) state.slug = Installer.suggestionFor(state.templateId, state.platform);
        updatePlatformLinks();
        renderTokenStatus();
      });
    });
    updatePlatformLinks();
  }

  function updatePlatformLinks() {
    const current = platform();
    el.platformLink.href = current.apiLink;
    el.platformDocs.href = current.docsLink;
    el.tokenHint.textContent = current.tokenHint;
    el.botToken.placeholder = state.platform === 'rubika' ? 'توکن ۳۲ کاراکتری روبیکا' : '123456789:AA...';
  }

  function renderTokenStatus() {
    if (state.tokenState === 'busy') {
      setStatus(el.tokenStatus, 'در حال بررسی توکن با API رسمی پلتفرم...', 'busy', 'loader');
      return;
    }
    if (state.tokenState === 'ok' && state.tokenInfo) {
      setStatus(el.tokenStatus, `توکن معتبر است${state.tokenInfo.username ? ` — ${state.tokenInfo.username}` : ''}`, 'ok', 'circle-check');
      return;
    }
    if (state.tokenState === 'warn') {
      setStatus(el.tokenStatus, state.tokenError, 'busy', 'alert-triangle');
      return;
    }
    if (state.tokenState === 'error') {
      setStatus(el.tokenStatus, state.tokenError || 'توکن معتبر نیست.', 'error', 'circle-x');
      return;
    }
    setStatus(el.tokenStatus, 'توکن پس از تکمیل، خودکار بررسی می‌شود.', '', 'key');
  }

  async function verifyToken() {
    const value = state.token.trim();
    if (!value) {
      state.tokenState = 'idle';
      renderTokenStatus();
      return;
    }
    if (!platform().tokenPattern.test(value)) {
      state.tokenState = 'error';
      state.tokenError = platform().tokenHint;
      renderTokenStatus();
      return;
    }
    state.tokenState = 'busy';
    renderTokenStatus();

    const current = platform();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const url =
        state.platform === 'rubika'
          ? `https://${current.host}/v3/${encodeURIComponent(value)}/getMe`
          : `https://${current.host}/bot${value}/getMe`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (state.platform === 'rubika') {
        const bot = (payload && payload.bot) || {};
        if (payload && payload.status === 'OK') {
          state.tokenState = 'ok';
          state.tokenInfo = { id: String(bot.bot_id || ''), username: bot.bot_title || bot.username || '' };
        } else {
          state.tokenState = 'error';
          state.tokenError = (payload && payload.status_det) || 'روبیکا توکن را نپذیرفت.';
        }
      } else if (payload && payload.ok) {
        state.tokenState = 'ok';
        state.tokenInfo = {
          id: String(payload.result.id),
          username: payload.result.username ? `@${payload.result.username}` : payload.result.first_name || ''
        };
      } else {
        state.tokenState = 'error';
        state.tokenError = (payload && payload.description) || 'پلتفرم توکن را رد کرد.';
      }
    } catch (error) {
      state.tokenState = 'warn';
      state.tokenError = `دسترسی به ${current.host} از این مرورگر ممکن نشد؛ توکن ذخیره می‌شود و هنگام استقرار بررسی خواهد شد.`;
    } finally {
      window.clearTimeout(timer);
      renderTokenStatus();
    }
  }

  /* ------------------------------------------------------------ step 3 */

  function renderKeys() {
    const items = requirements();
    el.requirementsBadge.textContent = items.length ? `${fa(items.filter((item) => item.required).length)} الزامی از ${fa(items.length)}` : 'بدون کلید';
    if (!items.length) {
      el.integrationFields.innerHTML = `<div class="empty">${icon('check')}<span>این ربات به هیچ کلید بیرونی نیاز ندارد؛ می‌توانید مستقیم ادامه دهید.</span></div>`;
      return;
    }
    el.integrationFields.innerHTML = items
      .map((item) => {
        const link = KEY_LINKS[item.key];
        return `<div class="card card-pad mb-2">
          <div class="field">
            <label for="key_${esc(item.key)}">${esc(item.label)}${item.required ? ' <span class="req">*</span>' : ' <span class="tiny dim">(اختیاری)</span>'}</label>
            <div class="input-group">
              <input id="key_${esc(item.key)}" class="input" dir="ltr" data-key="${esc(item.key)}" autocomplete="off" spellcheck="false" placeholder="${esc(
                item.key
              )}" />
              ${link ? `<a class="btn btn-outline btn-sm" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>` : ''}
            </div>
            <span class="hint">${esc(item.description || '')}</span>
            <span class="hint mono tiny">${esc(item.env || item.key)}</span>
          </div>
        </div>`;
      })
      .join('');
    el.integrationFields.querySelectorAll('[data-key]').forEach((input) => {
      input.value = state.keys[input.getAttribute('data-key')] || '';
      input.addEventListener('input', () => {
        state.keys[input.getAttribute('data-key')] = input.value.trim();
      });
    });
  }

  /* ------------------------------------------------------------ step 4 */

  function providerNote() {
    const current = provider();
    if (!current || !current.note) {
      el.providerNote.hidden = true;
      return;
    }
    el.providerNote.hidden = false;
    el.providerNoteText.textContent = current.note;
  }

  function renderProviders() {
    el.providerOptions.innerHTML = Object.values(Installer.PROVIDERS)
      .map(
        (item) => `<label class="option">
          <input type="radio" name="provider" value="${item.id}" ${item.id === state.provider ? 'checked' : ''} />
          <span class="option-body">
            ${icon(item.icon, 'icon-sm')}
            <span>
              <b>${esc(item.name)}</b>
              <span>${esc(item.summary)}</span>
            </span>
          </span>
        </label>`
      )
      .join('');
    el.providerOptions.querySelectorAll('input[name="provider"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.provider = input.value;
        providerNote();
      });
    });
    providerNote();
  }

  function renderChannels() {
    el.forceChannels.innerHTML = state.channels
      .map(
        (channel, index) => `<div class="card card-pad" data-channel="${index}">
          <div class="row-between">
            <strong>کانال ${fa(index + 1)}</strong>
            <button type="button" class="btn btn-sm btn-danger" data-remove="${index}">حذف</button>
          </div>
          <div class="form-grid mt-1">
            <div class="field">
              <label>پلتفرم</label>
              <select data-field="platform">
                ${Object.values(Installer.PLATFORMS)
                  .map((item) => `<option value="${item.id}"${channel.platform === item.id ? ' selected' : ''}>${esc(item.name)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label>شناسه چت</label>
              <input dir="ltr" data-field="chatId" value="${esc(channel.chatId || '')}" placeholder="@mychannel" />
            </div>
            <div class="field">
              <label>عنوان کانال</label>
              <input data-field="title" value="${esc(channel.title || '')}" placeholder="کانال رسمی" />
            </div>
            <div class="field">
              <label>لینک دعوت</label>
              <input dir="ltr" data-field="inviteLink" value="${esc(channel.inviteLink || '')}" placeholder="https://t.me/mychannel" />
            </div>
          </div>
        </div>`
      )
      .join('');
    el.forceChannels.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        collectChannels();
        state.channels.splice(Number(button.getAttribute('data-remove')), 1);
        renderChannels();
      });
    });
    el.forceChannels.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', collectChannels);
    });
  }

  function collectChannels() {
    state.channels = Array.from(el.forceChannels.querySelectorAll('[data-channel]')).map((card, index) => ({
      id: `ch_${index + 1}`,
      platform: card.querySelector('[data-field="platform"]').value,
      chatId: card.querySelector('[data-field="chatId"]').value.trim(),
      title: card.querySelector('[data-field="title"]').value.trim(),
      inviteLink: card.querySelector('[data-field="inviteLink"]').value.trim() || undefined,
      required: true
    }));
    return state.channels;
  }

  function forceMembershipConfig() {
    if (!state.forceEnabled) return Installer.emptyForceMembership();
    const channels = collectChannels().filter((channel) => channel.chatId && channel.title);
    return {
      ...Installer.emptyForceMembership(),
      enabled: channels.length > 0,
      channels
    };
  }

  function renderReview() {
    const bot = template();
    if (!bot) return;
    el.botName.value = state.name || bot.name;
    el.botSlug.value = state.slug || Installer.suggestionFor(bot.id, state.platform);
    const items = [
      ['ربات', bot.name],
      ['دسته', BF.categoryName ? BF.categoryName(bot.category) : bot.category],
      ['پلتفرم', platform().name],
      ['توکن', state.tokenState === 'ok' ? 'بررسی شد و معتبر است' : state.token ? 'ثبت شد (بررسی نهایی هنگام استقرار)' : 'وارد نشده'],
      ['کلیدها', requirements().length ? `${fa(Object.values(state.keys).filter(Boolean).length)} از ${fa(requirements().length)}` : 'نیازی نیست'],
      ['میزبان', provider().name]
    ];
    el.reviewSummary.innerHTML = items
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(value)}</strong></div>`)
      .join('');
  }

  async function build() {
    if (state.busy) return;
    if (!validate(0) || !validate(1) || !validate(2)) return;
    state.busy = true;
    el.buildBtn.disabled = true;
    el.buildBtn.classList.add('is-busy');
    setStatus(el.buildStatus, 'در حال ساخت بسته: رمزنگاری توکن، تولید متغیرها و اسکریپت استقرار...', 'busy', 'loader');
    try {
      const bot = template();
      const spec = Installer.createSpec({
        templateId: state.templateId,
        templateName: bot.name,
        name: el.botName.value.trim() || state.name || bot.name,
        slug: el.botSlug.value.trim() || state.slug,
        platform: state.platform,
        provider: state.provider,
        integrationKeys: { ...state.keys },
        forceMembership: forceMembershipConfig()
      });
      spec.templateConfig = bot.defaultConfig || {};
      spec.token = state.token.trim();
      Installer.rememberSecrets(spec);

      const packageResult = await Installer.buildPackage(spec, bot);
      spec.webhookPath = packageResult.webhookPath;
      spec.publicBaseUrl = '';
      Installer.saveInstallation(spec);
      state.built = { spec, ...packageResult };
      renderResult();
      setStatus(el.buildStatus, `بسته ساخته شد: ${fa(packageResult.files.length)} فایل برای ${provider().name}.`, 'ok', 'circle-check');
      BF.toast('بسته استقرار آماده شد؛ فایل ZIP را دانلود کنید.', 'success');
    } catch (error) {
      setStatus(el.buildStatus, `ساخت بسته ناموفق بود: ${error.message}`, 'error', 'circle-x');
      BF.toast(error.message, 'error');
    } finally {
      state.busy = false;
      el.buildBtn.disabled = false;
      el.buildBtn.classList.remove('is-busy');
    }
  }

  function deploySteps(spec) {
    if (spec.provider === 'cloudflare') {
      return [
        'فایل ZIP را دانلود و از حالت فشرده خارج کنید.',
        'در ترمینال داخل همان پوشه، توکن Cloudflare را صادر کنید: <code class="code-inline">export CLOUDFLARE_API_TOKEN=...</code>',
        'دستور <code class="code-inline">bash deploy.sh</code> را اجرا کنید؛ پایگاه D1، طرح‌واره، رکورد ربات، رازها، ورکر و وب‌هوک خودکار ساخته و ثبت می‌شوند.',
        'آدرسی که اسکریپت چاپ می‌کند را در کنسول مدیریت وارد کنید تا آمار و کاربران را ببینید.'
      ];
    }
    return [
      'فایل ZIP را دانلود و از حالت فشرده خارج کنید.',
      'با Railway: <code class="code-inline">export RAILWAY_TOKEN=...</code> و سپس <code class="code-inline">bash deploy.sh</code>',
      'یا روی هر ماشین با Docker: <code class="code-inline">docker compose up -d --build</code>',
      'پس از گرفتن دامنه، مقدار <code class="code-inline">PUBLIC_BASE_URL</code> را در فایل .env بگذارید و یک بار دیگر مستقر کنید.'
    ];
  }

  function renderResult() {
    const { spec, files, webhookPath, fileName } = state.built;
    const items = [
      ['ربات', spec.name],
      ['قالب', `${spec.templateId} — ${spec.templateName}`],
      ['میزبان', provider().name],
      ['نام سرویس', `botforge-${spec.slug}`],
      ['ایمیل مدیر', spec.adminEmail],
      ['مسیر وب‌هوک', webhookPath],
      ['تعداد فایل', `${fa(files.length)} فایل`],
      ['نام فایل بسته', fileName]
    ];
    el.resultFacts.innerHTML = items
      .map(([label, value]) => `<div class="summary-row"><span>${esc(label)}</span><strong dir="auto">${esc(value)}</strong></div>`)
      .join('');

    el.resultSecrets.innerHTML = [
      BF.copyRow(webhookPath, 'مسیر وب‌هوک'),
      BF.copyRow(spec.adminEmail, 'ایمیل مدیر'),
      BF.copyRow(spec.adminPassword, 'گذرواژه مدیر'),
      BF.copyRow(`botforge-${spec.slug}`, 'نام سرویس')
    ].join('');

    el.resultSteps.innerHTML = deploySteps(spec)
      .map((step) => `<li>${step}</li>`)
      .join('');

    el.fileList.innerHTML = files
      .map((file) => `<span class="chip ${file.path === '.env' ? 'chip-active' : ''}"><code>${esc(file.path)}</code></span>`)
      .join('');

    el.resultBadge.textContent = `${fa(files.length)} فایل آماده`;
    el.resultPanel.hidden = false;
    BF.enhanceCopy(el.resultPanel);
    BF.hydrateIcons(el.resultPanel);
    if (typeof el.resultPanel.scrollIntoView === 'function') el.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function downloadZip() {
    if (!state.built) return;
    Installer.downloadBlob(state.built.blob, state.built.fileName);
    BF.toast('دانلود بسته آغاز شد.', 'success');
  }

  /* -------------------------------------------------------------- wiring */

  function cache() {
    el.stepper = document.getElementById('wizardStepper');
    el.templateCount = document.getElementById('templateCount');
    el.templateSearch = document.getElementById('templateSearch');
    el.categoryChips = document.getElementById('categoryChips');
    el.templateList = document.getElementById('templateList');
    el.step1Note = document.getElementById('step1Note');
    el.platformOptions = document.getElementById('platformOptions');
    el.tokenStatus = document.getElementById('tokenStatus');
    el.tokenHint = document.getElementById('tokenHint');
    el.botToken = document.getElementById('botToken');
    el.revealToken = document.getElementById('revealToken');
    el.validateTokenBtn = document.getElementById('validateTokenBtn');
    el.platformLink = document.getElementById('platformLink');
    el.platformDocs = document.getElementById('platformDocs');
    el.requirementsBadge = document.getElementById('requirementsBadge');
    el.integrationFields = document.getElementById('integrationFields');
    el.botName = document.getElementById('botName');
    el.botSlug = document.getElementById('botSlug');
    el.slugSuggest = document.getElementById('slugSuggest');
    el.providerOptions = document.getElementById('providerOptions');
    el.providerNote = document.getElementById('providerNote');
    el.providerNoteText = document.getElementById('providerNoteText');
    el.forceEnabled = document.getElementById('forceEnabled');
    el.forceChannels = document.getElementById('forceChannels');
    el.buildBtn = document.getElementById('buildBtn');
    el.buildStatus = document.getElementById('buildStatus');
    el.resultPanel = document.getElementById('resultPanel');
    el.resultBadge = document.getElementById('resultBadge');
    el.resultFacts = document.getElementById('resultFacts');
    el.resultSecrets = document.getElementById('resultSecrets');
    el.resultSteps = document.getElementById('resultSteps');
    el.fileList = document.getElementById('fileList');
    el.reviewSummary = document.getElementById('reviewSummary');
  }

  function wire() {
    document.querySelectorAll('.wizard-step [data-next]').forEach((button) => {
      button.addEventListener('click', () => {
        if (validate(state.step)) goTo(state.step + 1);
      });
    });
    document.querySelectorAll('.wizard-step [data-prev]').forEach((button) => {
      button.addEventListener('click', () => goTo(state.step - 1));
    });

    el.templateSearch.addEventListener('input', () => {
      state.search = el.templateSearch.value;
      renderTemplates();
    });

    el.botToken.addEventListener('input', () => {
      state.token = el.botToken.value.trim();
      state.tokenState = 'idle';
      state.tokenInfo = null;
      window.clearTimeout(el.botToken._timer);
      if (platform().tokenPattern.test(state.token)) {
        el.botToken._timer = window.setTimeout(verifyToken, 600);
      } else {
        renderTokenStatus();
      }
    });
    el.revealToken.addEventListener('click', () => {
      const show = el.botToken.type === 'password';
      el.botToken.type = show ? 'text' : 'password';
      el.revealToken.textContent = show ? 'پنهان' : 'نمایش';
      el.revealToken.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    el.validateTokenBtn.addEventListener('click', verifyToken);

    el.botName.addEventListener('input', () => {
      state.name = el.botName.value;
    });
    el.botSlug.addEventListener('input', () => {
      state.slug = Installer.slugify(el.botSlug.value);
      el.botSlug.value = state.slug;
    });
    el.slugSuggest.addEventListener('click', () => {
      state.slug = Installer.suggestionFor(state.templateId, state.platform);
      el.botSlug.value = state.slug;
    });

    el.forceEnabled.addEventListener('change', () => {
      state.forceEnabled = el.forceEnabled.checked;
      if (state.forceEnabled && !state.channels.length) {
        state.channels.push({ id: 'ch_1', platform: state.platform, chatId: '', title: '', inviteLink: '' });
      }
      renderChannels();
    });
    document.getElementById('addChannelBtn').addEventListener('click', () => {
      collectChannels();
      state.channels.push({ id: `ch_${state.channels.length + 1}`, platform: state.platform, chatId: '', title: '', inviteLink: '' });
      renderChannels();
    });

    el.buildBtn.addEventListener('click', build);
    document.getElementById('downloadZip').addEventListener('click', downloadZip);
  }

  function boot() {
    if (!window.BotForgeInstaller) {
      BF.toast('موتور نصب بارگذاری نشد؛ صفحه را دوباره باز کنید.', 'error');
      return;
    }
    cache();
    wire();
    renderStepper();
    renderCategories();
    renderTemplates();
    renderPlatforms();
    renderProviders();
    renderTokenStatus();
    document.querySelectorAll('.wizard-step').forEach((section) => {
      const active = Number(section.getAttribute('data-step')) === 0;
      section.classList.toggle('is-active', active);
      section.hidden = !active;
    });
    const params = new URLSearchParams(window.location.search);
    const pre = params.get('template') || params.get('bot');
    const preselected = pre ? templates().find((bot) => bot.id === pre) : null;
    if (preselected) {
      state.templateId = preselected.id;
      state.name = preselected.name;
      state.slug = Installer.suggestionFor(preselected.id, state.platform);
      renderTemplates();
      el.step1Note.textContent = `انتخاب شد: ${preselected.name}`;
    }
    BF.hydrateIcons(document);
  }

  BF.ready(boot);
})();
