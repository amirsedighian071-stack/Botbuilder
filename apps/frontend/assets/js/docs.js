/* BotForge docs page — section search and active navigation state. */
(function () {
  'use strict';

  const BF = window.BF;
  const esc = BF.escapeHtml;

  function sections() {
    const prose = document.getElementById('docsProse');
    if (!prose) return [];
    return Array.from(prose.querySelectorAll('h2[id]')).map((heading) => {
      const nodes = [];
      let node = heading.nextElementSibling;
      while (node && node.tagName !== 'H2') {
        nodes.push(node);
        node = node.nextElementSibling;
      }
      return { heading, nodes };
    });
  }

  function filter() {
    const input = document.getElementById('docsSearch');
    const query = input.value.trim().toLowerCase();
    const prose = document.getElementById('docsProse');
    const all = sections();
    let visible = 0;

    for (const section of all) {
      const text = `${section.heading.textContent} ${section.nodes
        .map((node) => node.textContent || '')
        .join(' ')}`.toLowerCase();
      const match = !query || text.includes(query);
      section.heading.hidden = !match;
      section.nodes.forEach((node) => {
        node.hidden = !match;
      });
      if (match) visible += 1;
    }

    const existing = document.getElementById('docsEmpty');
    if (!visible) {
      if (!existing) {
        const notice = document.createElement('div');
        notice.id = 'docsEmpty';
        notice.className = 'empty';
        notice.innerHTML = `${BF.icon('search')}<span>بخشی با «${esc(input.value.trim())}» پیدا نشد.</span>`;
        prose.appendChild(notice);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function scrollSpy() {
    const links = Array.from(document.querySelectorAll('.docs-nav a[href^="#"]'));
    const targets = links
      .map((link) => ({ link, target: document.querySelector(link.getAttribute('href')) }))
      .filter((item) => item.target);
    if (!targets.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove('is-active'));
          const match = targets.find((item) => item.target === entry.target);
          if (match) {
            match.link.classList.add('is-active');
            match.link.style.color = 'var(--text-strong)';
          }
        });
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    targets.forEach((item) => observer.observe(item.target));
  }

  function init() {
    const input = document.getElementById('docsSearch');
    if (!input) return;
    input.addEventListener('input', filter);
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
    scrollSpy();
  }

  BF.ready(init);
})();
