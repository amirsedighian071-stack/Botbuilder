/* BotForge catalog page — search, category filters, card and table views. */
(function () {
  'use strict';

  const BF = window.BF;
  const icon = BF.icon;
  const esc = BF.escapeHtml;
  const CATALOG = window.BOTFORGE_CATALOG || { bots: [], categories: [], totals: {} };

  const state = {
    query: '',
    category: 'all',
    sort: 'number',
    view: 'cards'
  };

  const els = {};

  function categoryMeta(id) {
    return (CATALOG.categories || []).find((item) => item.id === id) || { id, title: id, accent: '#38bdf8', icon: 'layers' };
  }

  function matches(bot) {
    if (state.category !== 'all' && bot.category !== state.category) return false;
    if (!state.query) return true;
    const needle = state.query.toLowerCase();
    const haystack = [
      bot.name,
      bot.summary,
      bot.description,
      bot.id,
      categoryMeta(bot.category).title,
      ...(bot.tags || []),
      ...(bot.commandList || []).map((command) => `${command.command} ${command.description}`)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  }

  function sorted(bots) {
    const list = [...bots];
    if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    else if (state.sort === 'commands') list.sort((a, b) => b.commands - a.commands || a.number - b.number);
    else list.sort((a, b) => a.number - b.number);
    return list;
  }

  function commandMarkup(bot) {
    if (!bot.commandList || !bot.commandList.length) return '<p class="tiny dim">این ربات منوی دکمه‌ای دارد و دستور متنی ندارد.</p>';
    return `<ul class="command-list">${bot.commandList
      .map(
        (command) =>
          `<li><code class="code-inline">/${esc(command.command)}</code><span>${esc(command.description)}</span>${
            command.adminOnly ? '<span class="badge badge-warn">مدیر</span>' : ''
          }</li>`
      )
      .join('')}</ul>`;
  }

  function requirementMarkup(bot) {
    if (!bot.requirements || !bot.requirements.length) {
      return '<p class="tiny dim">این ربات به کلید بیرونی نیاز ندارد و بلافاصله پس از ساخت کار می‌کند.</p>';
    }
    return `<ul class="requirement-list">${bot.requirements
      .map(
        (requirement) => `<li class="requirement">${icon('key', 'icon-sm')}<div><b>${esc(requirement.label)}${
          requirement.required ? ' <span class="badge badge-danger">الزامی</span>' : ' <span class="badge badge-muted">اختیاری</span>'
        }</b><span>${esc(requirement.description)}</span>${
          requirement.env ? `<br /><code class="code-inline">${esc(requirement.env)}</code>` : ''
        }</div></li>`
      )
      .join('')}</ul>`;
  }

  function botCard(bot) {
    const meta = categoryMeta(bot.category);
    return `<article class="bot-card reveal" data-bot="${esc(bot.id)}">
      <div class="bot-card-top">
        <span class="bot-icon" aria-hidden="true">${icon(bot.icon || 'bot', 'icon-lg')}</span>
        <div class="bot-heading">
          <h3><span class="bot-index">${BF.faDigits(bot.number)}</span>${esc(bot.name)}</h3>
          <span class="bot-meta">${esc(meta.title)} — ${BF.faDigits(bot.commands)} دستور — نسخه ${BF.faDigits(bot.version)}</span>
        </div>
      </div>
      <p class="bot-summary">${esc(bot.summary)}</p>
      <div class="chips">${(bot.tags || [])
        .map((tag) => `<span class="chip">${esc(tag)}</span>`)
        .join('')}</div>
      <details class="bot-details">
        <summary>جزئیات، دستورها و کلیدهای مورد نیاز</summary>
        <div class="bot-details-body">
          <p>${esc(bot.description)}</p>
          <h4>دستورهای ربات</h4>
          ${commandMarkup(bot)}
          <h4>کلیدها و تنظیمات محیطی</h4>
          ${requirementMarkup(bot)}
        </div>
      </details>
      <div class="bot-card-foot">
        <a class="btn btn-primary btn-sm" href="wizard.html?bot=${encodeURIComponent(bot.id)}">${icon('rocket', 'icon-sm')} ساخت این ربات</a>
        <button type="button" class="btn btn-outline btn-sm" data-copy-command="${esc(
          (bot.commandList || []).map((command) => `/${command.command}`).join(' ')
        )}">${icon('copy', 'icon-sm')} کپی دستورها</button>
      </div>
    </article>`;
  }

  function tableRow(bot) {
    const meta = categoryMeta(bot.category);
    return `<tr>
      <td data-label="#" class="num">${BF.faDigits(bot.number)}</td>
      <td data-label="نام ربات"><strong>${esc(bot.name)}</strong><br /><span class="tiny dim">${esc(bot.id)}</span></td>
      <td data-label="دسته">${esc(meta.title)}</td>
      <td data-label="دستورها" class="num">${BF.faDigits(bot.commands)}</td>
      <td data-label="کلید الزامی" class="num">${BF.faDigits((bot.requirements || []).filter((item) => item.required).length)}</td>
      <td data-label="وضعیت"><span class="badge badge-success">${icon('circle-check', 'icon-xs')} آماده استقرار</span></td>
      <td data-label="" class="stack-actions"><a class="btn btn-secondary btn-sm" href="wizard.html?bot=${encodeURIComponent(
        bot.id
      )}">انتخاب</a></td>
    </tr>`;
  }

  function tableMarkup(bots) {
    return `<div class="table-wrap">
      <table class="data-table data-stack">
        <caption>فهرست کامل ${BF.faDigits(CATALOG.totals.bots || bots.length)} ربات آماده BotForge — روی موبایل هر ردیف به کارت عمودی تبدیل می‌شود.</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">نام ربات</th>
            <th scope="col">دسته</th>
            <th scope="col">دستورها</th>
            <th scope="col">کلید الزامی</th>
            <th scope="col">وضعیت</th>
            <th scope="col">عملیات</th>
          </tr>
        </thead>
        <tbody>${bots.map(tableRow).join('')}</tbody>
      </table>
    </div>`;
  }

  function cardsMarkup(bots) {
    if (!bots.length) return '';
    const groups = new Map();
    for (const bot of bots) {
      if (!groups.has(bot.category)) groups.set(bot.category, []);
      groups.get(bot.category).push(bot);
    }
    const order = (CATALOG.categories || []).map((category) => category.id).filter((id) => groups.has(id));
    for (const id of groups.keys()) if (!order.includes(id)) order.push(id);

    return order
      .map((id) => {
        const meta = categoryMeta(id);
        const items = groups.get(id) || [];
        return `<section class="category-block" id="category-${esc(id)}">
          <div class="category-head">
            <span class="bot-icon" aria-hidden="true">${icon(meta.icon || 'layers', 'icon-lg')}</span>
            <div>
              <h2>${esc(meta.title)}</h2>
              <span class="tiny dim">${esc(meta.description || '')}</span>
            </div>
            <span class="count">${BF.faDigits(items.length)} ربات</span>
          </div>
          <div class="grid grid-3">${items.map(botCard).join('')}</div>
        </section>`;
      })
      .join('');
  }

  function render() {
    const bots = sorted((CATALOG.bots || []).filter(matches));
    els.count.textContent = `${BF.faDigits(bots.length)} ربات از ${BF.faDigits(CATALOG.bots.length)} ربات`;
    if (!bots.length) {
      els.list.innerHTML = `<div class="empty">${icon('search')}<span>رباتی با این فیلتر پیدا نشد. عبارت جست‌وجو را تغییر دهید.</span></div>`;
      return;
    }
    els.list.innerHTML = state.view === 'table' ? tableMarkup(bots) : cardsMarkup(bots);
    BF.enhanceCopy(els.list);
    els.list.querySelectorAll('[data-copy-command]').forEach((button) => {
      if (button.dataset.copyReady === 'true') return;
      button.dataset.copyReady = 'true';
      button.addEventListener('click', () => BF.copyText(button.getAttribute('data-copy-command'), button));
    });
    const reveals = els.list.querySelectorAll('.reveal');
    reveals.forEach((node, index) => {
      node.style.transitionDelay = `${Math.min(index * 18, 240)}ms`;
      window.requestAnimationFrame(() => node.classList.add('is-visible'));
    });
    syncUrl();
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.category !== 'all') params.set('category', state.category);
    if (state.query) params.set('q', state.query);
    if (state.view !== 'cards') params.set('view', state.view);
    const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
    history.replaceState(null, '', next);
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const category = params.get('category');
    const query = params.get('q');
    const view = params.get('view');
    if (category && (CATALOG.categories || []).some((item) => item.id === category)) state.category = category;
    if (query) state.query = query;
    if (view === 'table' || view === 'cards') state.view = view;
  }

  function buildControls() {
    els.search.value = state.query;
    els.category.value = state.category;
    els.list = document.getElementById('catalogList');
    els.count = document.getElementById('catalogCount');
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-view') === state.view);
      button.setAttribute('aria-selected', String(button.getAttribute('data-view') === state.view));
    });
  }

  function wire() {
    els.search.addEventListener('input', () => {
      state.query = els.search.value.trim();
      render();
    });
    els.category.addEventListener('change', () => {
      state.category = els.category.value;
      render();
    });
    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      render();
    });
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        state.view = button.getAttribute('data-view') || 'cards';
        document.querySelectorAll('[data-view]').forEach((item) => {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        render();
      });
    });
    document.querySelectorAll('[data-category-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        state.category = button.getAttribute('data-category-jump');
        els.category.value = state.category;
        render();
      });
    });
  }

  function init() {
    if (!document.getElementById('catalogList')) return;
    els.search = document.getElementById('catalogSearch');
    els.category = document.getElementById('catalogCategory');
    els.sort = document.getElementById('catalogSort');
    if (!els.search || !els.category || !els.sort) return;

    els.category.innerHTML = `<option value="all">همه دسته‌ها</option>${(CATALOG.categories || [])
      .map((category) => `<option value="${esc(category.id)}">${esc(category.title)}</option>`)
      .join('')}`;

    const totals = CATALOG.totals || {};
    const statBots = document.getElementById('statBots');
    const statCommands = document.getElementById('statCommands');
    const statCategories = document.getElementById('statCategories');
    const statRequirements = document.getElementById('statRequirements');
    if (statBots) statBots.textContent = BF.faDigits(totals.bots || 0);
    if (statCommands) statCommands.textContent = BF.faDigits(totals.commands || 0);
    if (statCategories) statCategories.textContent = BF.faDigits(totals.categories || 0);
    if (statRequirements) statRequirements.textContent = BF.faDigits(totals.requirements || 0);

    readUrl();
    buildControls();
    wire();
    render();
  }

  BF.ready(init);
})();
