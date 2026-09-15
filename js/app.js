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

  /* ========================== MOTION =================================== */
  getMotion() {
    const settings = Store.getSettings();
    return (settings.preferences && settings.preferences.motion) || 'system';
  },

  applyMotion(motionPref) {
    const root = document.documentElement;
    const pref = motionPref || this.getMotion();
    let isReduced = false;

    if (pref === 'reduce') {
      isReduced = true;
    } else if (pref === 'full') {
      isReduced = false;
    } else {
      // 'system' — match device OS setting
      try {
        isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        isReduced = false;
      }
    }

    if (isReduced) {
      root.setAttribute('data-reduced-motion', 'reduce');
    } else {
      root.removeAttribute('data-reduced-motion');
    }
  },

  initMotionListener() {
    this.applyMotion();

    // Watch OS motion preference changes if in system mode
    try {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (media && media.addEventListener) {
        media.addEventListener('change', () => {
          if (this.getMotion() === 'system') {
            this.applyMotion('system');
          }
        });
      }
    } catch {}
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
            <a href="${this.path('habits.html')}" class="search-chip">⚡ Habits</a>
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
    const habits = Store.getHabits(true).filter(h => {
      const subj = Store.getSubject(h.subjectId);
      return h.name.toLowerCase().includes(q) ||
             h.description.toLowerCase().includes(q) ||
             (subj && subj.name.toLowerCase().includes(q));
    });
    const subjects = Store.getSubjects().filter(s => s.name.toLowerCase().includes(q) || (s.teacher && s.teacher.toLowerCase().includes(q)));
    const notes = Store.getNotes().filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));

    const total = tasks.length + habits.length + subjects.length + notes.length;
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

    if (habits.length > 0) {
      html += `<div class="search-group-title">Habits (${habits.length})</div>`;
      habits.slice(0, 4).forEach(h => {
        const subj = Store.getSubject(h.subjectId);
        const streak = Store.getHabitStreak(h.id);
        const todayDone = Store.isHabitCompletedOnDate(h.id, Dates.todayISO());
        const freqText = h.frequency === 'daily' ? 'Daily' : 'Specific Days';
        html += `
          <a href="${this.path('habits.html')}?focus=${encodeURIComponent(h.id)}" class="search-result-item">
            <span class="search-item__icon" style="background:${h.color};color:#fff;border-radius:6px;width:24px;height:24px;display:grid;place-items:center;font-size:13px">
              ${this.escapeHtml(h.icon || '⚡')}
            </span>
            <div class="search-item__info">
              <div class="search-item__title">${this.escapeHtml(h.name)}</div>
              <div class="search-item__sub">
                ${subj ? `<span style="color:${subj.color}">● ${this.escapeHtml(subj.name)}</span> · ` : ''}
                ${freqText} · 🔥 ${streak.currentStreak} streak
              </div>
            </div>
            <span class="badge ${todayDone ? 'badge-primary' : 'badge-muted'}">${todayDone ? '✓ Done' : (h.archived ? 'Archived' : 'Pending')}</span>
          </a>`;
      });
    }

    if (subjects.length > 0) {
      html += `<div class="search-group-title">Subjects (${subjects.length})</div>`;
      subjects.slice(0, 4).forEach(s => {
        html += `
          <a href="${this.path('subjects.html')}?focus=${encodeURIComponent(s.id)}" class="search-result-item">
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
          <a href="${this.path('notes.html')}?noteId=${encodeURIComponent(n.id)}" class="search-result-item">
            <span class="search-item__icon">${n.pinned ? '📌' : '📝'}</span>
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
    // A detail view can re-render while its modal remains open (for example,
    // toggling a task in Calendar). Do not add another focus trap each time.
    if (overlay.classList.contains('open')) return;

    const dialog = overlay.querySelector('.modal');
    if (dialog) {
      dialog.setAttribute('role', dialog.getAttribute('role') || 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
        const heading = dialog.querySelector('h1, h2, h3');
        if (heading) {
          if (!heading.id) heading.id = `modal-title-${Date.now()}`;
          dialog.setAttribute('aria-labelledby', heading.id);
        }
      }
    }

    overlay._prevFocus = document.activeElement;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Focus the first meaningful field/control for keyboard users.
    const first = overlay.querySelector(
      'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([data-close]):not([disabled]), a[href]'
    );
    if (first) setTimeout(() => first.focus(), 50);

    // Trap Tab focus inside the modal (keyboard users can't tab out).
    overlay._trap = (e) => {
      if (e.key !== 'Tab') return;
      const focusables = this.qsa(
        'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        overlay
      ).filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    overlay.addEventListener('keydown', overlay._trap);
  },

  closeModal(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.classList.remove('open');

    if (overlay._trap) { overlay.removeEventListener('keydown', overlay._trap); overlay._trap = null; }

    // Only release the scroll lock once no modal remains open.
    if (!this.qs('.modal-overlay.open')) document.body.style.overflow = '';

    // Return focus to whatever was focused before the modal opened.
    const prev = overlay._prevFocus;
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
    overlay._prevFocus = null;

    if (overlay._removeOnClose) setTimeout(() => overlay.remove(), 250);
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

    overlay._removeOnClose = true;
    const close = () => this.closeModal(overlay);
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

  /* ========================== AUTH NAVIGATION =========================== */
  initAuthNav() {
    const navActions = this.qs('.nav-actions');
    if (!navActions) return;

    let navAuth = this.qs('.nav-auth', navActions);
    if (!navAuth) {
      navAuth = document.createElement('div');
      navAuth.className = 'nav-auth';
      navAuth.id = 'navAuth';
      const themeToggle = this.qs('.theme-toggle', navActions);
      if (themeToggle) {
        navActions.insertBefore(navAuth, themeToggle);
      } else {
        navActions.prepend(navAuth);
      }
    }

    const renderAuthNav = (event, session, user, state) => {
      if (!window.Auth) {
        navAuth.innerHTML = '';
        return;
      }

      const isAuthPage = document.body && document.body.dataset.page === 'auth';

      if (user && state === 'authenticated') {
        const displayName = user.displayName || 'Student';
        const initials = (displayName.charAt(0) || 'S').toUpperCase();
        const settingsUrl = this.path('pages/settings.html') + '#sectionAccount';

        navAuth.innerHTML = `
          <div class="nav-user-menu" id="navUserMenu">
            <button type="button" class="nav-user-btn" id="navUserBtn" aria-label="Account menu for ${this.escapeHtml(displayName)}" aria-haspopup="true" aria-expanded="false">
              <span class="user-avatar-badge" aria-hidden="true">${this.escapeHtml(initials)}</span>
              <span class="nav-user-name">${this.escapeHtml(displayName)}</span>
              <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="nav-user-dropdown" id="navUserDropdown" role="menu" aria-label="Account menu">
              <div class="dropdown-header">
                <div class="dropdown-name">${this.escapeHtml(displayName)}</div>
                <div class="dropdown-email text-muted">${this.escapeHtml(user.email || '')}</div>
              </div>
              <div class="dropdown-divider"></div>
              <a href="${settingsUrl}" class="dropdown-item" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Account & Settings</span>
              </a>
              <button type="button" class="dropdown-item dropdown-logout" id="navLogoutBtn" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        `;

        const userBtn = navAuth.querySelector('#navUserBtn');
        const userMenu = navAuth.querySelector('#navUserMenu');
        const logoutBtn = navAuth.querySelector('#navLogoutBtn');

        if (userBtn && userMenu) {
          userBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = userMenu.classList.toggle('open');
            userBtn.setAttribute('aria-expanded', isOpen);
          });
        }

        if (logoutBtn) {
          logoutBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (userMenu) userMenu.classList.remove('open');
            if (userBtn) userBtn.setAttribute('aria-expanded', 'false');
            await window.Auth.signOut();
            this.toast('Signed out. Local planner data remains safe.', 'info');
          });
        }
      } else if (!isAuthPage && state !== 'loading') {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const isSub = this.isSubpage();
        const redirectParam = isSub ? currentPage : 'index.html';
        const authUrl = `${this.path('pages/auth.html')}?redirect=${encodeURIComponent(redirectParam)}`;

        navAuth.innerHTML = `
          <a href="${authUrl}" class="btn btn-ghost btn-sm nav-auth-btn" id="navAuthBtn" title="Sign In">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            <span>Sign In</span>
          </a>
        `;
      } else {
        navAuth.innerHTML = '';
      }
    };

    // Outside click & escape listeners for user dropdown
    document.addEventListener('click', (e) => {
      const openMenu = this.qs('.nav-user-menu.open');
      if (openMenu && !openMenu.contains(e.target)) {
        openMenu.classList.remove('open');
        const btn = openMenu.querySelector('.nav-user-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openMenu = this.qs('.nav-user-menu.open');
        if (openMenu) {
          openMenu.classList.remove('open');
          const btn = openMenu.querySelector('.nav-user-btn');
          if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
          }
        }
      }
    });

    if (window.Auth) {
      window.Auth.onAuthStateChange(renderAuthNav);
      window.Auth.init().then(res => {
        renderAuthNav('INITIAL_SESSION', res.session, res.user, res.state);
      });
    }
  },

  /* ========================= INIT ===================================== */
  init() {
    this.initThemeListener();
    this.initMotionListener();
    this.initNavbar();
    this.initGlobalSearch();
    this.initAuthNav();

    // Global Escape closes any open modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.qsa('.modal-overlay.open').forEach(m => this.closeModal(m));
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
