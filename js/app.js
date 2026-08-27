/* ==========================================================================
   app.js — Shared application shell & UI helpers
   --------------------------------------------------------------------------
   Loaded on every page (after storage.js, before the page-specific script).
   Exposes a single global `App` with: DOM helpers, theme control, navbar
   behavior, toast notifications, modal + confirm dialogs, and the pool of
   motivational quotes. Auto-initializes shared UI on DOMContentLoaded.
   ========================================================================== */

const App = {

  /* ======================= DOM helpers ================================= */
  qs(sel, ctx = document) { return ctx.querySelector(sel); },
  qsa(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); },

  /** Escape user-supplied text before inserting via innerHTML (XSS-safe). */
  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Debounce a function (used for the live search inputs). */
  debounce(fn, ms = 250) {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
  },

  /* ========================== THEME ==================================== */
  /* The theme is applied pre-paint by an inline script in each <head>;
     here we just keep the toggle button in sync and handle clicks. */
  getTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; },

  setTheme(theme) {
    const root = document.documentElement;
    // Enable a brief color transition only while switching (not on load).
    root.classList.add('theme-transition');
    root.setAttribute('data-theme', theme);
    Store.setSetting('theme', theme);
    window.setTimeout(() => root.classList.remove('theme-transition'), 500);
  },

  toggleTheme() { this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark'); },

  /* ========================== NAVBAR =================================== */
  initNavbar() {
    // Highlight the link matching this page (body[data-page]).
    const page = document.body.dataset.page;
    this.qsa('.nav-links a').forEach(a => {
      if (a.dataset.nav === page) a.classList.add('active');
    });

    // Mobile hamburger toggles the slide-down menu.
    const toggle = this.qs('.nav-toggle');
    const links = this.qs('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', () => links.classList.toggle('open'));
      // Close the menu after tapping a link.
      links.addEventListener('click', e => {
        if (e.target.tagName === 'A') links.classList.remove('open');
      });
    }

    // Theme toggle button.
    const themeBtn = this.qs('.theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', () => this.toggleTheme());

    // Auto-fill any footer year element.
    const yr = this.qs('[data-year]');
    if (yr) yr.textContent = new Date().getFullYear();
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
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round">${icons[type] || icons.info}</svg>
        <span>${this.escapeHtml(message)}</span>`;
    wrap.appendChild(el);

    // Auto-dismiss with a graceful fade-out.
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
    document.body.style.overflow = 'hidden';   // lock background scroll
    // Focus the first field for keyboard users.
    const first = overlay.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 50);
  },

  closeModal(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  },

  /** Wire an overlay to close on backdrop click and on any [data-close]. */
  bindModalClose(overlay) {
    if (typeof overlay === 'string') overlay = this.qs(overlay);
    if (!overlay) return;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) this.closeModal(overlay);
    });
  },

  /* ===================== CONFIRM DIALOG =============================== */
  /** Promise-free confirm modal built on the fly; runs onConfirm if accepted. */
  confirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = true, onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal__head">
          <h3>${this.escapeHtml(title)}</h3>
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

  /** A quote that changes daily (stable within a day, fresh the next). */
  quoteOfTheDay() {
    const seed = Number(Dates.todayISO().replace(/-/g, ''));
    return this.QUOTES[seed % this.QUOTES.length];
  },

  randomQuote() { return this.QUOTES[Math.floor(Math.random() * this.QUOTES.length)]; },

  /* ========================= INIT ===================================== */
  init() {
    this.initNavbar();
    // Global Escape closes any open modal.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.qsa('.modal-overlay.open').forEach(m => this.closeModal(m));
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
