/* BotForge frontend application logic — vanilla ES2020, no build step required. */
(function () {
  'use strict';

  const DATA = window.BOTFORGE_CATALOG || { bots: [], categories: [], totals: {} };
  const Icons = window.BotForgeIcons;
  const icon = (name, cls) => (Icons ? Icons.icon(name, cls) : '');

  const CATEGORY_NAMES = {};
  DATA.categories.forEach((category) => {
    CATEGORY_NAMES[category.id] = category.title;
  });

  const state = {
    filter: 'ALL',
    search: '',
    wizardStep: 1,
    platform: 'telegram',
    botId: DATA.bots[0] ? DATA.bots[0].id : '',
    name: '',
    slug: '',
    token: ''
  };

  /* ---------------------------------------------------------------- utils */

  function el(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function randomHex(bytes) {
    const buffer = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buffer);
    } else {
      for (let index = 0; index < buffer.length; index += 1) buffer[index] = Math.floor(Math.random() * 256);
    }
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function toLatinDigits(value) {
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    return String(value).replace(/[۰-۹٠-٩]/g, (char) => {
      const p = persian.indexOf(char);
      if (p >= 0) return String(p);
      return String(arabic.indexOf(char));
    });
  }

  function slugify(value) {
    return toLatinDigits(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function copyText(text, button) {
    const done = () => {
      if (!button) return;
      const original = button.innerHTML;
      button.classList.add('is-copied');
      button.innerHTML = `${icon('check', 'icon-sm')}<span>کپی شد</span>`;
      window.setTimeout(() => {
        button.classList.remove('is-copied');
        button.innerHTML = original;
      }, 1800);
    };

    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        done();
      } finally {
        document.body.removeChild(area);
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
      return;
    }
    fallback();
  }

  function copyTargetFor(block) {
    const source = block.getAttribute('data-copy-src');
    if (source) {
      const node = document.querySelector(source);
      if (node) return node.innerText || node.textContent || '';
    }
    const raw = block.getAttribute('data-copy');
    if (raw) return raw;
    const code = block.querySelector('code');
    if (code) return code.textContent || '';
    return block.innerText || block.textContent || '';
  }

  function setupCopyButtons(scope) {
    const root = scope || document;
    root.querySelectorAll('.copyable, [data-copy]').forEach((block) => {
      if (block.dataset.copyReady === 'true') return;
      block.dataset.copyReady = 'true';
      if (!block.matches('pre, .code-window')) block.classList.add('selectable');
      if (block.querySelector(':scope > .copy-btn')) return;
      const button = el(
        `<button type="button" class="copy-btn" aria-label="کپی کردن">${icon('copy', 'icon-sm')}<span>کپی</span></button>`
      );
      button.addEventListener('click', () => copyText(copyTargetFor(block), button));
      if (block.matches('pre')) {
        block.after(button);
        const wrapper = block.parentElement;
        if (wrapper && wrapper.classList.contains('result-block')) {
          const header = wrapper.querySelector('h4');
          if (header) header.appendChild(button);
        } else {
          button.style.marginBottom = '14px';
        }
      } else if (block.classList.contains('code-window')) {
        block.appendChild(button);
      } else {
        block.appendChild(button);
      }
    });
  }

  /* ------------------------------------------------------------- navigation */

  function initNavigation() {
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.nav-toggle');
    if (toggle && header) {
      toggle.addEventListener('click', () => {
        const open = header.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      document.querySelectorAll('.nav a').forEach((link) => {
        link.addEventListener('click', () => {
          header.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const sections = Array.from(document.querySelectorAll('main section[id]'));
    const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
    if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            navLinks.forEach((link) => {
              link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
            });
          });
        },
        { rootMargin: '-45% 0px -50% 0px' }
      );
      sections.forEach((section) => observer.observe(section));
    }

    document.querySelectorAll('.reveal').forEach((node) => {
      if (!('IntersectionObserver' in window)) {
        node.classList.add('is-visible');
        return;
      }
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08 }
      );
      revealObserver.observe(node);
    });

    const year = document.querySelector('[data-current-year]');
    if (year) year.textContent = '۱۴۰۴';
  }

  /* -------------------------------------------------------------- platform */

  function initPlatforms() {
    const tabs = document.querySelectorAll('.platform-tab');
    if (!tabs.length) return;
    const panels = document.querySelectorAll('.platform-panel');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((item) => item.classList.remove('is-active'));
        tab.classList.add('is-active');
        const target = tab.getAttribute('data-platform');
        panels.forEach((panel) => {
          panel.hidden = panel.getAttribute('data-panel') !== target;
        });
      });
    });
  }

  /* ---------------------------------------------------------------- catalog */

  function botCard(bot) {
    const category = CATEGORY_NAMES[bot.category] || bot.category;
    return `
      <article class="bot-card" data-bot-id="${escapeHtml(bot.id)}">
        <div class="bot-card-head">
          <div class="bot-card-icon">${icon(bot.icon)}</div>
          <div class="bot-card-title">
            <h3>${escapeHtml(bot.name)}</h3>
            <span class="cat">دسته ${escapeHtml(bot.category)} — ${escapeHtml(category)}</span>
          </div>
          <span class="bot-number">${String(bot.number).padStart(2, '0')}</span>
        </div>
        <p>${escapeHtml(bot.summary)}</p>
        <div class="bot-tags">
          ${bot.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="bot-card-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-details>جزئیات</button>
          <button type="button" class="btn btn-primary btn-sm" data-launch-bot>راه‌اندازی</button>
        </div>
        <div class="bot-details">
          <p>${escapeHtml(bot.description)}</p>
          <h4>دستورهای ربات</h4>
          <ul>
            ${bot.commandList
              .map(
                (command) =>
                  `<li><span class="cmd">/${escapeHtml(command.command)}</span> — ${escapeHtml(command.description)}${
                    command.adminOnly ? ' <span class="badge optional">مدیر</span>' : ''
                  }</li>`
              )
              .join('')}
          </ul>
          <h4>نیازمندی‌ها</h4>
          ${
            bot.requirements.length
              ? `<ul>${bot.requirements
                  .map(
                    (requirement) =>
                      `<li>${escapeHtml(requirement.label)} <code>${escapeHtml(requirement.env || requirement.key)}</code> ${
                        requirement.required
                          ? '<span class="badge required">الزامی</span>'
                          : '<span class="badge optional">اختیاری</span>'
                      }</li>`
                  )
                  .join('')}</ul>`
              : '<ul><li>بدون کلید خارجی — بلافاصله پس از نصب کار می‌کند.</li></ul>'
          }
          <h4>نسخه</h4>
          <p><code>v${escapeHtml(bot.version)}</code></p>
        </div>
      </article>`;
  }

  function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    if (!grid) return;
    const query = state.search.trim().toLowerCase();
    const filtered = DATA.bots.filter((bot) => {
      const matchesCategory = state.filter === 'ALL' || bot.category === state.filter;
      if (!matchesCategory) return false;
      if (!query) return true;
      const haystack = [bot.name, bot.summary, bot.description, bot.id, bot.tags.join(' '), bot.commandList.map((c) => c.command).join(' ')]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    const grid_html = filtered.map(botCard).join('');
    grid.innerHTML = filtered.length
      ? grid_html
      : `<div class="empty-state">رباتی با این مشخصات پیدا نشد. فیلتر را تغییر دهید یا عبارت دیگری جست‌وجو کنید.</div>`;

    const counter = document.getElementById('catalogCount');
    if (counter) counter.textContent = `${filtered.length} از ${DATA.bots.length} ربات`;

    grid.querySelectorAll('[data-toggle-details]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = button.closest('.bot-card');
        const open = card.classList.toggle('is-open');
        button.textContent = open ? 'بستن' : 'جزئیات';
      });
    });

    grid.querySelectorAll('[data-launch-bot]').forEach((button) => {
      button.addEventListener('click', () => {
        const card = button.closest('.bot-card');
        selectBot(card.getAttribute('data-bot-id'));
        goToStep(2);
        const wizard = document.getElementById('wizard');
        if (wizard) wizard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    setupCopyButtons(grid);
  }

  function renderFilters() {
    const wrap = document.getElementById('filterChips');
    if (!wrap) return;
    const counts = { ALL: DATA.bots.length };
    DATA.bots.forEach((bot) => {
      counts[bot.category] = (counts[bot.category] || 0) + 1;
    });

    const chips = [{ id: 'ALL', title: 'همه ربات‌ها' }].concat(
      DATA.categories.map((category) => ({ id: category.id, title: category.title }))
    );

    wrap.innerHTML = chips
      .map(
        (chip) =>
          `<button type="button" class="filter-chip${state.filter === chip.id ? ' is-active' : ''}" data-filter="${chip.id}" aria-pressed="${
            state.filter === chip.id
          }">${escapeHtml(chip.title)}<span>${counts[chip.id] || 0}</span></button>`
      )
      .join('');

    wrap.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.getAttribute('data-filter');
        renderFilters();
        renderCatalog();
      });
    });
  }

  function initCatalogControls() {
    const search = document.getElementById('catalogSearch');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          state.search = search.value;
          renderCatalog();
        }, 120);
      });
    }
    renderFilters();
    renderCatalog();
  }

  /* ----------------------------------------------------------------- wizard */

  function findBot(id) {
    return DATA.bots.find((bot) => bot.id === id) || DATA.bots[0];
  }

  function selectBot(id) {
    state.botId = id;
    const bot = findBot(id);
    const select = document.getElementById('wizardBot');
    if (select) select.value = bot.id;
    const summary = document.getElementById('wizardBotSummary');
    if (summary) {
      summary.innerHTML = `ربات انتخاب‌شده: <strong>${escapeHtml(bot.name)}</strong> — ${escapeHtml(bot.summary)}`;
    }
    if (!state.name) {
      state.name = bot.name;
      const nameInput = document.getElementById('wizardName');
      if (nameInput) nameInput.value = state.name;
    }
    if (!state.slug) {
      state.slug = `bot-${bot.id}`.slice(0, 40);
      const slugInput = document.getElementById('wizardSlug');
      if (slugInput) slugInput.value = state.slug;
    }
    updateRequirementFields();
  }

  function updateRequirementFields() {
    const container = document.getElementById('wizardRequirements');
    if (!container) return;
    const bot = findBot(state.botId);
    const relevant = bot.requirements || [];
    if (!relevant.length) {
      container.innerHTML = `<div class="hint-box">${icon('check')}<div>این ربات به کلید خارجی نیاز ندارد و پس از نصب آماده کار است.</div></div>`;
      return;
    }
    container.innerHTML = relevant
      .map(
        (requirement) => `
        <div class="field">
          <label for="req-${escapeHtml(requirement.key)}">${escapeHtml(requirement.label)}${
            requirement.required ? ' (الزامی)' : ' (اختیاری)'
          }</label>
          <input id="req-${escapeHtml(requirement.key)}" dir="ltr" data-requirement="${escapeHtml(
            requirement.key
          )}" type="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(
            requirement.env || requirement.key
          )}" />
          <small>${escapeHtml(requirement.description)} — در پنل مدیریت ربات نیز قابل تنظیم است.</small>
        </div>`
      )
      .join('');
  }

  function collectRequirements() {
    const values = {};
    document.querySelectorAll('[data-requirement]').forEach((input) => {
      const value = input.value.trim();
      if (value) values[input.getAttribute('data-requirement')] = value;
    });
    return values;
  }

  function goToStep(step) {
    state.wizardStep = Math.min(4, Math.max(1, step));
    document.querySelectorAll('.wizard-panel').forEach((panel) => {
      panel.classList.toggle('is-active', Number(panel.getAttribute('data-step')) === state.wizardStep);
    });
    document.querySelectorAll('.wizard-step-dot').forEach((dot, index) => {
      dot.classList.toggle('is-done', index < state.wizardStep);
    });
    document.querySelectorAll('.wizard-labels span').forEach((label, index) => {
      label.classList.toggle('is-active', index + 1 === state.wizardStep);
    });
    if (state.wizardStep === 4) buildResult();
    const wizard = document.getElementById('wizard');
    if (wizard) {
      const top = wizard.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  function validateStep(step) {
    const error = document.getElementById('wizardError');
    if (error) error.hidden = true;
    if (step === 3) {
      const nameInput = document.getElementById('wizardName');
      const slugInput = document.getElementById('wizardSlug');
      const tokenInput = document.getElementById('wizardToken');
      state.name = nameInput ? nameInput.value.trim() : state.name;
      state.slug = slugInput ? slugify(slugInput.value) : state.slug;
      state.token = tokenInput ? tokenInput.value.trim() : state.token;
      if (slugInput) slugInput.value = state.slug;
      const problems = [];
      if (state.name.length < 2) problems.push('نام ربات باید حداقل دو نویسه باشد.');
      if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(state.slug)) problems.push('شناسه ربات باید با حروف لاتین یا عدد شروع شود و فقط شامل حروف کوچک، عدد و خط تیره باشد.');
      if (state.token.length < 20) problems.push('توکن ربات معتبر به نظر نمی‌رسد؛ توکن کامل را از BotFather یا پنل پلتفرم بردارید.');
      if (problems.length) {
        if (error) {
          error.hidden = false;
          error.innerHTML = problems.map((problem) => `<div>${escapeHtml(problem)}</div>`).join('');
        }
        return false;
      }
    }
    return true;
  }

  function buildResult() {
    const bot = findBot(state.botId);
    const requirements = collectRequirements();
    const platformLabel = { telegram: 'Telegram', bale: 'Bale', rubika: 'Rubika' }[state.platform] || 'Telegram';
    const masterKey = randomHex(24);
    const jwtKey = randomHex(24);

    const envLines = [
      `NODE_ENV=production`,
      `PORT=8080`,
      `PUBLIC_BASE_URL=https://your-domain.example`,
      `SECRET_MASTER_KEY=${masterKey}`,
      `JWT_SECRET=${jwtKey}`,
      `DATABASE_DRIVER=postgres`,
      `DATABASE_URL=postgres://user:password@host:5432/botforge`,
      `CORS_ORIGINS=https://your-org.github.io`,
      `AI_API_KEY=`,
      `SPEECH_API_KEY=`
    ];

    Object.entries(requirements).forEach(([key, value]) => {
      envLines.push(`${key}=${value}`);
    });

    const body = {
      templateId: bot.id,
      name: state.name || bot.name,
      slug: state.slug || `bot-${bot.id}`,
      platform: state.platform,
      token: state.token || '<BOT_TOKEN>'
    };

    const curl = [
      `curl -X POST https://your-domain.example/api/bots \\`,
      `  -H "Authorization: Bearer $BOTFORGE_TOKEN" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify(body, null, 2)}'`
    ].join('\n');

    const docker = [
      'docker build -t botforge/control-plane -f apps/control-plane/Dockerfile .',
      'docker run -d --name botforge \\',
      '  --env-file .env \\',
      '  -p 8080:8080 \\',
      '  -v botforge-media:/app/.data/media \\',
      '  botforge/control-plane'
    ].join('\n');

    const webhook = `https://your-domain.example/webhooks/${state.platform}/<BOT_ID>/<WEBHOOK_SECRET>`;

    const blocks = [
      { title: 'متغیرهای محیطی (.env)', code: envLines.join('\n') },
      { title: `ثبت ربات ${platformLabel} در کنترل‌پلین`, code: curl },
      { title: 'اجرای کنترل‌پلین با Docker', code: docker },
      { title: 'الگوی آدرس وب‌هوک (پس از ثبت ربات تولید می‌شود)', code: webhook }
    ];

    const container = document.getElementById('wizardResult');
    if (!container) return;
    container.innerHTML = blocks
      .map(
        (block) => `
        <div class="result-block">
          <h4>${escapeHtml(block.title)}</h4>
          <pre class="copyable"><code>${escapeHtml(block.code)}</code></pre>
        </div>`
      )
      .join('');

    const deploy = document.getElementById('wizardDeployLinks');
    if (deploy) {
      deploy.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="https://railway.app/new" target="_blank" rel="noopener noreferrer">${icon(
          'server',
          'icon-sm'
        )} استقرار روی Railway</a>
        <a class="btn btn-ghost btn-sm" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">${icon(
          'globe',
          'icon-sm'
        )} Cloudflare Workers</a>
        <a class="btn btn-ghost btn-sm" href="docs.html#deploy" rel="noopener">${icon(
          'book-open',
          'icon-sm'
        )} راهنمای استقرار</a>`;
    }

    setupCopyButtons(container);
  }

  function initWizard() {
    const wizard = document.getElementById('wizard');
    if (!wizard) return;

    wizard.querySelectorAll('[data-platform-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        state.platform = button.getAttribute('data-platform-choice');
        wizard.querySelectorAll('[data-platform-choice]').forEach((item) => item.classList.remove('is-selected'));
        button.classList.add('is-selected');
      });
    });

    const select = document.getElementById('wizardBot');
    if (select) {
      const groups = {};
      DATA.bots.forEach((bot) => {
        (groups[bot.category] = groups[bot.category] || []).push(bot);
      });
      select.innerHTML = DATA.categories
        .map(
          (category) => `
          <optgroup label="${escapeHtml(category.title)}">
            ${(groups[category.id] || [])
              .map((bot) => `<option value="${escapeHtml(bot.id)}">${escapeHtml(bot.name)}</option>`)
              .join('')}
          </optgroup>`
        )
        .join('');
      select.addEventListener('change', () => {
        state.name = '';
        state.slug = '';
        selectBot(select.value);
      });
      selectBot(select.value || state.botId);
    }

    wizard.querySelectorAll('[data-wizard-next]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!validateStep(state.wizardStep)) return;
        goToStep(state.wizardStep + 1);
      });
    });
    wizard.querySelectorAll('[data-wizard-prev]').forEach((button) => {
      button.addEventListener('click', () => goToStep(state.wizardStep - 1));
    });
    wizard.querySelectorAll('[data-wizard-restart]').forEach((button) => {
      button.addEventListener('click', () => {
        state.name = '';
        state.slug = '';
        state.token = '';
        const nameInput = document.getElementById('wizardName');
        const slugInput = document.getElementById('wizardSlug');
        const tokenInput = document.getElementById('wizardToken');
        if (nameInput) nameInput.value = '';
        if (slugInput) slugInput.value = '';
        if (tokenInput) tokenInput.value = '';
        selectBot(state.botId);
        goToStep(1);
      });
    });

    const slugInput = document.getElementById('wizardSlug');
    if (slugInput) {
      slugInput.addEventListener('blur', () => {
        slugInput.value = slugify(slugInput.value);
      });
    }
  }

  /* -------------------------------------------------------------------- FAQ */

  function initFaq() {
    document.querySelectorAll('.faq-question').forEach((button) => {
      button.addEventListener('click', () => {
        const item = button.closest('.faq-item');
        const open = item.classList.toggle('is-open');
        button.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* ------------------------------------------------------------------- docs */

  function renderDocsBotTable() {
    const table = document.getElementById('docsBotTable');
    if (!table) return;
    table.innerHTML = `
      <thead>
        <tr><th>#</th><th>ربات</th><th>دسته</th><th>دستورها</th><th>کلیدهای لازم</th></tr>
      </thead>
      <tbody>
        ${DATA.bots
          .map(
            (bot) => `
          <tr>
            <td>${bot.number}</td>
            <td><strong>${escapeHtml(bot.name)}</strong><br /><code>${escapeHtml(bot.id)}</code></td>
            <td>${escapeHtml(bot.category)} — ${escapeHtml(CATEGORY_NAMES[bot.category] || '')}</td>
            <td>${bot.commandList.map((command) => `/${escapeHtml(command.command)}`).join(' ')}</td>
            <td>${
              bot.requirements.length
                ? bot.requirements.map((requirement) => `<code>${escapeHtml(requirement.env || requirement.key)}</code>`).join(' ')
                : '—'
            }</td>
          </tr>`
          )
          .join('')}
      </tbody>`;
  }

  function renderDocsBots() {
    const container = document.getElementById('docsBots');
    if (!container) return;
    container.innerHTML = DATA.categories
      .map((category) => {
        const bots = DATA.bots.filter((bot) => bot.category === category.id);
        return `
          <div class="docs-card">
            <h3>${escapeHtml(category.title)} <span class="badge optional">${bots.length} ربات</span></h3>
            <p>${escapeHtml(category.description)}</p>
            <ul>
              ${bots
                .map(
                  (bot) =>
                    `<li><strong>${escapeHtml(bot.name)}</strong> — ${escapeHtml(bot.summary)}${
                      bot.commandList.length
                        ? `<br /><span class="cmd">${bot.commandList.map((command) => '/' + escapeHtml(command.command)).join(' ')}</span>`
                        : ''
                    }</li>`
                )
                .join('')}
            </ul>
          </div>`;
      })
      .join('');
  }

  function initDocsSidebar() {
    const links = Array.from(document.querySelectorAll('.docs-sidebar a[href^="#"]'));
    if (!links.length) return;
    const headings = links
      .map((link) => document.querySelector(link.getAttribute('href')))
      .filter(Boolean);
    if (!('IntersectionObserver' in window) || !headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
          });
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );
    headings.forEach((heading) => observer.observe(heading));
  }

  /* ------------------------------------------------------------------- boot */

  function initStats() {
    const totals = DATA.totals || {};
    const map = {
      statBots: totals.bots || DATA.bots.length,
      statCommands: totals.commands || 0,
      statCategories: totals.categories || DATA.categories.length,
      statRequirements: totals.requirements || 0
    };
    Object.entries(map).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    });
  }

  function init() {
    initNavigation();
    initPlatforms();
    initCatalogControls();
    initWizard();
    initFaq();
    initStats();
    renderDocsBotTable();
    renderDocsBots();
    initDocsSidebar();
    setupCopyButtons(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
