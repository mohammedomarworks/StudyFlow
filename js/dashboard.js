/* ==========================================================================
   dashboard.js — Dashboard page logic
   Renders: greeting & date, dynamic task statistics, completion ring,
   today's tasks (with inline complete toggle), upcoming tasks (next 7 days),
   upcoming exams with countdown, subject progress overview, recent activity,
   daily motivational quote, and quick add modals.
   ========================================================================== */

const COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#dc2626', '#0891b2'];
let selectedColor = COLORS[0];

document.addEventListener('DOMContentLoaded', () => {
  renderHero();
  renderAllDashboardData();
  bindDashboardModals();
});

function renderAllDashboardData() {
  renderStats();
  renderFocusCard();
  renderProgressRing();
  renderTodayTasks();
  renderUpcomingTasks();
  renderUpcomingExams();
  renderSubjectProgress();
  renderActivity();
  renderQuote();
}

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
    { label: 'Total Tasks',    value: s.total,     cls: '',                                          filter: 'all',       icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
    { label: 'Completed',      value: s.completed, cls: 'green',                                     filter: 'completed', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>' },
    { label: 'Active',         value: s.pending,   cls: 'orange',                                    filter: 'active',    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { label: 'Overdue',        value: s.overdue,   cls: s.overdue > 0 ? 'orange' : '', filter: 'overdue', isOverdue: s.overdue > 0, icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' }
  ];

  App.qs('#statsGrid').innerHTML = cards.map((c, i) => `
    <a href="pages/tasks.html?status=${c.filter}" class="stat-card animate-in ${c.isOverdue ? 'is-overdue' : ''}" style="--delay:${i * 50}ms" title="View ${c.label} in Tasks">
      <div class="stat-card__icon ${c.cls}" style="${c.isOverdue ? 'color:var(--danger);background:rgba(239,68,68,0.15)' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
      </div>
      <div>
        <div class="stat-card__value" style="${c.isOverdue ? 'color:var(--danger)' : ''}">${c.value}</div>
        <div class="stat-card__label">${c.label}</div>
      </div>
    </a>`).join('');
}

/* ---- Today's Focus & Daily Goal card ------------------------------------ */
function renderFocusCard() {
  const container = App.qs('#dashFocusContent');
  if (!container) return;

  const study = Store.getStudyStats();
  const settings = Store.getSettings();
  const pomo = settings.pomodoro || {};
  const dailyGoal = pomo.dailyGoal != null ? pomo.dailyGoal : 120;

  if (dailyGoal > 0) {
    const pct = Math.min(100, Math.round((study.todayMinutes / dailyGoal) * 100));
    const isGoalReached = study.todayMinutes >= dailyGoal;
    const remaining = dailyGoal - study.todayMinutes;

    container.innerHTML = `
      <div class="flex-between align-center mb-2">
        <div>
          <span style="font-size:var(--fs-2xl); font-weight:800; color:var(--text); line-height:1.1">${Dates.formatDuration(study.todayMinutes)}</span>
          <span class="text-muted" style="font-size:var(--fs-xs); display:block; margin-top:2px">${study.todaySessionsCount} ${study.todaySessionsCount === 1 ? 'session' : 'sessions'} today</span>
        </div>
        <div style="text-align:right">
          <span class="badge badge-muted" style="font-size:var(--fs-xs)">${study.streakDays > 0 ? `🔥 ${study.streakDays}d streak` : '🔥 0d streak'}</span>
          <span class="text-muted" style="font-size:var(--fs-xs); display:block; margin-top:4px">${pct}% of ${Dates.formatDuration(dailyGoal)} goal</span>
        </div>
      </div>
      <div class="timer-progress-track mb-3" style="height:8px">
        <div class="timer-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="flex-between align-center">
        <small class="text-muted">${isGoalReached ? '<b style="color:var(--success)">🎉 Goal achieved today!</b>' : `${Dates.formatDuration(remaining)} left to reach goal`}</small>
        <a href="pages/timer.html" class="btn btn-primary btn-sm">Start Focus</a>
      </div>`;
  } else {
    container.innerHTML = `
      <div class="flex-between align-center mb-3">
        <div>
          <span style="font-size:var(--fs-2xl); font-weight:800; color:var(--text); line-height:1.1">${Dates.formatDuration(study.todayMinutes)}</span>
          <span class="text-muted" style="font-size:var(--fs-xs); display:block; margin-top:2px">${study.todaySessionsCount} ${study.todaySessionsCount === 1 ? 'session' : 'sessions'} today</span>
        </div>
        <span class="badge badge-muted">${study.streakDays > 0 ? `🔥 ${study.streakDays}d streak` : '🔥 0d streak'}</span>
      </div>
      <div class="flex-between align-center">
        <small class="text-muted">Daily goal disabled</small>
        <a href="pages/timer.html" class="btn btn-primary btn-sm">Start Focus</a>
      </div>`;
  }
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

  const bar = App.qs('#progressRing .ring__bar');
  requestAnimationFrame(() => {
    bar.style.strokeDashoffset = circ * (1 - completionRate / 100);
  });

  App.qs('#progressSummary').innerHTML = total
    ? `<b style="color:var(--text)">${completed}</b> of <b style="color:var(--text)">${total}</b> tasks completed`
    : 'No tasks yet — click <b>Add Task</b> to get started.';
}

/* ---- Today's tasks (inline complete toggle) ------------------------------ */
function renderTodayTasks() {
  const today = Dates.todayISO();
  const tasks = Store.getTasks()
    .filter(t => t.dueDate === today)
    .sort((a, b) => a.completed - b.completed);

  const box = App.qs('#todayTasks');

  if (!tasks.length) {
    box.innerHTML = emptyState('You have no tasks due today. Great job or time to plan ahead! 🎉');
    return;
  }

  box.innerHTML = tasks.map(t => {
    const subject = Store.getSubject(t.subjectId);
    return `
      <label class="list-item ${t.completed ? 'done' : ''}">
        <input type="checkbox" class="check" data-toggle="${t.id}" ${t.completed ? 'checked' : ''} aria-label="Mark task complete" />
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(t.title)}</div>
          <div class="list-item__meta">
            ${subject ? `<span><span class="dot" style="background:${subject.color};display:inline-block;margin-right:4px"></span>${App.escapeHtml(subject.name)}</span>` : ''}
            <span class="priority-${t.priority}">● ${t.priority}</span>
            ${t.category && t.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(t.category)}</span>` : ''}
            ${t.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(t.estimate)}</span>` : ''}
          </div>
        </div>
      </label>`;
  }).join('');

  App.qsa('[data-toggle]', box).forEach(cb => {
    cb.addEventListener('change', () => {
      const isDone = Store.toggleTask(cb.dataset.toggle);
      if (isDone) App.playChime('finish');
      renderAllDashboardData();
    });
  });
}

/* ---- Upcoming tasks (Next 7 days, excluding today) ----------------------- */
function renderUpcomingTasks() {
  const today = Dates.todayISO();
  const next7Days = Dates.offsetISO(7);
  const tasks = Store.getTasks()
    .filter(t => !t.completed && t.dueDate && t.dueDate > today && t.dueDate <= next7Days)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const box = App.qs('#upcomingTasks');

  if (!tasks.length) {
    box.innerHTML = emptyState('No upcoming tasks due in the next 7 days.');
    return;
  }

  box.innerHTML = tasks.slice(0, 5).map(t => {
    const subject = Store.getSubject(t.subjectId);
    return `
      <label class="list-item">
        <input type="checkbox" class="check" data-toggle="${t.id}" aria-label="Mark task complete" />
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(t.title)}</div>
          <div class="list-item__meta">
            ${subject ? `<span><span class="dot" style="background:${subject.color};display:inline-block;margin-right:4px"></span>${App.escapeHtml(subject.name)}</span>` : ''}
            <span>Due ${Dates.formatShort(t.dueDate)} (${Dates.relative(t.dueDate)})</span>
            <span class="priority-${t.priority}">● ${t.priority}</span>
          </div>
        </div>
      </label>`;
  }).join('');

  App.qsa('[data-toggle]', box).forEach(cb => {
    cb.addEventListener('change', () => {
      const isDone = Store.toggleTask(cb.dataset.toggle);
      if (isDone) App.playChime('finish');
      renderAllDashboardData();
    });
  });
}

/* ---- Upcoming exams with countdown --------------------------------------- */
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
    const label = days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `in ${days} days`;
    return `
      <a href="pages/subjects.html?focus=${encodeURIComponent(s.id)}" class="list-item" title="View ${App.escapeHtml(s.name)} in Subjects">
        <span class="countdown" style="border-left: 3px solid ${s.color}">
          <b>${days}</b><small>${days === 1 ? 'day' : 'days'}</small>
        </span>
        <div class="list-item__main">
          <div class="list-item__title">${App.escapeHtml(s.name)}</div>
          <div class="list-item__meta">
            <span>${Dates.formatFull(s.examDate)} (${label})</span>
            ${s.teacher ? `<span>· ${App.escapeHtml(s.teacher)}</span>` : ''}
          </div>
        </div>
        <span class="dot" style="background:${s.color};width:14px;height:14px"></span>
      </a>`;
  }).join('');
}

/* ---- Subject progress mini overview -------------------------------------- */
function renderSubjectProgress() {
  const subjects = Store.getSubjectProgress().filter(s => s.totalTasks > 0);
  const box = App.qs('#dashSubjectProgress');

  if (!subjects.length) {
    box.innerHTML = emptyState('Add tasks with subjects to see your subject progress.');
    return;
  }

  box.innerHTML = subjects.slice(0, 4).map(s => `
    <a href="pages/subjects.html?focus=${encodeURIComponent(s.id)}" class="progress-row" style="display:block" title="View ${App.escapeHtml(s.name)} in Subjects">
      <div class="progress-row__top">
        <span><span class="dot" style="background:${s.color};display:inline-block;margin-right:6px"></span>${App.escapeHtml(s.name)}</span>
        <b>${s.doneTasks}/${s.totalTasks} · ${s.percent}%</b>
      </div>
      <div class="bar"><div class="bar__fill" data-pct="${s.percent}" style="width:0; background:${s.color}"></div></div>
    </a>`).join('');

  requestAnimationFrame(() => {
    App.qsa('#dashSubjectProgress .bar__fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

/* ---- Recent Activity Feed ----------------------------------------------- */
function renderActivity() {
  const box = App.qs('#dashActivityList');
  const activities = Store.getActivity(4);

  if (!activities.length) {
    box.innerHTML = emptyState('No recent activity recorded yet.');
    return;
  }

  const icons = {
    task_complete: '✅',
    task_create: '📋',
    task_delete: '🗑️',
    session_finish: '⏱️',
    note_create: '📝',
    subject_create: '📚'
  };

  box.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-icon">${icons[a.type] || '📌'}</div>
      <div class="activity-content">
        <div class="activity-title">${App.escapeHtml(a.title)}</div>
        <div class="activity-time">${Dates.timeAgo(a.timestamp)}</div>
      </div>
    </div>`).join('');
}

/* ---- Motivational quote -------------------------------------------------- */
function renderQuote() {
  const q = App.quoteOfTheDay();
  App.qs('#quoteText').textContent = q.text;
  App.qs('#quoteAuthor').textContent = `— ${q.author}`;
}

/* ---- Empty state helper -------------------------------------------------- */
function emptyState(msg) {
  return `<p class="text-muted text-center" style="padding:var(--space-4) 0;font-size:var(--fs-sm)">${App.escapeHtml(msg)}</p>`;
}

/* ==========================================================================
   Quick Add Task & Quick Add Subject Modals
   ========================================================================== */
function bindDashboardModals() {
  // Populate subject dropdown in task modal
  const subDropdown = App.qs('#dashTaskSubject');
  const subjects = Store.getSubjects();
  subDropdown.innerHTML = '<option value="">— No subject —</option>' +
    subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  // Quick Add Task button
  const addTaskBtn = App.qs('#dashAddTaskBtn');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => {
      App.qs('#dashTaskForm').reset();
      App.qs('#dashTaskDue').value = Dates.todayISO();
      App.qsa('.field', App.qs('#dashTaskModal')).forEach(f => f.classList.remove('invalid'));
      App.openModal('#dashTaskModal');
    });
  }

  // Quick Add Subject button
  const addSubjBtn = App.qs('#dashAddSubjBtn');
  if (addSubjBtn) {
    addSubjBtn.addEventListener('click', () => {
      App.qs('#dashSubjectForm').reset();
      App.qs('#dfs-name').classList.remove('invalid');
      selectedColor = COLORS[0];
      highlightDashSwatch();
      App.openModal('#dashSubjectModal');
    });
  }

  // Swatches for subject modal
  const swatchesWrap = App.qs('#dashColorSwatches');
  if (swatchesWrap) {
    swatchesWrap.innerHTML = COLORS.map(c =>
      `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`
    ).join('');

    swatchesWrap.addEventListener('click', e => {
      const sw = e.target.closest('.swatch');
      if (sw) {
        selectedColor = sw.dataset.color;
        highlightDashSwatch();
      }
    });
  }

  App.bindModalClose('#dashTaskModal');
  App.bindModalClose('#dashSubjectModal');

  // Submit Quick Add Task
  App.qs('#dashTaskForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = App.qs('#dashTaskTitle').value.trim();
    const due = App.qs('#dashTaskDue').value;

    let valid = true;
    if (title.length < 2) { App.qs('#df-title').classList.add('invalid'); valid = false; }
    if (!due) { App.qs('#df-due').classList.add('invalid'); valid = false; }
    if (!valid) { App.toast('Please fill in the required fields', 'error'); return; }

    Store.saveTask({
      title,
      subjectId: App.qs('#dashTaskSubject').value,
      category: App.qs('#dashTaskCategory').value,
      dueDate: due,
      priority: App.qs('#dashTaskPriority').value,
      estimate: Number(App.qs('#dashTaskEstimate').value) || 0,
      notes: App.qs('#dashTaskNotes').value.trim()
    });

    App.closeModal('#dashTaskModal');
    App.toast('Task added successfully!', 'success');
    renderAllDashboardData();
  });

  // Submit Quick Add Subject
  App.qs('#dashSubjectForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = App.qs('#dashSubjectName').value.trim();

    if (!name) {
      App.qs('#dfs-name').classList.add('invalid');
      App.toast('Please enter a subject name', 'error');
      return;
    }

    Store.saveSubject({
      name,
      color: selectedColor,
      teacher: App.qs('#dashSubjectTeacher').value.trim(),
      examDate: App.qs('#dashSubjectExam').value
    });

    App.closeModal('#dashSubjectModal');
    App.toast('Subject added successfully!', 'success');

    // Update dropdown for tasks
    const subs = Store.getSubjects();
    App.qs('#dashTaskSubject').innerHTML = '<option value="">— No subject —</option>' +
      subs.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

    renderAllDashboardData();
  });

  // Clear errors on input
  ['dashTaskTitle', 'dashTaskDue'].forEach(id => {
    const el = App.qs('#' + id);
    if (el) el.addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
  });
  const sName = App.qs('#dashSubjectName');
  if (sName) sName.addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
}

function highlightDashSwatch() {
  App.qsa('#dashColorSwatches .swatch').forEach(sw => {
    sw.classList.toggle('selected', sw.dataset.color === selectedColor);
  });
}

