/* ==========================================================================
   progress.js — Progress page logic
   Renders: overall completion ring, summary stat tiles, per-subject progress
   bars, task-by-priority breakdown, focus session analytics, and chronological activity history.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderOverall();
  renderSubjectProgress();
  renderPriorityBreakdown();
  renderFocusAnalytics();
  renderActivityTimeline();
});

/* ==========================================================================
   Overall completion ring + summary tiles
   ========================================================================== */
function renderOverall() {
  const s = Store.getStats();
  const size = 190, stroke = 16, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  App.qs('#overallRing').innerHTML = `
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
    <div class="ring__label"><b>${s.completionRate}%</b><small>${s.completed}/${s.total} tasks</small></div>`;

  requestAnimationFrame(() => {
    App.qs('#overallRing .ring__bar').style.strokeDashoffset = circ * (1 - s.completionRate / 100);
  });

  // Summary tiles
  const tiles = [
    { label: 'Total Tasks', value: s.total,     cls: '',                                             filter: 'all',       icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
    { label: 'Completed',   value: s.completed, cls: 'green',                                        filter: 'completed', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>' },
    { label: 'Pending',     value: s.pending,   cls: 'orange',                                       filter: 'active',    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { label: 'Overdue',     value: s.overdue,   cls: s.overdue > 0 ? 'orange' : '', filter: 'overdue', isOverdue: s.overdue > 0, icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' }
  ];

  App.qs('#overallTiles').innerHTML = tiles.map(t => `
    <a href="tasks.html?status=${t.filter}" class="stat-card ${t.isOverdue ? 'is-overdue' : ''}" title="View ${t.label} in Tasks">
      <div class="stat-card__icon ${t.cls}" style="${t.isOverdue ? 'color:var(--danger);background:rgba(239,68,68,0.15)' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      </div>
      <div>
        <div class="stat-card__value" style="${t.isOverdue ? 'color:var(--danger)' : ''}">${t.value}</div>
        <div class="stat-card__label">${t.label}</div>
      </div>
    </a>`).join('');
}

/* ==========================================================================
   Per-subject progress bars
   ========================================================================== */
function renderSubjectProgress() {
  const subjects = Store.getSubjectProgress();
  const box = App.qs('#subjectProgress');

  if (!subjects.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No subjects created yet.</p>`;
    return;
  }

  box.innerHTML = subjects.map(s => `
    <div class="progress-row" style="margin-bottom:var(--space-4)">
      <div class="progress-row__top flex-between">
        <span>
          <span class="dot" style="background:${s.color};display:inline-block;margin-right:6px"></span>
          <b>${App.escapeHtml(s.name)}</b>
        </span>
        <span class="text-muted" style="font-size:var(--fs-sm)">${s.doneTasks}/${s.totalTasks} done (${s.percent}%)</span>
      </div>
      <div class="bar"><div class="bar__fill" data-pct="${s.percent}" style="width:0; background:${s.color}"></div></div>
      <div class="flex wrap gap-2 mt-1" style="font-size:var(--fs-xs); color:var(--text-muted)">
        <span>📝 ${s.notesCount} note${s.notesCount === 1 ? '' : 's'}</span>
        ${s.focusMinutes > 0 ? `<span>· ⏱️ ${Dates.formatDuration(s.focusMinutes)} study</span>` : ''}
        ${s.overdueTasks > 0 ? `<span class="text-danger font-bold">· ⚠️ ${s.overdueTasks} overdue</span>` : ''}
      </div>
    </div>`).join('');

  requestAnimationFrame(() => {
    App.qsa('#subjectProgress .bar__fill').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  });
}

/* ==========================================================================
   Task breakdown by priority
   ========================================================================== */
function renderPriorityBreakdown() {
  const tasks = Store.getTasks();
  const box = App.qs('#priorityBreakdown');

  if (!tasks.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No tasks to analyze yet.</p>`;
    return;
  }

  const levels = [
    { key: 'high',   label: 'High priority',   color: 'var(--danger)' },
    { key: 'medium', label: 'Medium priority', color: 'var(--warning)' },
    { key: 'low',    label: 'Low priority',    color: 'var(--success)' }
  ];

  box.innerHTML = levels.map(l => {
    const all = tasks.filter(t => t.priority === l.key);
    const done = all.filter(t => t.completed).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    return `
      <div class="progress-row" style="margin-bottom:var(--space-4)">
        <div class="progress-row__top flex-between">
          <span><span class="dot" style="background:${l.color};display:inline-block;margin-right:6px"></span>${l.label}</span>
          <b>${done}/${all.length} done (${pct}%)</b>
        </div>
        <div class="bar"><div class="bar__fill" data-pct="${pct}" style="width:0; background:${l.color}"></div></div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    App.qsa('#priorityBreakdown .bar__fill').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  });
}

/* ==========================================================================
   Focus Time Analytics
   ========================================================================== */
function renderFocusAnalytics() {
  const study = Store.getStudyStats();
  const box = App.qs('#focusAnalytics');

  box.innerHTML = `
    <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom:var(--space-4)">
      <div class="stat-card">
        <div class="stat-card__icon green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div>
          <div class="stat-card__value">${Dates.formatDuration(study.totalMinutes)}</div>
          <div class="stat-card__label">Total Focus Time</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card__icon blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
        </div>
        <div>
          <div class="stat-card__value">${study.totalSessions}</div>
          <div class="stat-card__label">Completed Sessions</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card__icon orange">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 10"/></svg>
        </div>
        <div>
          <div class="stat-card__value">${Dates.formatDuration(study.todayMinutes)}</div>
          <div class="stat-card__label">Focus Today</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
        </div>
        <div>
          <div class="stat-card__value">${study.streakDays} ${study.streakDays === 1 ? 'day' : 'days'}</div>
          <div class="stat-card__label">Study Streak</div>
        </div>
      </div>
    </div>
    <p class="text-muted text-center" style="font-size:var(--fs-sm)">
      Start a Pomodoro or customized timer in the <a href="timer.html" class="text-primary font-bold">Focus Timer</a> to log more study sessions.
    </p>`;
}

/* ==========================================================================
   Chronological Activity Timeline
   ========================================================================== */
function renderActivityTimeline() {
  const activities = Store.getActivity(15);
  const box = App.qs('#activityTimeline');

  const countBadge = App.qs('#activityCountBadge');
  if (countBadge) {
    countBadge.textContent = `${activities.length} events`;
  }

  if (!activities.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No activity recorded yet.</p>`;
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

  box.innerHTML = activities.map(a => {
    const ts = a.timestamp || '';
    const dateStr = ts ? Dates.formatFull(ts.slice(0, 10)) : '';
    return `
    <div class="activity-item">
      <div class="activity-icon">${icons[a.type] || '📌'}</div>
      <div class="activity-content">
        <div class="activity-title">${App.escapeHtml(a.title)}</div>
        <div class="activity-time">${Dates.timeAgo(ts)}${dateStr ? ` (${dateStr})` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

