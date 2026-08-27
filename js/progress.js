/* ==========================================================================
   progress.js — Progress page logic
   Renders: overall completion ring, summary stat tiles, per-subject progress
   bars, and a task-by-priority breakdown. All values derived from Store.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderOverall();
  renderSubjectProgress();
  renderPriorityBreakdown();
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

  // Summary tiles.
  const tiles = [
    { label: 'Total Tasks', value: s.total,     cls: '' },
    { label: 'Completed',   value: s.completed, cls: 'green' },
    { label: 'Pending',     value: s.pending,   cls: 'orange' },
    { label: 'Overdue',     value: s.overdue,   cls: 'blue' }
  ];
  App.qs('#overallTiles').innerHTML = tiles.map(t => `
    <div class="stat-card">
      <div>
        <div class="stat-card__value ${t.cls === 'green' ? '' : ''}">${t.value}</div>
        <div class="stat-card__label">${t.label}</div>
      </div>
    </div>`).join('');
}

/* ==========================================================================
   Per-subject progress bars
   ========================================================================== */
function renderSubjectProgress() {
  const subjects = Store.getSubjectProgress().filter(s => s.totalTasks > 0);
  const box = App.qs('#subjectProgress');

  if (!subjects.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No tasks assigned to subjects yet.</p>`;
    return;
  }

  box.innerHTML = subjects.map(s => `
    <div class="progress-row">
      <div class="progress-row__top">
        <span><span class="dot" style="background:${s.color};display:inline-block;margin-right:6px"></span>${App.escapeHtml(s.name)}</span>
        <b>${s.doneTasks}/${s.totalTasks} · ${s.percent}%</b>
      </div>
      <div class="bar"><div class="bar__fill" data-pct="${s.percent}" style="width:0"></div></div>
    </div>`).join('');

  // Animate bars to their target width after paint.
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
      <div class="progress-row">
        <div class="progress-row__top">
          <span><span class="dot" style="background:${l.color};display:inline-block;margin-right:6px"></span>${l.label}</span>
          <b>${done}/${all.length} done</b>
        </div>
        <div class="bar"><div class="bar__fill" data-pct="${pct}" style="width:0; background:${l.color}"></div></div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    App.qsa('#priorityBreakdown .bar__fill').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  });
}
