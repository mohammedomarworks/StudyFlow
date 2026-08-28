/* ==========================================================================
   app.js — Shared application shell & UI helpers
   --------------------------------------------------------------------------
   Loaded on every page (after storage.js, before page-specific scripts).
   Exposes a single global `App` with: DOM helpers, theme control, navbar
   behavior, global search (Cmd+K / Ctrl+K), audio chimes, toast
   notifications, modal dialogs, and motivational quotes.
   ========================================================================== */

const App = {

  /* ======================= PATH RESOLVER =============================== */
  /** Resolve relative paths depending on whether we are at root or in /pages/ */
  isSubpage() {
    return window.location.pathname.includes('/pages/') ||
           document.body.dataset.page !== 'dashboard';
  },

  path(target) {
    // If target is root index.html
    const onSub = this.isSubpage();
    if (target === 'index.html') {
      return onSub ? '../index.html' : 'index.html';
    }
    // If target is inside pages/ (e.g. 'tasks.html' or 'pages/tasks.html')
    const clean = target.replace(/^pages\//, '');
    return onSub ? clean : `pages/${clean}`;
  },

  /* ======================= DOM helpers ================================= */
  qs(sel, ctx = document) { return ctx.querySelector(sel); },
  qsa(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); },

  /** Escape user-supplied text before inserting via innerHTML (XSS-safe) */
  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Debounce a function (used for live search inputs) */
  debounce(fn, ms = 200) {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
  },

  /* ========================== THEME ==================================== */
  getTheme() {
    const settings = Store.getSettings();
    return settings.theme || 'system';
  },

  applyTheme(theme) {
    const root = document.documentElement;
    let actualTheme = theme;

    if (theme === 'system') {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    root.setAttribute('data-theme', actualTheme);
    root.setAttribute('data-theme-setting', theme);
  },

  setTheme(theme) {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    Store.setSetting('theme', theme);
    this.applyTheme(theme);
    window.setTimeout(() => root.classList.remove('theme-transition'), 400);
  },

  toggleTheme() {
    const currentActual = document.documentElement.getAttribute('data-theme') || 'light';
    const next = currentActual === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  },

  initThemeListener() {
    const setting = this.getTheme();
    this.applyTheme(setting);

    // Watch system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (this.getTheme() === 'system') {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      }
    });
  },

  /* ========================== NAVBAR =================================== */
  initNavbar() {
    const page = document.body.dataset.page;
    this.qsa('.nav-links a').forEach(a => {
      if (a.dataset.nav === page) a.classList.add('active');
    });

    // Mobile hamburger
    const toggle = this.qs('.nav-toggle');
    const links = this.qs('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', () => {
        const isOpen = links.classList.toggle('open');
        toggle.setAttribute('aria-expanded', isOpen);
      });
      links.addEventListener('click', e => {
        if (e.target.tagName === 'A') {
          links.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Theme toggle button in navbar
    const themeBtn = this.qs('.theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    // Global Search trigger button in navbar
    const searchNavBtn = this.qs('.nav-search-btn');
    if (searchNavBtn) {
      searchNavBtn.addEventListener('click', () => this.openGlobalSearch());
    }

    // Auto-fill footer year
    this.qsa('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  },

  /* ==================== GLOBAL SEARCH (Cmd+K) ========================== */
  initGlobalSearch() {
    // Keyboard shortcut Cmd+K or Ctrl+K or '/'
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openGlobalSearch();
      }
    });
  },

  openGlobalSearch() {
    let overlay = this.qs('#globalSearchModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'globalSearchModal';
      overlay.className = 'modal-overlay global-search-overlay';
      overlay.innerHTML = `
        <div class="modal global-search-box" role="dialog" aria-label="Global Search">
          <div class="global-search__head">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="search" id="globalSearchInput" class="global-search__input" placeholder="Search tasks, subjects, notes... (Press Esc to close)" autocomplete="off" />
            <kbd class="kbd-badge">ESC</kbd>
          </div>
          <div class="global-search__results" id="globalSearchResults">
            <div class="search-empty-hint">Type to search anything across StudyFlow...</div>
          </div>
          <div class="global-search__foot">
            <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
            <span><kbd>↵</kbd> to select</span>
            <span><kbd>ESC</kbd> to dismiss</span>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      this.bindModalClose(overlay);

      const input = overlay.querySelector('#globalSearchInput');
      input.addEventListener('input', this.debounce(e => {
        this.renderGlobalSearchResults(e.target.value.trim());
      }, 150));

      // Arrow keys navigation
      input.addEventListener('keydown', e => {
        const results = this.qsa('.search-result-item', overlay);
        let activeIdx = results.findIndex(el => el.classList.contains('active'));

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (results.length === 0) return;
          if (activeIdx > -1) results[activeIdx].classList.remove('active');
          activeIdx = (activeIdx + 1) % results.length;
          results[activeIdx].classList.add('active');
          results[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (results.length === 0) return;
          if (activeIdx > -1) results[activeIdx].classList.remove('active');
          activeIdx = (activeIdx - 1 + results.length) % results.length;
          results[activeIdx].classList.add('active');
          results[activeIdx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          if (activeIdx > -1 && results[activeIdx]) {
            e.preventDefault();
            results[activeIdx].click();
          }
        }
      });
    }

    this.openModal(overlay);
    const inp = overlay.querySelector('#globalSearchInput');
    if (inp) {
      inp.value = '';
      this.renderGlobalSearchResults('');
      setTimeout(() => inp.focus(), 50);
    }
  },

  renderGlobalSearchResults(query) {
    const box = this.qs('#globalSearchResults');
    if (!box) return;

    if (!query) {
      box.innerHTML = `
        <div class="search-empty-hint">
          <p>Quick jump to anything in your study planner</p>
          <div class="search-quick-links mt-3">
            <a href="${this.path('tasks.html')}" class="search-chip">📋 All Tasks</a>
            <a href="${this.path('subjects.html')}" class="search-chip">📚 Subjects</a>
            <a href="${this.path('calendar.html')}" class="search-chip">📅 Calendar</a>
            <a href="${this.path('timer.html')}" class="search-chip">⏱️ Focus Timer</a>
            <a href="${this.path('progress.html')}" class="search-chip">📈 Progress</a>
            <a href="${this.path('notes.html')}" class="search-chip">📝 Notes</a>
          </div>
        </div>`;
      return;
    }

    const q = query.toLowerCase();
    const tasks = Store.getTasks().filter(t => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
    const subjects = Store.getSubjects().filter(s => s.name.toLowerCase().includes(q) || (s.teacher && s.teacher.toLowerCase().includes(q)));
    const notes = Store.getNotes().filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));

    const total = tasks.length + subjects.length + notes.length;
    if (total === 0) {
      box.innerHTML = `<div class="search-empty-hint">No matches found for "<b>${this.escapeHtml(query)}</b>"</div>`;
      return;
    }

    let html = '';

    if (tasks.length > 0) {
      html += `<div class="search-group-title">Tasks (${tasks.length})</div>`;
      tasks.slice(0, 5).forEach(t => {
        const subj = Store.getSubject(t.subjectId);
        html += `
          <a href="${this.path('tasks.html')}?search=${encodeURIComponent(t.title)}" class="search-result-item">
            <span class="search-item__icon ${t.completed ? 'done' : ''}">📋</span>
            <div class="search-item__info">
              <div class="search-item__title ${t.completed ? 'line-through' : ''}">${this.escapeHtml(t.title)}</div>
              <div class="search-item__sub">
                ${subj ? `<span style="color:${subj.color}">● ${this.escapeHtml(subj.name)}</span> · ` : ''}
                Due ${Dates.formatShort(t.dueDate)} (${Dates.relative(t.dueDate)})
              </div>
            </div>
            <span class="badge badge-muted priority-${t.priority}">● ${t.priority}</span>
          </a>`;
      });
    }

    if (subjects.length > 0) {
      html += `<div class="search-group-title">Subjects (${subjects.length})</div>`;
      subjects.slice(0, 4).forEach(s => {
        html += `
          <a href="${this.path('subjects.html')}" class="search-result-item">
            <span class="search-item__icon" style="background:${s.color};color:#fff;border-radius:6px;width:24px;height:24px;display:grid;place-items:center;font-size:12px;font-weight:700">
              ${this.escapeHtml(s.name.charAt(0).toUpperCase())}
            </span>
            <div class="search-item__info">
              <div class="search-item__title">${this.escapeHtml(s.name)}</div>
              <div class="search-item__sub">${s.teacher ? this.escapeHtml(s.teacher) : 'Subject'} ${s.examDate ? `· Exam on ${Dates.formatShort(s.examDate)}` : ''}</div>
            </div>
          </a>`;
      });
    }

    if (notes.length > 0) {
      html += `<div class="search-group-title">Notes (${notes.length})</div>`;
      notes.slice(0, 4).forEach(n => {
        const subj = Store.getSubject(n.subjectId);
        html += `
          <a href="${this.path('notes.html')}" class="search-result-item">
            <span class="search-item__icon">📝</span>
            <div class="search-item__info">
              <div class="search-item__title">${this.escapeHtml(n.title)}</div>
              <div class="search-item__sub">${subj ? `${this.escapeHtml(subj.name)} · ` : ''}Updated ${Dates.timeAgo(n.updatedAt)}</div>
            </div>
          </a>`;
      });
    }

    box.innerHTML = html;

    // Highlight first item
    const first = box.querySelector('.search-result-item');
    if (first) first.classList.add('active');
  },

  /* ==================== WEB AUDIO CHIME ================================ */
  playChime(type = 'bell') {
    const settings = Store.getSettings();
    if (settings.pomodoro && settings.pomodoro.sound === false) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === 'bell' || type === 'finish') {
        // High, cheerful two-tone chime
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now); // D5
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.8);
      } else if (type === 'tick') {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch (e) {
      // AudioContext might be blocked until user gesture, safely ignore
    }
  },

  /* ========================== TOAST =================================== */
  toast(message, type = 'success') {
    let wrap = this.qs('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const icons = {
      success: '<path d="M20 6 9 17l-5-5"/>',
      error:   '<path d="M18 6 6 18M6 6l12 12"/>',
      info:    '<path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="10"/>'
    };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round">${icons[type] || icons.info}</svg>
      <span>${this.escapeHtml(message)}</span>`;
    wrap.appendChild(el);

    // Auto-dismiss with a graceful fade-out
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      setTimeout(() => el.remove(), 300);
    }, 2800);
  },

  /* ========================== MODAL =================================== */
  openModal(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Focus the first field for keyboard users
    const first = overlay.querySelector('input:not([type=hidden]), textarea, select, button:not([data-close])');
    if (first) setTimeout(() => first.focus(), 50);
  },

  closeModal(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  },

  /** Wire an overlay to close on backdrop click and on any [data-close] */
  bindModalClose(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) {
        this.closeModal(overlay);
      }
    });
  },

  /* ===================== CONFIRM DIALOG =============================== */
  /** Promise-free confirm modal built on the fly */
  confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = true, onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px" role="alertdialog" aria-labelledby="confirmTitle">
        <div class="modal__head">
          <h3 id="confirmTitle">${this.escapeHtml(title)}</h3>
          <button class="icon-btn" data-close aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal__body"><p class="text-muted">${this.escapeHtml(message)}</p></div>
        <div class="modal__foot">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${this.escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this.openModal(overlay);

    const close = () => { this.closeModal(overlay); setTimeout(() => overlay.remove(), 250); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) close();
      if (e.target.closest('[data-confirm]')) { close(); onConfirm && onConfirm(); }
    });
  },

  /* ==================== MOTIVATIONAL QUOTES =========================== */
  QUOTES: [
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
    { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
    { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
    { text: "Study hard what interests you the most in the most undisciplined way possible.", author: "Richard Feynman" },
    { text: "There are no shortcuts to any place worth going.", author: "Beverly Sills" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
    { text: "Learning never exhausts the mind.", author: "Leonardo da Vinci" },
    { text: "Small steps every day add up to big results.", author: "Unknown" }
  ],

  quoteOfTheDay() {
    const seed = Number(Dates.todayISO().replace(/-/g, ''));
    return this.QUOTES[seed % this.QUOTES.length];
  },

  randomQuote() {
    return this.QUOTES[Math.floor(Math.random() * this.QUOTES.length)];
  },

  /* ========================= INIT ===================================== */
  init() {
    this.initThemeListener();
    this.initNavbar();
    this.initGlobalSearch();

    // Global Escape closes any open modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.qsa('.modal-overlay.open').forEach(m => this.closeModal(m));
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

