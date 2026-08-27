/* ==========================================================================
   dashboard.js — Dashboard page logic
   Renders: time-based greeting, study statistics, an animated progress ring,
   today's tasks (with inline complete toggle), upcoming exams, and the quote.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderHero();
  renderStats();
  renderProgressRing();
  renderTodayTasks();
  renderUpcomingExams();
  renderQuote();
});

/* ---- Hero greeting + date ------------------------------------------------ */
function renderHero() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  App.qs('#heroGreeting').textContent = `${greeting} 👋`;
  App.qs('#heroDate').textContent = Dates.formatLong(Dates.todayISO());
}

/* ---- Study statistics cards ---------------------------------------------- */
function renderStats() {
  const s = Store.getStats();
  const cards = [
    { label: 'Total Tasks',    value: s.total,         cls: '',       icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
    { label: 'Completed',      value: s.completed,     cls: 'green',  icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>' },
    { label: 'Due Today',      value: s.dueToday,      cls: 'orange', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
    { label: 'Upcoming Exams', value: s.upcomingExams, cls: 'blue',   icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>' }
  ];
  App.qs('#statsGrid').innerHTML = cards.map((c, i) => `
    <div class="stat-card animate-in" style="--delay:${i * 60}ms">
      <div class="stat-card__icon ${c.cls}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
      </div>
      <div>
        <div class="stat-card__value">${c.value}</div>
        <div class="stat-card__label">${c.label}</div>
      </div>
    </div>`).join('');
}

/* ---- Animated progress ring (completion rate) ---------------------------- */
function renderProgressRing() {
  const { completionRate, completed, total } = Store.getStats();
  const size = 150, stroke = 14, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  App.qs('#progressRing').innerHTML = `
    <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#c084fc"/>
        </linearGradient>
      </defs>
      <circle class="ring__track" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring__bar" cx="${size/2}" cy="${size/2}" r="${r}" stroke-width="${stroke}"
              stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
    </svg>
    <div class="ring__label"><b>${completionRate}%</b><small>complete</small></div>`;

  // Animate the bar from empty to its value on the next frame.
  const bar = App.qs('#progressRing .ring__bar');
  requestAnimationFrame(() => { bar.style.strokeDashoffset = circ * (1 - completionRate / 100); });

  App.qs('#progressSummary').innerHTML =
    total ? `<b style="color:var(--text)">${completed}</b> of <b style="color:var(--text)">${total}</b> tasks completed`
          : 'No tasks yet — add some to track progress.';
}

/* ---- Today's tasks (inline complete toggle) ------------------------------ */
function renderTodayTasks() {
  const today = Dates.todayISO();
  const tasks = Store.getTasks()
    .filter(t => t.dueDate === today)
    .sort((a, b) => a.completed - b.completed);   // pending first
  const box = App.qs('#todayTasks');

  if (!tasks.length) {
    box.innerHTML = emptyState('You have no tasks due today. Enjoy the breather! 🎉');
    return;
  }

  box.innerHTML = tasks.map(t => {
    const subject = Store.getSubject(t.subjectId);
    return `
      <label class="list-item ${t.completed ? 'done' : ''}">
        <input type="checkbox" class="check" data-toggle="${t.id}" ${t.completed ? 'checked' : ''} />
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(t.title)}</div>
          <div class="list-item__meta">
            ${subject ? `<span><span class="dot" style="background:${subject.color};display:inline-block;margin-right:4px"></span>${App.escapeHtml(subject.name)}</span>` : ''}
            <span class="priority-${t.priority}">● ${t.priority}</span>
          </div>
        </div>
      </label>`;
  }).join('');

  // Wire inline toggles — flipping one refreshes the stats + ring instantly.
  App.qsa('[data-toggle]', box).forEach(cb => {
    cb.addEventListener('change', () => {
      Store.toggleTask(cb.dataset.toggle);
      renderStats();
      renderProgressRing();
      renderTodayTasks();
    });
  });
}

/* ---- Upcoming exams with day countdown ----------------------------------- */
function renderUpcomingExams() {
  const today = Dates.todayISO();
  const exams = Store.getSubjects()
    .filter(s => s.examDate && s.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  const box = App.qs('#upcomingExams');

  if (!exams.length) {
    box.innerHTML = emptyState('No exams scheduled. Add exam dates on the Subjects page.');
    return;
  }

  box.innerHTML = exams.map(s => {
    const days = Dates.daysFromToday(s.examDate);
    return `
      <div class="list-item">
        <span class="countdown"><b>${days}</b><small>${days === 1 ? 'day' : 'days'}</small></span>
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(s.name)}</div>
          <div class="list-item__meta"><span>${Dates.formatFull(s.examDate)}</span></div>
        </div>
        <span class="dot" style="background:${s.color};width:14px;height:14px"></span>
      </div>`;
  }).join('');
}

/* ---- Motivational quote of the day --------------------------------------- */
function renderQuote() {
  const q = App.quoteOfTheDay();
  App.qs('#quoteText').textContent = q.text;
  App.qs('#quoteAuthor').textContent = `— ${q.author}`;
}

/* ---- Small inline empty-state helper ------------------------------------- */
function emptyState(msg) {
  return `<p class="text-muted text-center" style="padding:var(--space-5) 0">${App.escapeHtml(msg)}</p>`;
}
