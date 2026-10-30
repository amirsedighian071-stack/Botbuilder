/* BotForge shared shell: header, mobile navigation, footer, copy system, toasts. */
(function () {
  'use strict';

  const Icons = window.BotForgeIcons;
  const Api = window.BotForgeApi;
  const icon = (name, cls) => (Icons ? Icons.icon(name, cls) : '');

  const NAV = [
    { href: 'index.html', label: 'خانه', key: 'home' },
    { href: 'catalog.html', label: 'کاتالوگ ربات‌ها', key: 'catalog' },
    { href: 'wizard.html', label: 'ساخت ربات', key: 'wizard' },
    { href: 'dashboard.html', label: 'داشبورد', key: 'dashboard' },
    { href: 'deployment.html', label: 'استقرار', key: 'deployment' },
    { href: 'docs.html', label: 'مستندات', key: 'docs' }
  ];

  const CATALOG = window.BOTFORGE_CATALOG || { bots: [], categories: [], totals: {} };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function faDigits(value) {
    return String(value == null ? '' : value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
    } catch {
      return date.toISOString();
    }
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'همین حالا';
    if (minutes < 60) return `${faDigits(minutes)} دقیقه پیش`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${faDigits(hours)} ساعت پیش`;
    return `${faDigits(Math.round(hours / 24))} روز پیش`;
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^\da-z-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  function randomHex(bytes) {
    const buffer = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buffer);
    else for (let index = 0; index < buffer.length; index += 1) buffer[index] = Math.floor(Math.random() * 256);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /* --------------------------------------------------------------- shell */

  function headerMarkup(active) {
    const links = NAV.map(
      (item) =>
        `<a href="${item.href}" class="nav-link${item.key === active ? ' is-active' : ''}"${
          item.key === active ? ' aria-current="page"' : ''
        }>${item.label}</a>`
    ).join('');

    return `
      <div class="container header-inner">
        <a class="brand" href="index.html" aria-label="BotForge — صفحه اصلی">
          <span class="brand-mark" aria-hidden="true">${icon('bot', 'icon-lg')}</span>
          <span class="brand-text">
            <strong>BotForge</strong>
            <small>پلتفرم ربات پیام‌رسان</small>
          </span>
        </a>

        <nav class="nav-desktop" aria-label="ناوبری اصلی">${links}</nav>

        <div class="header-actions">
          <span class="conn-dot" id="headerConnection" title="وضعیت اتصال به سرویس ربات" hidden></span>
          <a class="btn btn-ghost btn-sm only-desktop" href="https://github.com/amirsedighian071-stack/Botbuilder" target="_blank" rel="noopener noreferrer">
            ${icon('github', 'icon-sm')} GitHub
          </a>
          <a class="btn btn-primary btn-sm only-desktop" href="wizard.html">${icon('rocket', 'icon-sm')} ساخت ربات</a>
          <button type="button" class="nav-toggle" id="navToggle" aria-controls="mobileNav" aria-expanded="false" aria-label="باز کردن منو">
            <span class="nav-toggle-open">${icon('menu')}</span>
            <span class="nav-toggle-close">${icon('x')}</span>
          </button>
        </div>
      </div>
      <div class="mobile-nav" id="mobileNav" hidden>
        <nav aria-label="ناوبری موبایل">${links}</nav>
        <a class="btn btn-primary btn-block" href="wizard.html">${icon('rocket', 'icon-sm')} ساخت ربات جدید</a>
        <a class="btn btn-ghost btn-block" href="docs.html">${icon('book-open', 'icon-sm')} مستندات</a>
      </div>
      <button type="button" class="nav-backdrop" id="navBackdrop" aria-label="بستن منو" hidden></button>`;
  }

  function footerMarkup() {
    return `
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="index.html">
              <span class="brand-mark" aria-hidden="true">${icon('bot', 'icon-lg')}</span>
              <span class="brand-text"><strong>BotForge</strong><small>پلتفرم ربات پیام‌رسان</small></span>
            </a>
            <p>زیرساخت کامل ساخت، استقرار و مدیریت ربات‌های تلگرام، بله و روبیکا با ۳۲ ربات آماده و استقرار خودکار.</p>
          </div>
          <div>
            <h4>محصول</h4>
            <ul>
              <li><a href="catalog.html">کاتالوگ ربات‌ها</a></li>
              <li><a href="wizard.html">ساخت ربات</a></li>
              <li><a href="dashboard.html">داشبورد مدیریت</a></li>
              <li><a href="deployment.html">وضعیت استقرار</a></li>
            </ul>
          </div>
          <div>
            <h4>منابع</h4>
            <ul>
              <li><a href="docs.html">مستندات</a></li>
              <li><a href="docs.html#auto-deploy">استقرار خودکار</a></li>
              <li><a href="docs.html#api">مرجع API</a></li>
              <li><a href="docs.html#troubleshooting">عیب‌یابی</a></li>
            </ul>
          </div>
          <div>
            <h4>پروژه</h4>
            <ul>
              <li><a href="https://github.com/amirsedighian071-stack/Botbuilder" target="_blank" rel="noopener noreferrer">مخزن GitHub</a></li>
              <li><a href="docs.html#security">امنیت</a></li>
              <li><a href="docs.html#bots">فهرست ۳۲ ربات</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>BotForge — بدون ایموجی، بدون متن ناتمام، با استقرار خودکار روی Cloudflare و Railway.</span>
          <span>مجوز MIT — نسخه ۱.۰.۰</span>
        </div>
      </div>`;
  }

  function mountShell() {
    const body = document.body;
    const active = body.getAttribute('data-page') || '';

    const header = document.getElementById('site-header');
    if (header) header.innerHTML = headerMarkup(active);

    const footer = document.getElementById('site-footer');
    if (footer) footer.innerHTML = footerMarkup();

    mountMobileNav();
    updateConnectionBadge();
    window.addEventListener('botforge:connection', updateConnectionBadge);
  }

  function updateConnectionBadge() {
    const badge = document.getElementById('headerConnection');
    const notification = document.querySelector('[data-connection-state]');
    const configured = Api && Api.configured;
    if (badge) {
      badge.hidden = !configured;
      badge.classList.toggle('is-online', Boolean(configured && Api.token));
      badge.title = configured
        ? Api.token
          ? 'سرویس ربات متصل و وارد شده'
          : 'آدرس سرویس ذخیره شده اما وارد نشده‌اید'
        : 'سرویس ربات تنظیم نشده است';
    }
    if (notification) {
      notification.textContent = configured
        ? `سرویس ربات: ${Api.base}`
        : 'حالت آفلاین: ویزارد بسته استقرار را بدون سرور می‌سازد.';
    }
  }

  function mountMobileNav() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('mobileNav');
    const backdrop = document.getElementById('navBackdrop');
    if (!toggle || !nav || !backdrop) return;

    const close = () => {
      nav.hidden = true;
      backdrop.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-open');
    };
    const open = () => {
      nav.hidden = false;
      backdrop.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('nav-open');
    };

    toggle.addEventListener('click', () => (nav.hidden ? open() : close()));
    backdrop.addEventListener('click', close);
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 900) close();
    });
  }

  /* ------------------------------------------------------------- toasts */

  function toast(message, tone) {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const node = document.createElement('div');
    node.className = `toast toast-${tone || 'info'}`;
    node.innerHTML = `${icon(tone === 'error' ? 'circle-x' : tone === 'success' ? 'circle-check' : 'info', 'icon-sm')}<span>${escapeHtml(
      message
    )}</span>`;
    host.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('is-leaving');
      window.setTimeout(() => node.remove(), 240);
    }, 4200);
  }

  /* -------------------------------------------------------------- copies */

  async function copyText(text, button) {
    const value = String(text || '');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.className = 'copy-helper';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      if (button) {
        button.classList.add('is-copied');
        const label = button.querySelector('span');
        const previous = label ? label.textContent : '';
        if (label) label.textContent = 'کپی شد';
        window.setTimeout(() => {
          button.classList.remove('is-copied');
          if (label) label.textContent = previous || 'کپی';
        }, 1800);
      }
      toast('در حافظه کپی شد.', 'success');
    } catch {
      toast('کپی خودکار ممکن نشد؛ متن را دستی انتخاب کنید.', 'error');
    }
  }

  function resolveCopyValue(node) {
    const source = node.getAttribute('data-copy-src');
    if (source) {
      const target = document.querySelector(source);
      if (target) return target.value !== undefined ? target.value : target.textContent || '';
    }
    const raw = node.getAttribute('data-copy');
    if (raw) return raw;
    const code = node.querySelector('code');
    if (code) return code.textContent || '';
    const value = node.querySelector('.value, .token-value');
    if (value) return value.textContent || '';
    return node.textContent || '';
  }

  function copyButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.innerHTML = `${icon('copy', 'icon-sm')}<span>${label || 'کپی'}</span>`;
    return button;
  }

  function hydrateIcons(scope) {
    const root = scope || document;
    root.querySelectorAll('[data-icon]').forEach((node) => {
      if (node.dataset.iconReady === 'true') return;
      node.dataset.iconReady = 'true';
      const large = node.classList.contains('feature-icon') || node.classList.contains('bot-icon');
      node.innerHTML = icon(node.getAttribute('data-icon'), large ? 'icon-lg' : 'icon-sm');
    });
  }

  function enhanceCopy(scope) {
    const root = scope || document;

    root.querySelectorAll('pre.code, pre.copyable').forEach((pre) => {
      if (pre.dataset.copyReady === 'true') return;
      pre.dataset.copyReady = 'true';
      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const bar = document.createElement('div');
      bar.className = 'code-bar';
      const label = document.createElement('span');
      label.innerHTML = icon('terminal', 'icon-sm');
      const button = copyButton('کپی کد');
      button.addEventListener('click', () => copyText(pre.textContent || '', button));
      bar.appendChild(label);
      bar.appendChild(button);
      wrap.insertBefore(bar, pre);
      wrap.classList.add('selectable');
    });

    root.querySelectorAll('[data-copy], [data-copy-src]').forEach((node) => {
      if (node.dataset.copyReady === 'true') return;
      if (node.matches('pre.code, pre.copyable')) return;
      node.dataset.copyReady = 'true';
      const button = copyButton(node.getAttribute('data-copy-label') || 'کپی');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        copyText(resolveCopyValue(node), button);
      });
      if (node.classList.contains('copy-row')) {
        node.appendChild(button);
      } else {
        node.classList.add('copyable');
        node.appendChild(button);
      }
    });

    root.querySelectorAll('[data-copy-input]').forEach((button) => {
      if (button.dataset.copyReady === 'true') return;
      button.dataset.copyReady = 'true';
      button.addEventListener('click', () => {
        const input = document.querySelector(button.getAttribute('data-copy-input'));
        copyText(input ? input.value || input.textContent : '', button);
      });
    });
  }

  function setStatus(node, text, tone, iconName) {
    if (!node) return;
    node.className = `field-status${tone ? ` is-${tone}` : ''}`;
    const name = iconName || (tone === 'ok' ? 'circle-check' : tone === 'error' ? 'circle-x' : tone === 'busy' ? 'loader' : 'info');
    node.innerHTML = `${icon(name, 'icon-xs')}<span>${escapeHtml(text)}</span>`;
  }

  function copyRow(value, label) {
    return `<div class="copy-row" data-copy="${escapeHtml(value)}"><span class="value" dir="ltr">${escapeHtml(
      value
    )}</span><span class="copy-row-label">${escapeHtml(label || '')}</span></div>`;
  }

  /* --------------------------------------------------------------- misc */

  function initReveal() {
    const nodes = document.querySelectorAll('.reveal');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.06 }
    );
    nodes.forEach((node) => observer.observe(node));
  }

  function initFaq() {
    document.querySelectorAll('.faq-question').forEach((button) => {
      button.addEventListener('click', () => {
        const item = button.closest('.faq-item');
        const open = item.classList.toggle('is-open');
        button.setAttribute('aria-expanded', String(open));
      });
    });
  }

  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach((group) => {
      const buttons = group.querySelectorAll('[data-tab]');
      const panels = document.querySelectorAll(`[data-tab-panel][data-group="${group.getAttribute('data-tabs')}"]`);
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          buttons.forEach((item) => {
            item.classList.remove('is-active');
            item.setAttribute('aria-selected', 'false');
          });
          button.classList.add('is-active');
          button.setAttribute('aria-selected', 'true');
          panels.forEach((panel) => {
            panel.hidden = panel.getAttribute('data-tab-panel') !== button.getAttribute('data-tab');
          });
        });
      });
    });
  }

  function categoryName(id) {
    const category = (CATALOG.categories || []).find((item) => item.id === id);
    return category ? category.title : id;
  }

  function findBot(id) {
    return (CATALOG.bots || []).find((bot) => bot.id === id);
  }

  function statusBadge(status) {
    const map = {
      healthy: { label: 'سالم', tone: 'success' },
      failed: { label: 'ناموفق', tone: 'danger' },
      queued: { label: 'در صف', tone: 'muted' },
      validating: { label: 'اعتبارسنجی', tone: 'info' },
      provisioning: { label: 'آماده‌سازی', tone: 'info' },
      uploading: { label: 'بارگذاری', tone: 'info' },
      deploying: { label: 'استقرار', tone: 'info' },
      registering: { label: 'اتصال وب‌هوک', tone: 'warn' },
      active: { label: 'فعال', tone: 'success' },
      paused: { label: 'متوقف', tone: 'warn' },
      maintenance: { label: 'حالت تعمیر', tone: 'warn' },
      disabled: { label: 'غیرفعال', tone: 'danger' }
    };
    const entry = map[status] || { label: status, tone: 'muted' };
    return `<span class="badge badge-${entry.tone}">${escapeHtml(entry.label)}</span>`;
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  window.BF = {
    icon,
    escapeHtml,
    faDigits,
    formatDateTime,
    relativeTime,
    slugify,
    randomHex,
    toast,
    copyText,
    copyRow,
    setStatus,
    enhanceCopy,
    hydrateIcons,
    categoryName,
    findBot,
    statusBadge,
    ready,
    catalog: CATALOG
  };

  ready(() => {
    mountShell();
    hydrateIcons(document);
    enhanceCopy(document);
    initReveal();
    initFaq();
    initTabs();
    document.querySelectorAll('[data-year]').forEach((node) => {
      node.textContent = '۱۴۰۴';
    });
  });
})();
